import { useState, useEffect } from 'react'
import { getSessionInfoUrl } from '../utils/sessionUrl'

/**
 * Fetches session-info from the server for the given session params (bar_user_allowed,
 * session_bar_minutes, minimum_age, etc.). Used by ChatApp for login form and Settings.
 * @param {object} sessionParams - { wsBaseUrl?, slug? } for building session-info URL
 * @param {{ skip?: boolean }} options - skip: when true, do not fetch (e.g. desktop before URL is set)
 * @returns {{ sessionInfo: object | null, sessionInfoError: string | null }}
 */
export function useSessionInfo(sessionParams, options = {}) {
  const { skip = false } = options
  const [sessionInfo, setSessionInfo] = useState(null)
  const [sessionInfoError, setSessionInfoError] = useState(null)

  useEffect(() => {
    if (skip) {
      queueMicrotask(() => {
        setSessionInfo(null)
        setSessionInfoError(null)
      })
      return
    }
    const url = getSessionInfoUrl(sessionParams)
    if (!url) {
      queueMicrotask(() => {
        setSessionInfo(null)
        setSessionInfoError(null)
      })
      return
    }
    let cancelled = false
    queueMicrotask(() => {
      setSessionInfo(null)
      setSessionInfoError(null)
    })
    const ac = new AbortController()
    const timeoutId = setTimeout(() => ac.abort(), 10000)
    fetch(url, { signal: ac.signal })
      .then((res) => {
        if (!res.ok) throw new Error(res.statusText)
        return res.json()
      })
      .then((data) => {
        if (!cancelled) {
          setSessionInfo({
            bar_user_allowed: !!data.bar_user_allowed,
            session_bar_minutes:
              typeof data.session_bar_minutes === 'number'
                ? data.session_bar_minutes
                : 0,
            user_bar_max_minutes:
              typeof data.user_bar_max_minutes === 'number'
                ? data.user_bar_max_minutes
                : 2880,
            log_broadcast_body: !!data.log_broadcast_body,
            messages_persisted: !!data.messages_persisted,
            minimum_age:
              typeof data.minimum_age === 'number' ? data.minimum_age : 0,
          })
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setSessionInfo(null)
          setSessionInfoError(
            err.name === 'AbortError'
              ? 'Session info timed out. The server may be busy.'
              : err.message || 'Could not load session info'
          )
        }
      })
      .finally(() => clearTimeout(timeoutId))
    return () => {
      cancelled = true
      ac.abort()
      clearTimeout(timeoutId)
    }
  }, [skip, sessionParams])

  return { sessionInfo, sessionInfoError }
}
