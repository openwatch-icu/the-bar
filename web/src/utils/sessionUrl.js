// Session/URL helpers: instance slug, WebSocket URL, stored reconnect token.
// Session override when using desktop app "Join": { wsBaseUrl, slug }
// Default base URL: VITE_WS_URL, or built from VITE_HTTP_SCHEME / VITE_SERVER_HOST / VITE_SERVER_PORT, or http://localhost:8080.

import { getEnv } from '../config/env'

/** True when running inside the Tauri desktop app. */
export const isTauriEnv =
  typeof window !== 'undefined' &&
  (window.__TAURI_INTERNALS__ != null || window.__TAURI__ != null)

/** Default server base URL. Web: from VITE_WS_URL, or same origin as the page (visit xyz.com/bar → use xyz.com). Desktop: from env only, no default so user enters any URL. */
export function getDefaultWsBaseUrl() {
  const full = getEnv('VITE_WS_URL', '')
  if (full) return full.replace(/\/$/, '')
  // Desktop app: no baked-in default; user enters URL in Join form.
  if (isTauriEnv) return ''
  // Web app: when no env, use current origin so visiting www.xyz.com/bar auto-connects to that host.
  if (typeof window !== 'undefined' && window.location?.origin)
    return window.location.origin
  const scheme = getEnv('VITE_HTTP_SCHEME', 'http')
  const host = getEnv('VITE_SERVER_HOST', 'localhost')
  const port = getEnv('VITE_SERVER_PORT', '8080')
  return `${scheme.replace(/\/$/, '').replace(/:$/, '')}://${host.replace(/\/$/, '')}:${port}`
}

/** Scheme (http or https) to use when building URLs (e.g. for Launch). Matches VITE_WS_URL when set. */
export function getDefaultScheme() {
  const url = getEnv('VITE_WS_URL', '')
  return url.toLowerCase().startsWith('https') ? 'https' : 'http'
}

/** Default server port (e.g. 8080). From VITE_WS_URL or VITE_SERVER_PORT. */
export function getDefaultPort() {
  const url = getEnv('VITE_WS_URL', '')
  if (url) {
    try {
      const u = new URL(url)
      if (u.port) return u.port
    } catch {
      // ignore
    }
  }
  return getEnv('VITE_SERVER_PORT', '8080')
}

export const DESKTOP_STORAGE_LAST_JOIN = 'thebar_desktop_last_join'
export const DESKTOP_STORAGE_LAST_JOIN_SLUG = 'thebar_desktop_last_join_slug'
export const STORAGE_KEY_RECONNECT = 'thebar_reconnect'

/** App base path (e.g. "/bar") when chat app is under a subpath. Used for slug resolution and later bar.* subdomain. */
export function getAppBasePath() {
  const base = getEnv('VITE_APP_BASE_PATH', '')
  return base ? base.replace(/\/$/, '') : ''
}

/** Instance slug: from sessionOverride, or from path (after stripping base path), or env default. */
export function getInstanceSlug(sessionOverride) {
  if (sessionOverride?.slug) return sessionOverride.slug
  const path =
    (typeof window !== 'undefined' && window.location?.pathname) || ''
  const base = getAppBasePath()
  const pathAfterBase = base
    ? path.replace(
        new RegExp(`^${base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\/?`),
        ''
      )
    : path
  const segment = pathAfterBase.replace(/^\//, '').split('/')[0]
  // Use path segment only if it's a real slug; "default" means "no path" so env wins (e.g. VITE_INSTANCE_SLUG=bar for local Docker).
  if (segment && segment !== 'default') return segment
  return (
    (getEnv('VITE_INSTANCE_SLUG', 'default') || 'default').trim() || 'default'
  )
}

export function getWsUrl(sessionOverride) {
  const base =
    sessionOverride?.wsBaseUrl ||
    getEnv('VITE_WS_URL', '') ||
    getDefaultWsBaseUrl()
  const wsBase = base.replace(/^http/, 'ws')
  const slug = getInstanceSlug(sessionOverride)
  return `${wsBase}/${slug}/ws`
}

/** Session-info API URL for the given session params (used to fetch bar_user_allowed, minimum_age, etc.). */
export function getSessionInfoUrl(sessionParams) {
  const base =
    getEnv('VITE_WS_URL', '') ||
    sessionParams?.wsBaseUrl ||
    getDefaultWsBaseUrl()
  if (!base) return null
  const slug =
    (sessionParams?.slug || getInstanceSlug(sessionParams))
      ?.toString?.()
      ?.trim() || 'default'
  return `${base.replace(/\/$/, '')}/${slug}/session-info`
}

export function getStoredTokenKey(slug, username) {
  return `thebar_reconnect_${slug}_${username}`
}

export function getStoredToken(slug, username) {
  try {
    return localStorage.getItem(getStoredTokenKey(slug, username?.trim()))
  } catch {
    return null
  }
}

export function setStoredToken(slug, username, token) {
  try {
    localStorage.setItem(getStoredTokenKey(slug, username), token)
  } catch {
    // ignore (e.g. localStorage disabled or quota exceeded)
  }
}

/** Clears the stored reconnect token for this instance (and optionally username). Call before re-joining with plain username when ALLOW_JOIN_WITHOUT_TOKEN is enabled. */
export function clearStoredToken(slug, username) {
  try {
    if (slug && username) {
      localStorage.removeItem(getStoredTokenKey(slug, username))
    }
    localStorage.removeItem(STORAGE_KEY_RECONNECT)
  } catch {
    // ignore
  }
}
