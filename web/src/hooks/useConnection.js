import { useState, useRef, useEffect } from 'react'
import {
  getInstanceSlug,
  getWsUrl,
  getStoredToken,
  setStoredToken,
  clearStoredToken,
  STORAGE_KEY_RECONNECT,
  isTauriEnv,
} from '../utils/sessionUrl'
import {
  getBarUserMinutes,
  getAgeConfirmedForInstance,
  setAgeConfirmedForInstance,
} from '../utils/settings'
import {
  hasE2EWith,
  getPeerFingerprint,
  setPeerVerified,
  acceptNewKey,
  getVerificationStatus,
  getDmKeyLineForPeer,
} from '../utils/e2eDM'
import {
  encryptRoomMessage,
  hasRoomKey,
  generateRoomKey,
  getRoomKeyMessageForDm,
} from '../utils/e2eRoom'
import { requestNotificationPermission } from '../utils/notifications'
import {
  TYPING_EXPIRE_MS,
  TYPING_DEBOUNCE_MS,
  HEARTBEAT_INTERVAL_MS,
} from './connection/constants'
import { isServerCommand, parseBARLine } from './connection/parsing'
import {
  getInitialReconnectFromStorage,
  clearReconnectCache,
} from './connection/reconnectStorage'
import { useRoomMessages } from './connection/useRoomMessages'
import { useDmMessages } from './connection/useDmMessages'
import { useReconnect } from './connection/useReconnect'

