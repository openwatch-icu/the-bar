import { useState } from 'react'
import { getInitialReconnectFromStorage } from './reconnectStorage'

/**
 * Manages reconnect token state (stored in localStorage and in React state).
 * The handleReconnect function lives in useConnection.js because it needs access
 * to many shared setters, but the token values are owned here.
 */
export function useReconnect() {
  const [reconnectToken, setReconnectToken] = useState(
    () => getInitialReconnectFromStorage().token
  )
  const [reconnectTip, setReconnectTip] = useState('')

  return { reconnectToken, setReconnectToken, reconnectTip, setReconnectTip }
}
