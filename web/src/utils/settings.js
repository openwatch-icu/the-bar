// User settings stored on device (localStorage). Per-origin.

export const STORAGE_KEY_BAR_USER_MINUTES = 'thebar_bar_user_minutes'

const DEFAULT_BAR_USER_MINUTES = 0

/**
 * Get user's BAR (Burn After Reading) setting in minutes.
 * 0 = use session default only (no user override).
 * @returns {number}
 */
export function getBarUserMinutes() {
  try {
    const v = localStorage.getItem(STORAGE_KEY_BAR_USER_MINUTES)
    if (v == null || v === '') return DEFAULT_BAR_USER_MINUTES
    const n = parseInt(v, 10)
    return Number.isFinite(n) && n >= 0 ? n : DEFAULT_BAR_USER_MINUTES
  } catch {
    return DEFAULT_BAR_USER_MINUTES
  }
}

/**
 * Set user's BAR in minutes. 0 = use session default only.
 * @param {number} minutes
 */
export function setBarUserMinutes(minutes) {
  try {
    const n = Number(minutes)
    localStorage.setItem(
      STORAGE_KEY_BAR_USER_MINUTES,
      String(Number.isFinite(n) && n >= 0 ? n : 0)
    )
  } catch {
    // ignore (e.g. localStorage disabled or quota exceeded)
  }
}

const AGE_CONFIRMED_PREFIX = 'thebar_age_confirmed_'

/**
 * Get whether the user has confirmed age for this origin and instance (for age-restricted servers).
 * @param {string} originOrSlugKey - e.g. origin + "_" + slug to scope per instance
 * @returns {boolean}
 */
export function getAgeConfirmedForInstance(originOrSlugKey) {
  try {
    return (
      localStorage.getItem(AGE_CONFIRMED_PREFIX + (originOrSlugKey || '')) ===
      '1'
    )
  } catch {
    return false
  }
}

/**
 * Store that the user confirmed age for this origin/instance (so reconnect can send ageconfirmed again).
 * @param {string} originOrSlugKey
 */
export function setAgeConfirmedForInstance(originOrSlugKey) {
  try {
    localStorage.setItem(AGE_CONFIRMED_PREFIX + (originOrSlugKey || ''), '1')
  } catch {
    // ignore
  }
}
