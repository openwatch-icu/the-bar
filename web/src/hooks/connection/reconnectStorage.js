import { STORAGE_KEY_RECONNECT } from '../../utils/sessionUrl'

let initialReconnectCache = null

export function getInitialReconnectFromStorage() {
  if (initialReconnectCache) return initialReconnectCache
  try {
    const saved = localStorage.getItem(STORAGE_KEY_RECONNECT)
    const match = saved?.match(/^reconnect:([^:]+):(.+)$/)
    initialReconnectCache = match
      ? { username: match[1], token: match[2] }
      : { username: '', token: '' }
  } catch {
    initialReconnectCache = { username: '', token: '' }
  }
  return initialReconnectCache
}

/** Clears the cached initial reconnect so the next getInitialReconnectFromStorage() reads from localStorage again. Call after "Forget my session". */
export function clearReconnectCache() {
  initialReconnectCache = null
}
