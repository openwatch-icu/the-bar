/**
 * Versioned wire format for PQ+ E2E message body and key exchange.
 * See https://the-b4r.netlify.app/wiki/e2e_protocol.
 */

import { encrypt, decrypt, randomNonce } from './aead'
import {
  MESSAGE_VERSION_V1,
  KEY_EXCHANGE_VERSION_V1,
  KEY_EXCHANGE_VERSION_V2,
  KEY_EXCHANGE_VERSION_V3,
  NONCE_LENGTH,
  GCM_TAG_LENGTH,
  E2E_PREFIX,
} from './constants'

export { E2E_PREFIX }

/**
 * Encode message payload for wire: version (1 byte) || nonce (12) || ciphertext || tag.
 * v1: no ratchet header; just version + nonce + AEAD output.
 * @param {number} version - MESSAGE_VERSION_V1 (0x01) or later
 * @param {CryptoKey} aesKey - AES-256-GCM key
 * @param {string} plaintext
 * @returns {Promise<Uint8Array>} Full payload (version || nonce || ciphertext || tag)
 */
export async function encodeMessagePayload(version, aesKey, plaintext) {
  const nonce = randomNonce()
  const ciphertextWithTag = await encrypt(aesKey, nonce, plaintext)
  const payload = new Uint8Array(1 + NONCE_LENGTH + ciphertextWithTag.length)
  payload[0] = version
  payload.set(nonce, 1)
  payload.set(ciphertextWithTag, 1 + NONCE_LENGTH)
  return payload
}

/**
 * Decode and decrypt message payload. PQ+ only: requires version byte (0x01, 0x02, or 0x03). Rejects non-versioned payloads.
 * @param {CryptoKey} aesKey - AES-256-GCM key
 * @param {Uint8Array} rawPayload - Versioned payload: version (1) || nonce (12) || ciphertext || tag
 * @returns {Promise<{ plaintext: string, version: number }|null>} plaintext and version, or null on failure / invalid format
 */
export async function decodeMessagePayload(aesKey, rawPayload) {
  if (!rawPayload || rawPayload.length < 1 + NONCE_LENGTH + GCM_TAG_LENGTH)
    return null
  const first = rawPayload[0]
  if (first !== 0x01 && first !== 0x02 && first !== 0x03) return null
  const version = first
  const nonce = rawPayload.slice(1, 1 + NONCE_LENGTH)
  const ciphertextWithTag = rawPayload.slice(1 + NONCE_LENGTH)
  try {
    const plainBytes = await decrypt(aesKey, nonce, ciphertextWithTag)
    return { plaintext: new TextDecoder().decode(plainBytes), version }
  } catch {
    return null
  }
}

/**
 * Build the full e2e. line for a room or DM message (versioned v1).
 * @param {CryptoKey} aesKey
 * @param {string} plaintext
 * @returns {Promise<string|null>} e2e.<base64(payload)> or null
 */
export async function buildE2EMessageLine(aesKey, plaintext) {
  try {
    const payload = await encodeMessagePayload(
      MESSAGE_VERSION_V1,
      aesKey,
      plaintext
    )
    const b64 = btoa(String.fromCharCode(...payload))
    return E2E_PREFIX + b64
  } catch {
    return null
  }
}

/**
 * Parse e2e.<base64> line and decrypt with given key. PQ+ only: payload must start with version byte (0x01, 0x02, or 0x03).
 * @param {string} line - Full line e.g. "e2e.xxxx"
 * @param {CryptoKey} aesKey
 * @returns {Promise<string|null>} plaintext or null (invalid/unknown format rejected)
 */
export async function parseAndDecryptE2ELine(line, aesKey) {
  if (!line || !line.startsWith(E2E_PREFIX)) return null
  try {
    const raw = atob(line.slice(E2E_PREFIX.length))
    const bin = new Uint8Array(raw.length)
    for (let i = 0; i < raw.length; i++) bin[i] = raw.charCodeAt(i)
    const result = await decodeMessagePayload(aesKey, bin)
    return result ? result.plaintext : null
  } catch {
    return null
  }
}

/**
 * Encode key-exchange payload for dmkey line (v1 = version byte + raw ECDH public key).
 * @param {number} version - KEY_EXCHANGE_VERSION_V1 (0x01) or later
 * @param {Uint8Array} ecdhPublicKeyRaw - Raw uncompressed ECDH P-256 public key (65 bytes)
 * @returns {Uint8Array} version || ecdhPublicKeyRaw
 */
export function encodeKeyExchangePayloadV1(version, ecdhPublicKeyRaw) {
  const payload = new Uint8Array(1 + ecdhPublicKeyRaw.length)
  payload[0] = version
  payload.set(ecdhPublicKeyRaw, 1)
  return payload
}

/**
 * Encode key-exchange payload v2 (hybrid): version(1) || ecdhRaw(65) || kemCiphertext.
 * @param {number} version - KEY_EXCHANGE_VERSION_V2 (0x02)
 * @param {Uint8Array} ecdhPublicKeyRaw - 65 bytes
 * @param {Uint8Array} kemCiphertext - PQ KEM ciphertext (e.g. ML-KEM-768)
 * @returns {Uint8Array}
 */
export function encodeKeyExchangePayloadV2(
  version,
  ecdhPublicKeyRaw,
  kemCiphertext
) {
  const payload = new Uint8Array(
    1 + ecdhPublicKeyRaw.length + kemCiphertext.length
  )
  payload[0] = version
  payload.set(ecdhPublicKeyRaw, 1)
  payload.set(kemCiphertext, 1 + ecdhPublicKeyRaw.length)
  return payload
}

/**
 * Decode key-exchange payload from dmkey. PQ+ only: requires version byte (v1=66 bytes, v2/v3=66+). Rejects unversioned payloads.
 * @param {Uint8Array} raw - Payload bytes (after base64 decode)
 * @returns {{ version: number, ecdhPublicKeyRaw: Uint8Array, kemCiphertext?: Uint8Array }|null}
 */
export function decodeKeyExchangePayload(raw) {
  if (!raw || raw.length < 66) return null
  const version = raw[0]
  if (version === KEY_EXCHANGE_VERSION_V1 && raw.length === 66) {
    return { version, ecdhPublicKeyRaw: raw.slice(1, 66) }
  }
  if (
    (version === KEY_EXCHANGE_VERSION_V2 ||
      version === KEY_EXCHANGE_VERSION_V3) &&
    raw.length > 66
  ) {
    return {
      version,
      ecdhPublicKeyRaw: raw.slice(1, 66),
      kemCiphertext: raw.slice(66),
    }
  }
  return null
}
