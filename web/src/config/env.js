/**
 * Centralized access to Vite/build-time env. Safe when import.meta is absent (e.g. tests).
 */

export function getEnv(name, fallback) {
  if (typeof import.meta === 'undefined' || !import.meta.env) return fallback
  const v = import.meta.env[name]
  return v != null && String(v).trim() !== '' ? String(v).trim() : fallback
}

/** True when running in Vite dev mode (import.meta.env.DEV). */
export function isDev() {
  return typeof import.meta !== 'undefined' && import.meta.env?.DEV === true
}
