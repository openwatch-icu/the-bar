import { useState, useRef, useEffect } from 'react'
import { getWsUrl } from '../utils/sessionUrl'

/**
 * Manages WebSocket lifecycle for the chat connection: open with join line,
 * send lines, receive raw text, and close. Does not parse protocol or hold chat state.
 * @param {object} sessionParams - { wsBaseUrl?, slug? } for building WS URL
 * @returns {{ wsRef, isOpen, open, close, sendLine, setOnMessage }}
 */
export function useWsTransport(sessionParams) {
  const [isOpen, setIsOpen] = useState(false)
  const wsRef = useRef(null)
  const onMessageRef = useRef(null)

  const setOnMessage = (callback) => {
    onMessageRef.current = callback
  }

  const sendLine = (line) => {
    const ws = wsRef.current
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(line)
    }
  }

  const close = () => {
    const ws = wsRef.current
    if (ws) {
      ws.close()
      wsRef.current = null
    }
    setIsOpen(false)
  }

  const open = (joinLine, options = {}) => {
    const { onOpen, connectionTimeoutMs = 10000 } = options
    const wsUrl = getWsUrl(sessionParams)
    const ws = new WebSocket(wsUrl)
    wsRef.current = ws

    const connectionTimeout = setTimeout(() => {
      if (ws.readyState === WebSocket.CONNECTING) {
        ws.close()
        if (options.onConnectionTimeout) options.onConnectionTimeout()
      }
    }, connectionTimeoutMs)

    ws.onopen = () => {
      clearTimeout(connectionTimeout)
      setIsOpen(true)
      ws.send(joinLine)
      onOpen?.()
    }

    ws.onmessage = (event) => {
      const text = event.data
      if (typeof text !== 'string') return
      onMessageRef.current?.(text)
    }

    ws.onclose = () => {
      wsRef.current = null
      setIsOpen(false)
      if (options.onClose) options.onClose()
    }

    ws.onerror = () => {
      if (options.onError) options.onError()
    }
  }

  useEffect(() => {
    return () => {
      const ws = wsRef.current
      if (ws) ws.close()
      wsRef.current = null
      setIsOpen(false)
    }
  }, [])

  return { wsRef, isOpen, open, close, sendLine, setOnMessage }
}
