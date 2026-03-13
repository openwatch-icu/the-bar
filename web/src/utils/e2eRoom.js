/**
 * E2E for room messages: per-room symmetric key (AES-256-GCM).
 * Uses PQ+ crypto module for versioned message format. Room key distribution via
 * handshake (wrapped with access-code-derived key) or encrypted DM (ROOMKEY:#roomname:base64key).
 * Server stores and forwards opaque e2e. payloads only.
 *
 * Wrap key KDF versions:
 *   v0 (legacy): raw SHA-256 of accessCode+slug+room+salt → AES key. Wire: iv(12)||ct(48) = 60 bytes.
 *   v1 (current): PBKDF2-SHA256 100k iterations. Wire: 0x01||iv(12)||ct(48) = 61 bytes.
 * On unwrap, v0 blobs are detected by length (60 bytes) and unwrapped with the old KDF.
 * All new wraps use v1. Re-wrap happens automatically on the next wrapRoomKeyForServer call.
 */

import {
  E2E_PREFIX,
  getCrypto,
  buildE2EMessageLine,
  parseAndDecryptE2ELine,
} from '../crypto/index'

export { E2E_PREFIX }
const ROOMKEY_PREFIX = 'ROOMKEY:'
const WRAPPED_ROOMKEY_PREFIX = 'wrappedroomkey:'
const ROOM_KEY_DERIVE_SALT = 'the-bar-room-key-v1'

// Wrapped room key blob version bytes.
const WRAP_VERSION_PBKDF2 = 0x01

// Max base64 length of a wrapped room key blob (61 bytes raw → 84 base64 chars; 128 is generous).
const MAX_WRAPPED_KEY_B64 = 128
// Max base64 length of a raw AES-256 key (32 bytes → 44 chars; 64 is generous).
const MAX_RAW_KEY_B64 = 64

const roomKeys = new Map() // roomName -> CryptoKey (AES-GCM)

/**
 * Legacy SHA-256 wrap key KDF. Used only during migration unwrap of v0 blobs.
 * @param {string} accessCode
 * @param {string} instanceSlug
 * @param {string} roomName
 * @returns {Promise<CryptoKey>}
 */
async function deriveWrapKeySHA256(accessCode, instanceSlug, roomName) {
  const subtle = getCrypto()
  const str =
    (accessCode || '') +
    (instanceSlug || 'default') +
    (roomName || '').trim().replace(/^#/, '') +
    ROOM_KEY_DERIVE_SALT
  const encoded = new TextEncoder().encode(str)
  const hash = await subtle.digest('SHA-256', encoded)
  return subtle.importKey('raw', hash, { name: 'AES-GCM' }, false, [
    'encrypt',
    'decrypt',
  ])
}

/**
 * PBKDF2-SHA256 wrap key KDF (v1, current). 100k iterations; access code as password,
 * slug+room+salt as salt.
 * @param {string} accessCode
 * @param {string} instanceSlug
 * @param {string} roomName
 * @returns {Promise<CryptoKey>}
 */
async function deriveWrapKeyPBKDF2(accessCode, instanceSlug, roomName) {
  const subtle = getCrypto()
  const password = new TextEncoder().encode(accessCode || '')
  const saltStr =
    (instanceSlug || 'default') +
    (roomName || '').trim().replace(/^#/, '') +
    ROOM_KEY_DERIVE_SALT
  const salt = new TextEncoder().encode(saltStr)
  const keyMaterial = await subtle.importKey('raw', password, 'PBKDF2', false, [
    'deriveKey',
  ])
  return subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: 100_000, hash: 'SHA-256' },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  )
}

/**
 * Wrap the room key for this room and return base64(version||iv||ciphertext) to send
 * to server using v1 (PBKDF2) KDF. Returns null if no room key or wrap fails.
 * @param {string} roomName
 * @param {string} accessCode
 * @param {string} instanceSlug
 * @returns {Promise<string|null>}
 */
