import { useState, useRef, useEffect } from 'react'
import {
  getDmKeyLineForPeer,
  setPeerPublicKey,
  encryptForPeer,
  decryptFromPeer,
} from '../../utils/e2eDM'
import {
  tryParseAndStoreRoomKey,
  getRoomKeyMessageForDm,
} from '../../utils/e2eRoom'
import {
  showNotificationIfHidden,
  previewText,
} from '../../utils/notifications'
import { TYPING_EXPIRE_MS, TYPING_DEBOUNCE_MS } from './constants'

/**
 * Manages DM thread state, key exchange, message processing, and DM send actions.
 *
 * @param {{ wsRef: React.MutableRefObject, mountedRef: React.MutableRefObject,
 *           username: string }} opts
 */
export function useDmMessages({ wsRef, mountedRef, username }) {
  const [dmThreads, setDmThreads] = useState({})
  const [dmView, setDmView] = useState(null)
  const [dmInputValue, setDmInputValue] = useState('')
  const [dmTypingFrom, setDmTypingFrom] = useState(null)
  const [dmTypingAt, setDmTypingAt] = useState(0)
  const dmMessagesEndRef = useRef(null)
  const dmViewRef = useRef(dmView)
  /** Peers we've already sent our DM key to this session. Prevents ping-pong. */
  const sentKeyToPeersRef = useRef(new Set())
  const dmTypingDebounceRef = useRef(null)

  useEffect(() => {
    dmViewRef.current = dmView
  }, [dmView])

  // DM typing expiry
  useEffect(() => {
    const interval = setInterval(() => {
      const now = Date.now()
      if (dmTypingFrom && now - dmTypingAt > TYPING_EXPIRE_MS) {
        setDmTypingFrom(null)
        setDmTypingAt(0)
      }
    }, 1000)
    return () => clearInterval(interval)
  }, [dmTypingFrom, dmTypingAt])

  // Send our E2E public key when opening a DM conversation
  useEffect(() => {
    if (
      !dmView ||
      !wsRef.current ||
      wsRef.current.readyState !== WebSocket.OPEN
    )
      return
    let cancelled = false
    getDmKeyLineForPeer(dmView).then((line) => {
      if (!cancelled && line && wsRef.current?.readyState === WebSocket.OPEN)
        wsRef.current.send(line)
    })
    return () => {
      cancelled = true
    }
  }, [dmView, wsRef])

  /**
   * Process DM control lines (dmkey:, [typing-dm]).
   * Returns true if the line was consumed.
   */
  function processDmControlLine(line, now) {
    if (line.startsWith('dmkey:')) {
      const parts = line.split(':')
      if (parts.length >= 3) {
        const sender = parts[1].trim()
        const base64 = parts.slice(2).join(':').trim()
        if (sender && base64) {
          setPeerPublicKey(sender, base64)
            .then(() => {
              // Send our key back once per peer per session so the other side
              // gets it (e.g. after they refreshed). Avoids ping-pong.
              if (
                !sentKeyToPeersRef.current.has(sender) &&
                wsRef.current?.readyState === WebSocket.OPEN
              ) {
                return getDmKeyLineForPeer(sender).then((keyLine) => {
                  if (keyLine) {
                    wsRef.current.send(keyLine)
                    sentKeyToPeersRef.current.add(sender)
                  }
                })
              }
            })
            .catch((err) => {
              console.error('[e2e] DM key exchange failed:', err)
            })
        }
      }
      return true
    }
    const dmTypingMatch = line.match(/^\[typing-dm\] (.+)$/)
    if (dmTypingMatch) {
      setDmTypingFrom(dmTypingMatch[1].trim())
      setDmTypingAt(now)
      return true
    }
    return false
  }

  /**
   * Returns true if the line is a "Message sent to X" echo for the active DM.
   * These should be silently filtered from the room message list.
   */
  function isDmSentEcho(line) {
    if (!dmViewRef.current) return false
    return !!line.match(
      new RegExp(
        `^Message sent to ${dmViewRef.current.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\.?$`
      )
    )
  }

  /**
   * Process an incoming DM message line ([From X]: ...).
   * Returns true if consumed.
   */
  function processDmMessageLine(line) {
    const m = line.match(/^\[From ([^\]]+)\]: (.+)$/)
    if (!m) return false
    const from = m[1].trim()
    const content = m[2]
    const shouldNotifyDm = document.hidden || dmViewRef.current !== from
    if (content.startsWith('e2e.')) {
      decryptFromPeer(from, content).then((dec) => {
        if (!mountedRef.current) return
        if (dec?.startsWith('ROOMKEY:')) {
          tryParseAndStoreRoomKey(dec).then((roomInfo) => {
            if (!mountedRef.current) return
            const display = roomInfo
              ? `Room key for ${roomInfo.roomName} received`
              : 'Room key invalid or message may have been tampered'
            setDmThreads((prev) => ({
              ...prev,
              [from]: [
                ...(prev[from] || []),
                { from, content: display, outgoing: false },
              ],
            }))
          })
        } else {
          const display =
            dec ??
            'Could not decrypt — keys out of sync. Sent our key to sender; ask them to send again.'
          setDmThreads((prev) => ({
            ...prev,
            [from]: [
              ...(prev[from] || []),
              { from, content: display, outgoing: false },
            ],
          }))
          if (dec == null && wsRef.current?.readyState === WebSocket.OPEN) {
            getDmKeyLineForPeer(from).then((keyLine) => {
              if (keyLine && wsRef.current?.readyState === WebSocket.OPEN)
                wsRef.current.send(keyLine)
            })
          }
        }
      })
      if (shouldNotifyDm)
        showNotificationIfHidden(
          `The Bar — DM from ${from}`,
          'New message'
        ).catch(() => {})
    } else {
      setDmThreads((prev) => ({
        ...prev,
        [from]: [...(prev[from] || []), { from, content, outgoing: false }],
      }))
      if (shouldNotifyDm)
        showNotificationIfHidden(
          `The Bar — DM from ${from}`,
          previewText(content)
        ).catch(() => {})
    }
    return true
  }

  /**
   * Send an encrypted DM to the current dmView peer.
   * Returns an error string on failure, empty string on success, or null if nothing to do.
   */
  const handleDmSend = async (e) => {
    e?.preventDefault()
    const content = dmInputValue.trim()
    if (
      !content ||
      !dmView ||
      !wsRef.current ||
      wsRef.current.readyState !== WebSocket.OPEN
    )
      return null
    const encrypted = await encryptForPeer(dmView, content)
    if (!encrypted)
      return 'Secure session not ready. Exchange keys with this user first (e.g. click "Send my key").'
    wsRef.current.send(`/msg ${dmView} ${encrypted}`)
    setDmThreads((prev) => ({
      ...prev,
      [dmView]: [
        ...(prev[dmView] || []),
        { from: username.trim() || 'Guest', content, outgoing: true },
      ],
    }))
    setDmInputValue('')
    return ''
  }

  /** Re-send our E2E public key to a DM peer (e.g. to fix "Could not decrypt"). */
  const resendDmKey = async (peerUsername) => {
    if (
      !peerUsername?.trim() ||
      !wsRef.current ||
      wsRef.current.readyState !== WebSocket.OPEN
    )
      return
    const line = await getDmKeyLineForPeer(peerUsername.trim())
    if (line) wsRef.current.send(line)
  }

  const sendDmTyping = () => {
    if (dmView && wsRef.current?.readyState === WebSocket.OPEN)
      wsRef.current.send(`/typing-dm ${dmView}`)
  }

  const scheduleDmTyping = () => {
    if (dmTypingDebounceRef.current) clearTimeout(dmTypingDebounceRef.current)
    dmTypingDebounceRef.current = setTimeout(sendDmTyping, TYPING_DEBOUNCE_MS)
  }

  /**
   * Send the current room's E2E key to a peer via an encrypted DM.
   * Also sends our DM public key first so the peer can decrypt it.
   */
  const sendRoomKeyToUser = async (peerUsername, currentRoom) => {
    if (
      !currentRoom ||
      !peerUsername ||
      !wsRef.current ||
      wsRef.current.readyState !== WebSocket.OPEN
    )
      return
    const keyLine = await getDmKeyLineForPeer(peerUsername)
    if (keyLine) wsRef.current.send(keyLine)
    // Brief delay so recipient processes dmkey before the encrypted room key message
    await new Promise((r) => setTimeout(r, 200))
    const msg = await getRoomKeyMessageForDm(currentRoom)
    if (!msg) return
    const enc = await encryptForPeer(peerUsername, msg)
    if (enc) wsRef.current.send(`/msg ${peerUsername} ${enc}`)
  }

  return {
    dmThreads,
    setDmThreads,
    dmView,
    setDmView,
    dmInputValue,
    setDmInputValue,
    dmTypingFrom,
    dmTypingAt,
    dmMessagesEndRef,
    dmViewRef,
    sentKeyToPeersRef,
    dmTypingDebounceRef,
    processDmControlLine,
    isDmSentEcho,
    processDmMessageLine,
    handleDmSend,
    resendDmKey,
    scheduleDmTyping,
    sendRoomKeyToUser,
  }
}