export function useConnection(sessionParams, sessionInfo) {
  const [phase, setPhase] = useState('login')
  const [username, setUsername] = useState(
    () => getInitialReconnectFromStorage().username
  )
  const [inviteCode, setInviteCode] = useState('')
  const [loginError, setLoginError] = useState('')
  const [connecting, setConnecting] = useState(false)
  const [inputValue, setInputValue] = useState('')
  const [disconnected, setDisconnected] = useState(false)
  const [isWsOpen, setIsWsOpen] = useState(false)
  const [sendError, setSendError] = useState('')

  const wsRef = useRef(null)
  const messagesEndRef = useRef(null)
  const didWelcomeRef = useRef(false)
  const loginErrorSetRef = useRef(false)
  const welcomeTimeoutRef = useRef(null)
  const inChatRef = useRef(false)
  const mountedRef = useRef(true)
  const typingDebounceRef = useRef(null)

  const room = useRoomMessages({ wsRef, mountedRef })
  const dm = useDmMessages({ wsRef, mountedRef, username })
  const reconnect = useReconnect()

  // Pre-fill access code from URL fragment (#invite=CODE) or query (?code=...)
  useEffect(() => {
    if (typeof window === 'undefined') return
    const rawHash = window.location.hash
      ? window.location.hash.replace(/^#/, '').trim()
      : ''
    const params = new URLSearchParams(window.location.search)
    const codeFromQuery = params.get('code')?.trim() || ''
    let codeToUse = ''
    if (rawHash.startsWith('invite=')) {
      codeToUse = rawHash.slice(7).split('&')[0].trim()
      if (window.history?.replaceState)
        window.history.replaceState(
          null,
          '',
          window.location.pathname + window.location.search
        )
    } else if (rawHash && !rawHash.includes('=')) {
      codeToUse = rawHash
    }
    const apply = () => {
      if (codeToUse) setInviteCode((prev) => (prev ? prev : codeToUse))
      else if (codeFromQuery)
        setInviteCode((prev) => (prev ? prev : codeFromQuery))
    }
    queueMicrotask(apply)
  }, [])

  // Notification permission on chat entry
  useEffect(() => {
    if (phase === 'chat') requestNotificationPermission().catch(() => {})
  }, [phase])

  // Heartbeat: keep connection alive
  useEffect(() => {
    if (phase !== 'chat' || !isWsOpen) return
    const interval = setInterval(() => {
      if (wsRef.current?.readyState === WebSocket.OPEN)
        wsRef.current.send('/heartbeat')
    }, HEARTBEAT_INTERVAL_MS)
    return () => clearInterval(interval)
  }, [phase, isWsOpen])

  // Unmount cleanup: close WS, clear timers (5.1, 5.2, 5.3)
  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      clearTimeout(typingDebounceRef.current)
      clearTimeout(dm.dmTypingDebounceRef.current)
      if (welcomeTimeoutRef.current) {
        clearTimeout(welcomeTimeoutRef.current)
        welcomeTimeoutRef.current = null
      }
      if (wsRef.current) {
        wsRef.current.close()
        wsRef.current = null
      }
    }
  }, [dm.dmTypingDebounceRef])

  // ── Shared message batch processor ───────────────────────────────────────────
  /**
   * Process a received server text batch, delegating per-line work to sub-hooks.
   * Called from both handleLogin and handleReconnect onmessage handlers.
   *
   * @param {string} text  - raw WebSocket text payload
   * @param {WebSocket} ws - the active socket (may differ from wsRef.current mid-reconnect)
   */
  function processServerBatch(text, ws) {
    const lines = text.split('\n').filter(Boolean)
    let joinedRoomInBatch = null

    // Welcome: request initial state and send DM key if a DM view is open
    if (text.includes('Welcome,') || text.includes('Welcome back,')) {
      const welcomeRoom = text.match(/\(in #(\S+)\)/)
      if (welcomeRoom) {
        room.setCurrentRoom(welcomeRoom[1])
        joinedRoomInBatch = welcomeRoom[1]
      }
      ws.send('/rooms')
      ws.send('/users')
      if (dm.dmViewRef.current) {
        getDmKeyLineForPeer(dm.dmViewRef.current).then((keyLine) => {
          if (keyLine && wsRef.current?.readyState === WebSocket.OPEN)
            wsRef.current.send(keyLine)
        })
      }
    }

    // Store reconnect token from server
    const reconnectMatch = text.match(/reconnect:([^:\s]+):([^\s\n]+)/)
    if (reconnectMatch) {
      const tip = `reconnect:${reconnectMatch[1]}:${reconnectMatch[2]}`
      reconnect.setReconnectTip(tip)
      try {
        localStorage.setItem(STORAGE_KEY_RECONNECT, tip)
        setStoredToken(
          getInstanceSlug(sessionParams),
          reconnectMatch[1],
          reconnectMatch[2]
        )
      } catch {
        // ignore (localStorage disabled or quota exceeded)
      }
    }

    if (text.includes('You joined #')) {
      const m = text.match(/You joined #(\S+)/)
      if (m) {
        room.setCurrentRoom(m[1])
        joinedRoomInBatch = m[1]
        ws.send('/users')
      }
    }
    if (text.startsWith('Users in #')) room.handleUsersText(lines)
    if (text.includes('Rooms:\n') || text.startsWith('Rooms:'))
      room.handleRoomsText(lines)

    const now = Date.now()
    const restLines = []
    lines.forEach((line) => {
      if (
        room.processRoomLine(line, { now, inviteCode, username, sessionParams })
      )
        return
      if (dm.processDmControlLine(line, now)) return
      if (
        /^\*\*\* .+ (?:joined|left) the (?:channel|chat) \*\*\*$/.test(
          line.trim()
        )
      )
        return
      if (dm.isDmSentEcho(line)) return
      if (dm.processDmMessageLine(line)) return
      const parsed = parseBARLine(line)
      restLines.push(
        parsed.burnTs != null
          ? { line: parsed.line, burnTs: parsed.burnTs }
          : { line: parsed.line, burnTs: null }
      )
    })

    room.finalizeRoomBatch(restLines, joinedRoomInBatch, {
      inviteCode,
      username,
      slug: sessionParams?.slug || 'default',
    })
  }

  // ── handleLogin ───────────────────────────────────────────────────────────────
  const handleLogin = (e, opts) => {
    e.preventDefault()
    setLoginError('')
    reconnect.setReconnectTip('')
    if (!inviteCode.trim()) {
      setLoginError('Access code is required to join this server.')
      return
    }
    setConnecting(true)
    didWelcomeRef.current = false
    loginErrorSetRef.current = false
    const ageConfirmed = !!opts?.ageConfirmed
    const un = username.trim() || ''
    const tokenFromField = reconnect.reconnectToken.trim()
    let authLine
    if (tokenFromField) {
      authLine = `reconnect:${un || 'user'}:${tokenFromField}`
    } else if (un) {
      const savedToken = getStoredToken(getInstanceSlug(sessionParams), un)
      authLine = savedToken ? `reconnect:${un}:${savedToken}` : un
    } else {
      authLine = 'Guest'
    }
    const userBar = getBarUserMinutes()
    if (userBar > 0) {
      const maxCap = sessionInfo?.user_bar_max_minutes ?? 2880
      const sessionCap =
        sessionInfo?.session_bar_minutes > 0
          ? sessionInfo.session_bar_minutes
          : maxCap
      authLine = authLine + ' bar:' + Math.min(userBar, maxCap, sessionCap)
    }
    const wsUrl = getWsUrl(sessionParams)
    const instanceKey =
      (sessionParams?.wsBaseUrl || '') +
      '_' +
      (sessionParams?.slug || 'default')
    if (ageConfirmed && sessionInfo?.minimum_age > 0)
      setAgeConfirmedForInstance(instanceKey)

    const ws = new WebSocket(wsUrl)
    wsRef.current = ws

    const connectionTimeout = setTimeout(() => {
      if (ws.readyState === WebSocket.CONNECTING) {
        ws.close()
        loginErrorSetRef.current = true
        setLoginError(
          isTauriEnv
            ? 'Connection timed out. Check the server URL and that the server is running.'
            : 'Connection timed out. Is the Go chat server running? Set VITE_WS_URL in web/.env to the server URL, not the Vite dev server.'
        )
        setConnecting(false)
      }
    }, 10000)

    const WELCOME_TIMEOUT_MS = 18000

    ws.onopen = () => {
      clearTimeout(connectionTimeout)
      setIsWsOpen(true)
      let line = authLine
      if (inviteCode.trim()) line = line + ' accesscode:' + inviteCode.trim()
      if (
        (ageConfirmed || getAgeConfirmedForInstance(instanceKey)) &&
        sessionInfo?.minimum_age > 0
      )
        line = line + ' ageconfirmed'
      ws.send(line)
      welcomeTimeoutRef.current = setTimeout(() => {
        welcomeTimeoutRef.current = null
        if (!didWelcomeRef.current && wsRef.current) {
          wsRef.current.close()
          loginErrorSetRef.current = true
          setLoginError('Server is busy. Please try again.')
          setConnecting(false)
        }
      }, WELCOME_TIMEOUT_MS)
    }

    ws.onmessage = (event) => {
      const text = event.data
      if (typeof text !== 'string') return
      if (
        text.includes('Invalid') ||
        text.includes('Username already') ||
        text.includes('unavailable') ||
        text.includes('already have a session') ||
        text.includes('Failed') ||
        text.includes('expired') ||
        text.includes('Age confirmation required') ||
        text.includes('Access code required')
      ) {
        if (welcomeTimeoutRef.current) {
          clearTimeout(welcomeTimeoutRef.current)
          welcomeTimeoutRef.current = null
        }
        loginErrorSetRef.current = true
        const isUsernameUnavailable =
          text.includes('unavailable') ||
          text.includes('already have a session')
        setLoginError(
          isUsernameUnavailable
            ? 'Username unavailable.'
            : text.trim().split('\n')[0]
        )
        setConnecting(false)
        ws.close()
        return
      }
      if (text.includes('Welcome,')) {
        if (welcomeTimeoutRef.current) {
          clearTimeout(welcomeTimeoutRef.current)
          welcomeTimeoutRef.current = null
        }
        didWelcomeRef.current = true
        inChatRef.current = true
        setPhase('chat')
        setConnecting(false)
        setDisconnected(false)
      }
      processServerBatch(text, ws)
    }

    ws.onerror = () => {
      loginErrorSetRef.current = true
      setIsWsOpen(false)
      setLoginError(
        isTauriEnv
          ? 'Connection error. Check the server URL and that the server is running.'
          : 'Connection error. Is the server running?'
      )
      setConnecting(false)
    }

    ws.onclose = () => {
      clearTimeout(connectionTimeout)
      if (welcomeTimeoutRef.current) {
        clearTimeout(welcomeTimeoutRef.current)
        welcomeTimeoutRef.current = null
      }
      wsRef.current = null
      setIsWsOpen(false)
      setConnecting(false)
      if (!didWelcomeRef.current && !loginErrorSetRef.current)
        setLoginError(
          isTauriEnv
            ? 'Could not connect. Check the server URL (scheme, host, port) and instance slug.'
            : 'Could not connect. Is the Go server running? Check VITE_WS_URL in web/.env (scheme, host, port) and instance path.'
        )
      if (inChatRef.current) {
        inChatRef.current = false
        setDisconnected(false)
        setPhase('login')
        setLoginError('Session ended. Please sign in again.')
      } else {
        setDisconnected(true)
      }
    }
  }

  // ── handleReconnect ──────────────────────────────────────────────────────────
  const handleReconnect = () => {
    if (!inviteCode.trim()) {
      setLoginError('Access code is required to join this server.')
      setPhase('login')
      return
    }
    let authLine =
      reconnect.reconnectTip ||
      (() => {
        try {
          return localStorage.getItem(STORAGE_KEY_RECONNECT)
        } catch {
          return null
        }
      })()
    if (!authLine || !authLine.startsWith('reconnect:')) {
      setDisconnected(false)
      setPhase('login')
      return
    }
    const userBarReconnect = getBarUserMinutes()
    if (userBarReconnect > 0) {
      const maxCap = sessionInfo?.user_bar_max_minutes ?? 2880
      const sessionCap =
        sessionInfo?.session_bar_minutes > 0
          ? sessionInfo.session_bar_minutes
          : maxCap
      authLine =
        authLine + ' bar:' + Math.min(userBarReconnect, maxCap, sessionCap)
    }
    const instanceKey =
      (sessionParams?.wsBaseUrl || '') +
      '_' +
      (sessionParams?.slug || 'default')
    if (sessionInfo?.minimum_age > 0 && getAgeConfirmedForInstance(instanceKey))
      authLine = authLine + ' ageconfirmed'

    setConnecting(true)
    const ws = new WebSocket(getWsUrl(sessionParams))
    wsRef.current = ws

    ws.onopen = () => {
      setIsWsOpen(true)
      let line = authLine
      if (inviteCode.trim()) line = line + ' accesscode:' + inviteCode.trim()
      ws.send(line)
    }

    ws.onmessage = (event) => {
      const text = event.data
      if (typeof text !== 'string') return
      if (
        text.includes('Invalid') ||
        text.includes('expired') ||
        text.includes('Access code required') ||
        text.includes('unavailable') ||
        text.includes('already have a session')
      ) {
        loginErrorSetRef.current = true
        setConnecting(false)
        setPhase('login')
        const isUsernameUnavailable =
          text.includes('unavailable') ||
          text.includes('already have a session')
        setLoginError(
          isUsernameUnavailable
            ? 'Username unavailable.'
            : text.trim().split('\n')[0]
        )
        ws.close()
        return
      }
      if (text.includes('Welcome,') || text.includes('Welcome back,')) {
        setDisconnected(false)
        setConnecting(false)
        setPhase('chat')
        inChatRef.current = true
      }
      processServerBatch(text, ws)
    }

    ws.onerror = () => {
      setIsWsOpen(false)
      setConnecting(false)
      if (!inChatRef.current) {
        setPhase('login')
        setLoginError(
          'Connection failed. Check server URL, TLS cert (try HTTP), ALLOWED_ORIGINS, and access code.'
        )
      }
    }

    ws.onclose = () => {
      wsRef.current = null
      setIsWsOpen(false)
      setConnecting(false)
      if (inChatRef.current) {
        inChatRef.current = false
        setDisconnected(false)
        setPhase('login')
        setLoginError('Session ended. Please sign in again.')
      } else {
        setDisconnected(true)
        setPhase('login')
        if (!loginErrorSetRef.current)
          setLoginError(
            'Connection closed before join. Check server URL, TLS cert (try HTTP), ALLOWED_ORIGINS, and access code.'
          )
      }
    }
  }

  // ── Message send ─────────────────────────────────────────────────────────────
  const sendMessage = async (e) => {
    e?.preventDefault()
    const line = inputValue.trim()
    if (!line || !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN)
      return
    // /msg shortcut: add optimistic outgoing entry to the DM thread
    const msgMatch = line.match(/^\/msg\s+(\S+)\s+(.*)$/s)
    if (msgMatch) {
      const [, target, content] = msgMatch
      if (target) {
        dm.setDmThreads((prev) => ({
          ...prev,
          [target]: [
            ...(prev[target] || []),
            {
              from: username.trim() || 'Guest',
              content: content || '',
              outgoing: true,
            },
          ],
        }))
      }
    }
    if (isServerCommand(line)) {
      wsRef.current.send(line)
      setInputValue('')
      return
    }
    const encrypted = await encryptRoomMessage(room.currentRoom, line)
    if (!encrypted) {
      const msg =
        'Room key not ready. Wait a moment or rejoin with the access code.'
      setLoginError(msg)
      setSendError(msg)
      return
    }
    setLoginError('')
    setSendError('')
    wsRef.current.send(encrypted)
    setInputValue('')
  }

  const handleDmSend = async (e) => {
    const err = await dm.handleDmSend(e)
    if (err) {
      setLoginError(err)
      setSendError(err)
    } else if (err === '') {
      setLoginError('')
      setSendError('')
    }
  }

  // ── Typing indicators ─────────────────────────────────────────────────────────
  const sendRoomTyping = () => {
    if (!dm.dmView && wsRef.current?.readyState === WebSocket.OPEN)
      wsRef.current.send('/typing')
  }
  const scheduleRoomTyping = () => {
    if (typingDebounceRef.current) clearTimeout(typingDebounceRef.current)
    typingDebounceRef.current = setTimeout(sendRoomTyping, TYPING_DEBOUNCE_MS)
  }

  const forgetSession = () => {
    const slug = getInstanceSlug(sessionParams)
    const un = (username || '').trim()
    clearStoredToken(slug, un)
    clearReconnectCache()
    reconnect.setReconnectToken('')
    reconnect.setReconnectTip('')
  }

  return {
    phase,
    username,
    setUsername,
    reconnectToken: reconnect.reconnectToken,
    setReconnectToken: reconnect.setReconnectToken,
    inviteCode,
    setInviteCode,
    loginError,
    connecting,
    // Room message state
    messages: room.messages,
    messagesEndRef,
    messagesRef: room.messagesRef,
    currentRoom: room.currentRoom,
    setCurrentRoom: room.setCurrentRoom,
    roomsList: room.roomsList,
    usersInRoom: room.usersInRoom,
    roomTyping: room.roomTyping,
    roomsWithE2ESeen: room.roomsWithE2ESeen,
    slowmodeRemainingSeconds: room.slowmodeRemainingSeconds,
    rateLimitMessage: room.rateLimitMessage,
    welcomeMessages: room.welcomeMessages,
    // DM state
    dmThreads: dm.dmThreads,
    dmView: dm.dmView,
    setDmView: dm.setDmView,
    dmInputValue: dm.dmInputValue,
    setDmInputValue: dm.setDmInputValue,
    dmTypingFrom: dm.dmTypingFrom,
    dmTypingAt: dm.dmTypingAt,
    dmMessagesEndRef: dm.dmMessagesEndRef,
    // Input / connection
    inputValue,
    setInputValue,
    disconnected,
    isWsOpen,
    sendError,
    setSendError,
    reconnectTip: reconnect.reconnectTip,
    wsRef,
    // Actions
    handleLogin,
    handleReconnect,
    sendMessage,
    handleDmSend,
    resendDmKey: dm.resendDmKey,
    scheduleRoomTyping,
    scheduleDmTyping: dm.scheduleDmTyping,
    sendRoomKeyToUser: (peer) => dm.sendRoomKeyToUser(peer, room.currentRoom),
    forgetSession,
    // E2E passthrough (consumed directly by UI components)
    hasE2EWith,
    getPeerFingerprint,
    setPeerVerified,
    acceptNewKey,
    getVerificationStatus,
    hasRoomKey,
    generateRoomKey,
    getRoomKeyMessageForDm,
    roomHasE2EInUse: (roomName) =>
      hasRoomKey(roomName) || !!room.roomsWithE2ESeen[roomName],
    TYPING_EXPIRE_MS,
  }
}
