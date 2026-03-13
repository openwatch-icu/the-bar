/**
 * E2E DM key agreement and encryption (client-side only).
 * Thin wrapper around web/src/crypto (PQ+ protocol). Uses ECDH P-256 + KDF + AES-256-GCM;
 * optional symmetric ratchet for forward secrecy.
 * Wire format: dmkey:targetUsername:base64(versioned payload); message: e2e.<base64(...)> (v1 or v2 ratchet).
 *
 * Ratchet state (chainKey + counters) lives entirely in memory via the peerKeys map.
 * The chain key is never written to sessionStorage or localStorage to prevent XSS exfiltration.
 */

import {
  E2E_PREFIX,
  MESSAGE_VERSION_V2,
  KEY_EXCHANGE_VERSION_V1,
  generateKeypair,
  exportPublicKeyRaw,
  importPublicKeyRaw,
  deriveDmSessionKeys,
  fingerprintFromRaw,
  buildE2EMessageLine,
  parseAndDecryptE2ELine,
  encodeKeyExchangePayloadV1,
  decodeKeyExchangePayload,
  createRatchetState,
  ratchetEncrypt,
  ratchetDecrypt,
} from '../crypto/index'

// Max base64 length for a key-exchange payload (v1 = 66 bytes raw ≈ 88 chars; v3 hybrid < 1 KiB).
const MAX_KEY_EXCHANGE_B64 = 4096
// Max base64 length for an encrypted DM payload (plaintext ≤ 16 KiB → encrypted ≈ 22 KiB base64).
const MAX_E2E_PAYLOAD_B64 = 32768

const peerKeys = new Map() // peer -> { publicKey, aesKey, chainKey?, ratchetState?, fingerprint }
const keyMismatch = new Map()
const VERIFIED_STORAGE_KEY = 'thebar-e2e-verified'
let verifiedFingerprints = {}
try {
  verifiedFingerprints = JSON.parse(
    localStorage.getItem(VERIFIED_STORAGE_KEY) || '{}'
  )
} catch {
  // ignore
}

/**
 * Store peer's public key and derive shared AES key (and ratchet chain key).
 * PQ+ only: dmkey payload must be versioned (v1/v2/v3).
 * Ratchet state is initialised fresh from the ECDH-derived chain key every time
 * this is called (no sessionStorage restore) — ratchet lives in memory only.
 */
export async function setPeerPublicKey(peerUsername, base64Payload) {
  try {
    const peer = peerUsername.trim()
    if (!base64Payload || base64Payload.length > MAX_KEY_EXCHANGE_B64)
      return false
    const bin = Uint8Array.from(atob(base64Payload), (c) => c.charCodeAt(0))
    const decoded = decodeKeyExchangePayload(bin)
    if (!decoded) return false
    const { ecdhPublicKeyRaw } = decoded
    const fingerprint = await fingerprintFromRaw(ecdhPublicKeyRaw)
    const peerPub = await importPublicKeyRaw(ecdhPublicKeyRaw)
    const { privateKey } = await generateKeypair()
    const { aesKey, chainKey } = await deriveDmSessionKeys(privateKey, peerPub)
    if (
      verifiedFingerprints[peer] &&
      verifiedFingerprints[peer] !== fingerprint
    ) {
      keyMismatch.set(peer, true)
    }
    // Ratchet state is always fresh from the current ECDH-derived chain key.
    // No sessionStorage load — chain key never hits persistent storage.
    const ratchetState = createRatchetState(chainKey)
    peerKeys.set(peer, {
      publicKey: peerPub,
      aesKey,
      chainKey,
      ratchetState,
      fingerprint,
    })
    return true
  } catch {
    return false
  }
}

export async function getPeerAesKey(peerUsername) {
  const entry = peerKeys.get(peerUsername.trim())
  return entry ? entry.aesKey : null
}

export function hasE2EWith(peerUsername) {
  return peerKeys.has(peerUsername.trim())
}

/**
 * Encrypt plaintext for a peer. Uses symmetric ratchet when available (v2), else v1.
 * Ratchet state is mutated in place in peerKeys — no sessionStorage write.
 */
export async function encryptForPeer(peerUsername, plaintext) {
  const peer = peerUsername.trim()
  const entry = peerKeys.get(peer)
  if (!entry) return null
  try {
    if (entry.ratchetState) {
      const payload = await ratchetEncrypt(entry.ratchetState, plaintext)
      if (!payload) return null
      const b64 = btoa(String.fromCharCode(...payload))
      return E2E_PREFIX + b64
    }
    return buildE2EMessageLine(entry.aesKey, plaintext)
  } catch {
    return null
  }
}

/**
 * Decrypt an E2E payload. Handles v1 (versioned/legacy) and v2 (ratchet) formats.
 * Ratchet state is mutated in place in peerKeys — no sessionStorage write.
 */
export async function decryptFromPeer(peerUsername, payload) {
  payload = (payload || '').trim()
  if (!payload || !payload.startsWith(E2E_PREFIX)) return null
  const peer = peerUsername.trim()
  const entry = peerKeys.get(peer)
  if (!entry) return null
  try {
    const b64Part = payload.slice(E2E_PREFIX.length)
    if (b64Part.length > MAX_E2E_PAYLOAD_B64) return null
    const raw = atob(b64Part)
    const bin = new Uint8Array(raw.length)
    for (let i = 0; i < raw.length; i++) bin[i] = raw.charCodeAt(i)
    if (bin.length > 0 && bin[0] === MESSAGE_VERSION_V2 && entry.ratchetState) {
      return ratchetDecrypt(entry.ratchetState, bin)
    }
    return parseAndDecryptE2ELine(payload, entry.aesKey)
  } catch {
    return null
  }
}

/**
 * Build dmkey line for target. PQ+ v1 payload: version byte (0x01) || raw ECDH key.
 */
export async function getDmKeyLineForPeer(targetUsername) {
  try {
    const { publicKey } = await generateKeypair()
    const raw = await exportPublicKeyRaw(publicKey)
    const payload = encodeKeyExchangePayloadV1(KEY_EXCHANGE_VERSION_V1, raw)
    const b64 = btoa(String.fromCharCode(...payload))
    return `dmkey:${targetUsername.trim()}:${b64}`
  } catch {
    return null
  }
}

export function getPeerFingerprint(peerUsername) {
  const entry = peerKeys.get(peerUsername.trim())
  return entry?.fingerprint ?? null
}

export function setPeerVerified(peerUsername) {
  const peer = peerUsername.trim()
  const fp = getPeerFingerprint(peer)
  if (!fp) return
  verifiedFingerprints[peer] = fp
  keyMismatch.delete(peer)
  try {
    localStorage.setItem(
      VERIFIED_STORAGE_KEY,
      JSON.stringify(verifiedFingerprints)
    )
  } catch {
    // ignore
  }
}

export function acceptNewKey(peerUsername) {
  const peer = peerUsername.trim()
  keyMismatch.delete(peer)
  delete verifiedFingerprints[peer]
  try {
    localStorage.setItem(
      VERIFIED_STORAGE_KEY,
      JSON.stringify(verifiedFingerprints)
    )
  } catch {
    // ignore
  }
}

export function getVerificationStatus(peerUsername) {
  const peer = peerUsername.trim()
  if (!peerKeys.has(peer)) return null
  if (keyMismatch.get(peer)) return 'key_mismatch'
  const fp = getPeerFingerprint(peer)
  if (!fp) return 'unverified'
  if (verifiedFingerprints[peer] === fp) return 'verified'
  return 'unverified'
}

export { E2E_PREFIX }
