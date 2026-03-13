import { useState, useRef, useEffect } from 'react'
import {
  decryptRoomMessage,
  hasRoomKey,
  generateRoomKey,
  parseWrappedRoomKeyLine,
  unwrapRoomKeyFromServer,
  wrapRoomKeyForServer,
} from '../../utils/e2eRoom'
import {
  showNotificationIfHidden,
  previewText,
} from '../../utils/notifications'
import { TYPING_EXPIRE_MS } from './constants'

/**
 * Manages room message state and provides per-line and per-batch processors
 * for the WebSocket onmessage handler.
 *
 * @param {{ wsRef: React.MutableRefObject, mountedRef: React.MutableRefObject }} opts
 */
export function useRoomMessages({ wsRef, mountedRef }) {
  const [messages, setMessages] = useState([])
  const [roomsList, setRoomsList] = useState([])
  const [usersInRoom, setUsersInRoom] = useState([])
  const [currentRoom, setCurrentRoom] = useState('general')
  const [roomTyping, setRoomTyping] = useState({})
  const [roomsWithE2ESeen, setRoomsWithE2ESeen] = useState({})
  const [slowmodeRemainingSeconds, setSlowmodeRemainingSeconds] = useState(0)
  const [rateLimitMessage, setRateLimitMessage] = useState('')
  const [welcomeMessages, setWelcomeMessages] = useState([])
  const currentRoomRef = useRef(currentRoom)
  const messagesRef = useRef([])

  useEffect(() => {
    currentRoomRef.current = currentRoom
  }, [currentRoom])

  // Room typing expiry (DM typing is handled in useDmMessages)
  useEffect(() => {
    const interval = setInterval(() => {
      const now = Date.now()
      setRoomTyping((prev) => {
        const next = { ...prev }
        let changed = false
        for (const u of Object.keys(next)) {
          if (now - next[u] > TYPING_EXPIRE_MS) {
            delete next[u]
            changed = true
          }
        }
        return changed ? next : prev
      })
    }, 1000)
    return () => clearInterval(interval)
  }, [])

  // Prune burned messages
  useEffect(() => {
    const interval = setInterval(() => {
      const now = Date.now()
      setMessages((prev) =>
        prev.filter(
          (m) => typeof m === 'string' || m.burnTs == null || now <= m.burnTs
        )
      )
    }, 60000)
    return () => clearInterval(interval)
  }, [])

  // Slowmode countdown
  useEffect(() => {
    if (slowmodeRemainingSeconds <= 0) return
    const id = setInterval(
      () => setSlowmodeRemainingSeconds((s) => (s <= 1 ? 0 : s - 1)),
      1000
    )
    return () => clearInterval(id)
  }, [slowmodeRemainingSeconds])

  /** Decrypt any pending e2e room messages once the room key arrives. */
  function decryptPendingForRoom(roomName) {
    const list = messagesRef.current
    if (!list?.length) return
    const roomE2eRe = /^\s*\[([^\]]+)\]: (e2e\..+)$/
    const tasks = []
    list.forEach((item) => {
      const line = typeof item === 'string' ? item : item.line
      const m = line.match(roomE2eRe)
      if (m)
        tasks.push(
          decryptRoomMessage(roomName, m[2]).then((dec) => ({ dec, m, line }))
        )
    })
    if (tasks.length === 0) return
    Promise.all(tasks).then((results) => {
      if (!mountedRef.current) return
      setMessages((prev) => {
        const next = [...prev]
        results.forEach(({ dec, m, line }) => {
          if (dec == null) return
          const newLine = `[${m[1]}]: ${dec}`
          const idx = next.findIndex(
            (msg) => (typeof msg === 'string' ? msg : msg.line) === line
          )
          if (idx !== -1)
            next[idx] =
              typeof next[idx] === 'string'
                ? newLine
                : { ...next[idx], line: newLine }
        })
        return next
      })
    })
  }

  /** Parse users list from a "Users in #..." server text block. */
  function handleUsersText(lines) {
    const userLines = lines.slice(1).filter((l) => l.startsWith('  - '))
    const users = userLines.map((l) => {
      const rest = l.replace(/^\s*-\s*/, '').trim()
      const idle = rest.endsWith(' (idle)')
      return { name: idle ? rest.slice(0, -7) : rest, idle }
    })
    setUsersInRoom(users)
  }

  /** Parse rooms list from a "Rooms:..." server text block. */
  function handleRoomsText(lines) {
    const roomRegex = /^\s*#(\S+)\s*\((\d+)\)/
    const rooms = lines
      .filter((l) => roomRegex.test(l))
      .map((l) => {
        const m = l.match(roomRegex)
        return { name: m[1], count: parseInt(m[2], 10) }
      })
    if (rooms.length) setRoomsList(rooms)
  }

  /**
   * Process one server text line for room-specific concerns.
   * Returns true if consumed (caller should not add to restLines).
   *
   * @param {string} line
   * @param {{ now: number, inviteCode: string, username: string, sessionParams: object }} ctx
   */
  function processRoomLine(line, { now, inviteCode, username, sessionParams }) {
    if (line.startsWith('welcome:')) {
      setWelcomeMessages((prev) => [...prev, line.slice(8).trim()])
      return true
    }
    if (line.startsWith('wrappedroomkey:')) {
      const parsed = parseWrappedRoomKeyLine(line)
      if (parsed && inviteCode.trim()) {
        unwrapRoomKeyFromServer(
          parsed.roomName,
          inviteCode.trim(),
          sessionParams?.slug || 'default',
          parsed.base64
        )
          .then(() => decryptPendingForRoom(parsed.roomName))
          .catch((err) => {
            console.error('[e2e] unwrap room key failed:', err)
          })
      }
      return true
    }
    const roomTypingMatch = line.match(/^\[typing\] (.+)$/)
    if (roomTypingMatch) {
      const who = roomTypingMatch[1].trim()
      if (who !== (username || '').trim())
        setRoomTyping((prev) => ({ ...prev, [who]: now }))
      return true
    }
    const slowmodeMatch = line.match(/^slowmode:(\d+)/)
    if (slowmodeMatch) {
      setSlowmodeRemainingSeconds(Math.max(0, parseInt(slowmodeMatch[1], 10)))
      return true
    }
    if (line.includes('Rate limited')) {
      setRateLimitMessage('Rate limited. Try again in a moment.')
      setTimeout(() => setRateLimitMessage(''), 3000)
      return true
    }
    return false
  }

  /**
   * After line filtering, finalize the room message batch:
   * - send room notification if document is hidden
   * - append to message list
   * - trigger E2E decryption for any e2e. lines
   * - generate + upload room key when joining without one
   *
   * @param {Array} restLines
   * @param {string|null} joinedRoomInBatch
   * @param {{ inviteCode: string, username: string, slug: string }} ctx
   */
  function finalizeRoomBatch(
    restLines,
    joinedRoomInBatch,
    { inviteCode, username, slug }
  ) {
    const roomNotify =
      document.hidden &&
      restLines.some((item) => {
        const l = typeof item === 'string' ? item : item.line
        const authorMatch = l.match(/^\s*\[([^\]]+)\]:/)
        return authorMatch && authorMatch[1].trim() !== (username || '').trim()
      })
    if (roomNotify && restLines.length > 0) {
      const first =
        typeof restLines[0] === 'string' ? restLines[0] : restLines[0].line
      showNotificationIfHidden(
        `The Bar — #${currentRoomRef.current}`,
        previewText(first)
      ).catch(() => {})
    }
    setMessages((prev) => {
      const next = [...prev, ...restLines]
      messagesRef.current = next
      return next
    })
    restLines.forEach((item) => {
      const line = typeof item === 'string' ? item : item.line
      const roomE2eMatch = line.match(/^\s*\[([^\]]+)\]: (e2e\..+)$/)
      if (!roomE2eMatch) return
      const room = currentRoomRef.current
      setRoomsWithE2ESeen((prev) =>
        prev[room] ? prev : { ...prev, [room]: true }
      )
      decryptRoomMessage(room, roomE2eMatch[2]).then((dec) => {
        if (!mountedRef.current) return
        const newLine =
          dec != null
            ? `[${roomE2eMatch[1]}]: ${dec}`
            : `[${roomE2eMatch[1]}]: Verification failed — message may have been tampered`
        setMessages((prev2) =>
          prev2.map((msg) => {
            const ml = typeof msg === 'string' ? msg : msg.line
            if (ml === line)
              return typeof msg === 'string'
                ? newLine
                : { ...msg, line: newLine }
            return msg
          })
        )
      })
    })
    // Only generate room key if we don't have one yet. Server sends existing wrapped key right
    // after "You joined #"; a short delay lets that message arrive first so the second+ joiner
    // won't generate a new key and overwrite.
    if (
      joinedRoomInBatch &&
      !hasRoomKey(joinedRoomInBatch) &&
      inviteCode.trim() &&
      wsRef.current?.readyState === WebSocket.OPEN
    ) {
      const room = joinedRoomInBatch
      const code = inviteCode.trim()
      setTimeout(() => {
        if (!hasRoomKey(room) && wsRef.current?.readyState === WebSocket.OPEN) {
          generateRoomKey(room)
            .then(() => wrapRoomKeyForServer(room, code, slug))
            .then((blob) => {
              if (blob && wsRef.current?.readyState === WebSocket.OPEN)
                wsRef.current.send(`wrappedroomkey:#${room}:${blob}`)
            })
            .catch((err) => {
              console.error('[e2e] room key generation/wrap failed:', err)
            })
        }
      }, 200)
    }
  }

  return {
    messages,
    messagesRef,
    roomsList,
    usersInRoom,
    currentRoom,
    setCurrentRoom,
    currentRoomRef,
    roomTyping,
    roomsWithE2ESeen,
    slowmodeRemainingSeconds,
    rateLimitMessage,
    welcomeMessages,
    decryptPendingForRoom,
    handleUsersText,
    handleRoomsText,
    processRoomLine,
    finalizeRoomBatch,
  }
}
