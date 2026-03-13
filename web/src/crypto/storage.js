/**
 * Storage abstraction for PQ+ key and ratchet persistence.
 * In the browser we use sessionStorage for ephemeral state and IndexedDB for
 * non-extractable CryptoKey objects (private key). When running in Tauri the same
 * code path runs; optional future: integrate tauri-plugin-store or OS keychain.
 * See https://the-b4r.netlify.app/wiki/e2e_protocol (Tauri key persistence).
 */

const IDB_NAME = 'thebar-e2e'
const IDB_VERSION = 1
const IDB_STORE = 'keys'
const PRIVATE_KEY_IDB_ID = 'ecdh-private'

function openKeyIDB() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB not available'))
      return
    }
    const req = indexedDB.open(IDB_NAME, IDB_VERSION)
    req.onupgradeneeded = (e) => {
      e.target.result.createObjectStore(IDB_STORE)
    }
    req.onsuccess = (e) => resolve(e.target.result)
    req.onerror = () => reject(req.error)
  })
}

/**
 * Retrieve the stored non-extractable ECDH private key from IndexedDB.
 * @returns {Promise<CryptoKey|null>}
 */
export async function getStoredPrivateKey() {
  try {
    const db = await openKeyIDB()
    return new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, 'readonly')
      const req = tx.objectStore(IDB_STORE).get(PRIVATE_KEY_IDB_ID)
      req.onsuccess = () => {
        db.close()
        resolve(req.result ?? null)
      }
      req.onerror = () => {
        db.close()
        reject(req.error)
      }
    })
  } catch {
    return null
  }
}

/**
 * Persist a non-extractable ECDH private key in IndexedDB.
 * @param {CryptoKey} key
 * @returns {Promise<boolean>}
 */
export async function storePrivateKey(key) {
  try {
    const db = await openKeyIDB()
    return new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, 'readwrite')
      const req = tx.objectStore(IDB_STORE).put(key, PRIVATE_KEY_IDB_ID)
      req.onsuccess = () => {
        db.close()
        resolve(true)
      }
      req.onerror = () => {
        db.close()
        reject(req.error)
      }
    })
  } catch {
    return false
  }
}

/**
 * Delete the stored private key from IndexedDB (e.g. on explicit key reset).
 * @returns {Promise<boolean>}
 */
export async function deleteStoredPrivateKey() {
  try {
    const db = await openKeyIDB()
    return new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, 'readwrite')
      const req = tx.objectStore(IDB_STORE).delete(PRIVATE_KEY_IDB_ID)
      req.onsuccess = () => {
        db.close()
        resolve(true)
      }
      req.onerror = () => {
        db.close()
        reject(req.error)
      }
    })
  } catch {
    return false
  }
}

/**
 * Whether the app is running inside the Tauri desktop shell.
 * @returns {boolean}
 */
export function isTauri() {
  return (
    typeof window !== 'undefined' &&
    (window.__TAURI_INTERNALS__ != null || window.__TAURI__ != null)
  )
}

/**
 * Get a value from session storage.
 * @param {string} key
 * @returns {string|null}
 */
export function getItem(key) {
  if (typeof sessionStorage === 'undefined') return null
  return sessionStorage.getItem(key)
}

/**
 * Set a value in session storage.
 * @param {string} key
 * @param {string} value
 */
export function setItem(key, value) {
  if (typeof sessionStorage === 'undefined') return
  sessionStorage.setItem(key, value)
}

/**
 * Remove a value from session storage.
 * @param {string} key
 */
export function removeItem(key) {
  if (typeof sessionStorage === 'undefined') return
  sessionStorage.removeItem(key)
}
