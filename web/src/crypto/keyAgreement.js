/**
 * Key agreement for PQ+ E2E (v1: ECDH P-256). Used by DM and later by hybrid PQ.
 * See https://the-b4r.netlify.app/wiki/e2e_protocol.
 *
 * Keypair identity: public key JWK stored in localStorage (not secret); private key
 * stored as a non-extractable CryptoKey in IndexedDB so XSS cannot call exportKey()
 * to recover raw bytes. That keeps DM verification stable across refresh/reconnect.
 *
 * Migration: on first load after this update, any legacy keypair (both keys as JWK in
 * localStorage under KEYPAIR_STORAGE_KEY) is re-imported with extractable:false for
 * the private key, persisted to IndexedDB, and the old localStorage entry is removed.
 */

import { getCrypto } from './cryptoPrimitives'
import { deriveAesKeyFromEcdh, deriveDmSessionKeysFromEcdhBits } from './kdf'
import { getStoredPrivateKey, storePrivateKey } from './storage'

// Legacy key: both keys as JWK (migration only; remove from localStorage on first load).
const KEYPAIR_STORAGE_KEY = 'thebar-e2e-keypair'
// Current: only the public key JWK (not secret, safe in localStorage).
const PUBLIC_KEY_STORAGE_KEY = 'thebar-e2e-pubkey'

let keypairCache = null

function getKeypairStorage() {
  if (typeof localStorage !== 'undefined') return localStorage
  if (typeof sessionStorage !== 'undefined') return sessionStorage
  return null
}

/**
 * Return the ECDH P-256 keypair for this identity, creating or migrating it as needed.
 * Private key is non-extractable (IndexedDB); public key is exportable (localStorage JWK).
 * @returns {Promise<{ publicKey: CryptoKey, privateKey: CryptoKey }>}
 */
export async function generateKeypair() {
  if (keypairCache) return keypairCache
  const subtle = getCrypto()
  const storage = getKeypairStorage()

  // 1. Try IndexedDB (non-extractable private key + public key JWK in localStorage).
  const storedPrivate = await getStoredPrivateKey()
  if (storedPrivate) {
    try {
      const pubJwk =
        storage && JSON.parse(storage.getItem(PUBLIC_KEY_STORAGE_KEY) || 'null')
      if (pubJwk) {
        const publicKey = await subtle.importKey(
          'jwk',
          pubJwk,
          { name: 'ECDH', namedCurve: 'P-256' },
          true,
          []
        )
        keypairCache = { publicKey, privateKey: storedPrivate }
        return keypairCache
      }
    } catch {
      // fall through to migration / generation
    }
  }

  // 2. Migrate from old localStorage keypair (both keys stored as JWK).
  try {
    const stored = storage && storage.getItem(KEYPAIR_STORAGE_KEY)
    if (stored) {
      const { publicKey: pubJwk, privateKey: privJwk } = JSON.parse(stored)
      const [publicKey, privateKey] = await Promise.all([
        subtle.importKey(
          'jwk',
          pubJwk,
          { name: 'ECDH', namedCurve: 'P-256' },
          true,
          []
        ),
        subtle.importKey(
          'jwk',
          privJwk,
          { name: 'ECDH', namedCurve: 'P-256' },
          false, // non-extractable
          ['deriveBits']
        ),
      ])
      await storePrivateKey(privateKey)
      if (storage) {
        storage.setItem(PUBLIC_KEY_STORAGE_KEY, JSON.stringify(pubJwk))
        storage.removeItem(KEYPAIR_STORAGE_KEY)
      }
      keypairCache = { publicKey, privateKey }
      return keypairCache
    }
  } catch {
    // fall through to generation
  }

  // 3. Generate new keypair; re-import private key as non-extractable before storing.
  const ephemeral = await subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    true, // extractable so we can export JWK for re-import with extractable:false
    ['deriveBits']
  )
  const [pubJwk, privJwk] = await Promise.all([
    subtle.exportKey('jwk', ephemeral.publicKey),
    subtle.exportKey('jwk', ephemeral.privateKey),
  ])
  const [publicKey, privateKey] = await Promise.all([
    subtle.importKey(
      'jwk',
      pubJwk,
      { name: 'ECDH', namedCurve: 'P-256' },
      true,
      []
    ),
    subtle.importKey(
      'jwk',
      privJwk,
      { name: 'ECDH', namedCurve: 'P-256' },
      false, // non-extractable
      ['deriveBits']
    ),
  ])
  await storePrivateKey(privateKey)
  try {
    if (storage) storage.setItem(PUBLIC_KEY_STORAGE_KEY, JSON.stringify(pubJwk))
  } catch {
    // ignore storage errors; keypair still works in-memory for this session
  }
  keypairCache = { publicKey, privateKey }
  return keypairCache
}

/**
 * Export ECDH public key as raw bytes (uncompressed P-256: 65 bytes).
 * @param {CryptoKey} publicKey
 * @returns {Promise<Uint8Array>}
 */
export async function exportPublicKeyRaw(publicKey) {
  const subtle = getCrypto()
  const raw = await subtle.exportKey('raw', publicKey)
  return new Uint8Array(raw)
}

/**
 * Export ECDH public key as base64.
 * @param {CryptoKey} publicKey
 * @returns {Promise<string>}
 */
export async function exportPublicKeyBase64(publicKey) {
  const raw = await exportPublicKeyRaw(publicKey)
  return btoa(String.fromCharCode(...raw))
}

/**
 * Import ECDH public key from raw bytes (uncompressed P-256).
 * @param {Uint8Array} raw
 * @returns {Promise<CryptoKey>}
 */
export async function importPublicKeyRaw(raw) {
  const subtle = getCrypto()
  return subtle.importKey(
    'raw',
    raw,
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    []
  )
}

/**
 * Import ECDH public key from base64.
 * @param {string} base64
 * @returns {Promise<CryptoKey>}
 */
export async function importPublicKeyBase64(base64) {
  const bin = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))
  return importPublicKeyRaw(bin)
}

/**
 * Derive shared secret (ECDH) and return as AES-256-GCM key using KDF.
 * @param {CryptoKey} privateKey - Our private key
 * @param {CryptoKey} peerPublicKey - Peer's public key
 * @returns {Promise<CryptoKey>}
 */
export async function deriveAesKey(privateKey, peerPublicKey) {
  const subtle = getCrypto()
  const bits = await subtle.deriveBits(
    { name: 'ECDH', public: peerPublicKey },
    privateKey,
    256
  )
  return deriveAesKeyFromEcdh(bits)
}

/**
 * Derive both AES key and ratchet chain key for DM (for use with symmetric ratchet).
 * @param {CryptoKey} privateKey
 * @param {CryptoKey} peerPublicKey
 * @returns {Promise<{ aesKey: CryptoKey, chainKey: Uint8Array }>}
 */
export async function deriveDmSessionKeys(privateKey, peerPublicKey) {
  const subtle = getCrypto()
  const bits = await subtle.deriveBits(
    { name: 'ECDH', public: peerPublicKey },
    privateKey,
    256
  )
  return deriveDmSessionKeysFromEcdhBits(bits)
}

/**
 * Fingerprint for display/verification: first 32 hex chars (128 bits) of SHA-256 of
 * raw public key. Extended from 64 bits to reduce collision probability.
 * @param {Uint8Array} publicKeyRaw
 * @returns {Promise<string>}
 */
export async function fingerprintFromRaw(publicKeyRaw) {
  const subtle = getCrypto()
  const hash = await subtle.digest('SHA-256', publicKeyRaw)
  const hex = Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
  return hex.slice(0, 32)
}