export async function wrapRoomKeyForServer(roomName, accessCode, instanceSlug) {
  const name = (roomName || '').trim().replace(/^#/, '')
  if (!name || !accessCode) return null
  const key = getRoomKey(name)
  if (!key) return null
  try {
    const raw = await getCrypto().exportKey('raw', key)
    const wrapKey = await deriveWrapKeyPBKDF2(accessCode, instanceSlug, name)
    const iv = crypto.getRandomValues(new Uint8Array(12))
    const ciphertext = await getCrypto().encrypt(
      { name: 'AES-GCM', iv, tagLength: 128 },
      wrapKey,
      raw
    )
    // v1 format: version(1) || iv(12) || ciphertext(48) = 61 bytes
    const combined = new Uint8Array(1 + iv.length + ciphertext.byteLength)
    combined[0] = WRAP_VERSION_PBKDF2
    combined.set(iv, 1)
    combined.set(new Uint8Array(ciphertext), 1 + iv.length)
    return btoa(String.fromCharCode(...combined))
  } catch {
    return null
  }
}

/**
 * Unwrap a room key from server blob (received as wrappedroomkey:#room:base64).
 * Detects v0 (SHA-256, 60 bytes) vs v1 (PBKDF2, 61 bytes) by blob length.
 * @param {string} roomName room name (with or without #)
 * @param {string} accessCode
 * @param {string} instanceSlug
 * @param {string} wrappedBase64
 * @returns {Promise<boolean>}
 */
export async function unwrapRoomKeyFromServer(
  roomName,
  accessCode,
  instanceSlug,
  wrappedBase64
) {
  const name = (roomName || '').trim().replace(/^#/, '')
  if (!name || !accessCode || !wrappedBase64) return false
  if (wrappedBase64.length > MAX_WRAPPED_KEY_B64) return false
  try {
    const bin = Uint8Array.from(atob(wrappedBase64), (c) => c.charCodeAt(0))
    let iv, ciphertext, wrapKey
    if (bin.length === 61 && bin[0] === WRAP_VERSION_PBKDF2) {
      // v1: PBKDF2-SHA256
      iv = bin.slice(1, 13)
      ciphertext = bin.slice(13)
      wrapKey = await deriveWrapKeyPBKDF2(accessCode, instanceSlug, name)
    } else if (bin.length === 60) {
      // v0: legacy SHA-256 (no version byte)
      iv = bin.slice(0, 12)
      ciphertext = bin.slice(12)
      wrapKey = await deriveWrapKeySHA256(accessCode, instanceSlug, name)
    } else {
      return false
    }
    const raw = await getCrypto().decrypt(
      { name: 'AES-GCM', iv, tagLength: 128 },
      wrapKey,
      ciphertext
    )
    const roomKey = await getCrypto().importKey(
      'raw',
      raw,
      { name: 'AES-GCM' },
      false,
      ['encrypt', 'decrypt']
    )
    roomKeys.set(name, roomKey)
    return true
  } catch {
    return false
  }
}

/**
 * Parse a server line "wrappedroomkey:#room:base64". Returns { roomName, base64 } or null.
 * @param {string} line
 * @returns {{ roomName: string, base64: string }|null}
 */
export function parseWrappedRoomKeyLine(line) {
  if (!line || !line.startsWith(WRAPPED_ROOMKEY_PREFIX)) return null
  const rest = line.slice(WRAPPED_ROOMKEY_PREFIX.length).trim()
  const lastColon = rest.lastIndexOf(':')
  if (lastColon <= 0) return null
  const roomName = rest.slice(0, lastColon).trim().replace(/^#/, '')
  const base64 = rest.slice(lastColon + 1).trim()
  if (!roomName || !base64) return null
  return { roomName, base64 }
}

/**
 * Generate and store a new room key for the given room. Idempotent per room.
 * @param {string} roomName
 * @returns {Promise<boolean>}
 */
export async function generateRoomKey(roomName) {
  const name = (roomName || '').trim()
  if (!name) return false
  if (roomKeys.has(name)) return true
  try {
    const key = await getCrypto().generateKey(
      { name: 'AES-GCM', length: 256 },
      true,
      ['encrypt', 'decrypt']
    )
    roomKeys.set(name, key)
    return true
  } catch {
    return false
  }
}

/**
 * Get the room key if we have one.
 * @param {string} roomName
 * @returns {CryptoKey|null}
 */
export function getRoomKey(roomName) {
  return roomKeys.get((roomName || '').trim()) ?? null
}

/**
 * Set room key from raw key bytes (e.g. after receiving ROOMKEY via DM). Base64-encoded.
 * @param {string} roomName
 * @param {string} base64Key
 * @returns {Promise<boolean>}
 */
export async function setRoomKeyFromBase64(roomName, base64Key) {
  const name = (roomName || '').trim()
  if (!name || !base64Key) return false
  if (base64Key.length > MAX_RAW_KEY_B64) return false
  try {
    const bin = Uint8Array.from(atob(base64Key), (c) => c.charCodeAt(0))
    const key = await getCrypto().importKey(
      'raw',
      bin,
      { name: 'AES-GCM' },
      false,
      ['encrypt', 'decrypt']
    )
    roomKeys.set(name, key)
    return true
  } catch {
    return false
  }
}

/**
 * Export room key as base64 (for distribution via DM). Returns null if no key.
 * @param {string} roomName
 * @returns {Promise<string|null>}
 */
export async function exportRoomKeyBase64(roomName) {
  const key = getRoomKey(roomName)
  if (!key) return null
  try {
    const raw = await getCrypto().exportKey('raw', key)
    return btoa(String.fromCharCode(...new Uint8Array(raw)))
  } catch {
    return null
  }
}

/**
 * Check if we have E2E key for this room.
 * @param {string} roomName
 * @returns {boolean}
 */
export function hasRoomKey(roomName) {
  return roomKeys.has((roomName || '').trim())
}

/**
 * Encrypt a room message. Returns e2e.<base64(versioned payload)> or null.
 * @param {string} roomName
 * @param {string} plaintext
 * @returns {Promise<string|null>}
 */
export async function encryptRoomMessage(roomName, plaintext) {
  const key = getRoomKey(roomName)
  if (!key) return null
  return buildE2EMessageLine(key, plaintext)
}

/**
 * Decrypt a room message payload (content starting with e2e.). PQ+ versioned format only.
 * @param {string} roomName
 * @param {string} payload e.g. "e2e.xxxx"
 * @returns {Promise<string|null>}
 */
export async function decryptRoomMessage(roomName, payload) {
  if (!payload || !payload.startsWith(E2E_PREFIX)) return null
  const key = getRoomKey(roomName)
  if (!key) return null
  return parseAndDecryptE2ELine(payload, key)
}

/**
 * Format for sending room key to a peer via E2E DM: "ROOMKEY:#roomname:base64key".
 * Recipient should parse and call setRoomKeyFromBase64(roomName, base64key).
 * @param {string} roomName e.g. "general" (with or without #)
 * @returns {Promise<string|null>}
 */
export async function getRoomKeyMessageForDm(roomName) {
  const name = (roomName || '').trim().replace(/^#/, '')
  if (!name) return null
  const b64 = await exportRoomKeyBase64(name)
  if (!b64) return null
  return `${ROOMKEY_PREFIX}#${name}:${b64}`
}

/**
 * Parse DM content that might be a room key. If it matches ROOMKEY:#roomname:base64, set the room key.
 * @param {string} dmContent decrypted DM body
 * @returns {Promise<{ roomName: string }|null>} room name (with #) if it was a room key message
 */
export async function tryParseAndStoreRoomKey(dmContent) {
  if (!dmContent || !dmContent.startsWith(ROOMKEY_PREFIX)) return null
  const rest = dmContent.slice(ROOMKEY_PREFIX.length).trim()
  // Room name can contain colons (e.g. private:comms); base64 key cannot. Split on last colon.
  const lastColon = rest.lastIndexOf(':')
  if (lastColon <= 0) return null
  const roomName = rest.slice(0, lastColon).trim().replace(/^#/, '')
  const base64 = rest.slice(lastColon + 1).trim()
  if (!roomName || !base64) return null
  const ok = await setRoomKeyFromBase64(roomName, base64)
  return ok ? { roomName: '#' + roomName } : null
}

export { ROOMKEY_PREFIX }
