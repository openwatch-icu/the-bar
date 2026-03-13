/**
 * Cross-environment notifications: Web Notifications API in browser,
 * Tauri notification plugin in the desktop app. Only shows when the app
 * is in the background (document.hidden) so we don't ping while the user
 * is looking at the chat.
 */

const isTauri =
  typeof window !== 'undefined' &&
  (window.__TAURI_INTERNALS__ != null || window.__TAURI__ != null)

let tauriNotificationPromise = null
function getTauriNotification() {
  if (!tauriNotificationPromise) {
    tauriNotificationPromise = import('@tauri-apps/plugin-notification').catch(
      () => null
    )
  }
  return tauriNotificationPromise
}

/** Request permission. Call when user enters chat so we don't prompt on load. */
export async function requestNotificationPermission() {
  if (isTauri) {
    const notif = await getTauriNotification()
    if (!notif) return false
    const granted = await notif.isPermissionGranted()
    if (granted) return true
    const result = await notif.requestPermission()
    return result === 'granted'
  }
  if (typeof Notification === 'undefined') return false
  if (Notification.permission === 'granted') return true
  if (Notification.permission === 'denied') return false
  const result = await Notification.requestPermission()
  return result === 'granted'
}

/** Show a notification. No-op if app is in foreground or permission missing. */
export async function showNotificationIfHidden(title, body) {
  if (typeof document === 'undefined' || !document.hidden) return
  if (isTauri) {
    const notif = await getTauriNotification()
    if (!notif) return
    let granted = await notif.isPermissionGranted()
    if (!granted) {
      const result = await notif.requestPermission()
      granted = result === 'granted'
    }
    if (granted) notif.sendNotification({ title, body: body || '' })
    return
  }
  if (typeof Notification === 'undefined') return
  if (Notification.permission !== 'granted') return
  try {
    new Notification(title, { body: body || '', icon: '/favicon.ico' })
  } catch {
    // ignore
  }
}

/** One-line preview for notification body (no newlines, max length). */
export function previewText(text, maxLen = 80) {
  if (!text || typeof text !== 'string') return ''
  const one = text.replace(/\s+/g, ' ').trim()
  return one.length <= maxLen ? one : one.slice(0, maxLen - 1) + '…'
}
