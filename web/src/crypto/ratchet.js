/**
 * Symmetric ratchet for PQ+ E2E. Forward secrecy: each message uses a new key derived from the chain.
 * See https://the-b4r.netlify.app/wiki/e2e_protocol.
 */

import { getCrypto } from './cryptoPrimitives'
import { deriveRatchetStep } from './kdf'
import { encrypt, decrypt, randomNonce } from './aead'
import { MESSAGE_VERSION_V2 } from './constants'

const COUNTER_LENGTH = 4
const NONCE_LENGTH = 12

// Maximum number of ratchet steps to catch up when messages arrive out of order.
// Prevents DoS via artificially large counter values.
const MAX_RATCHET_CATCHUP = 1000

// Maximum valid counter value (4-byte unsigned).
const MAX_COUNTER = 0xffffffff

/**
 * @typedef {Object} RatchetState
 * @property {Uint8Array} chainKey
 * @property {number} outCounter - Next counter to use when sending
 * @property {number} inCounter - Next counter we expect when receiving
 */

/**
 * Create initial ratchet state from a root chain key (e.g. from KDF(ECDH_secret)).
 * @param {Uint8Array} initialChainKey - 32 bytes
 * @returns {RatchetState}
 */
export function createRatchetState(initialChainKey) {
  return {
    chainKey: new Uint8Array(initialChainKey),
    outCounter: 0,
    inCounter: 0,
  }
}

/**
 * Serialize ratchet state for persistence. Chain key is intentionally omitted;
 * it lives only in memory. Only counters are persisted so they can survive component
 * remounts when the chain key is re-derived from the ECDH exchange.
 * @param {RatchetState} state
 * @returns {{ outCounter: number, inCounter: number }}
 */
export function serializeRatchetState(state) {
  return {
    outCounter: state.outCounter,
    inCounter: state.inCounter,
  }
}

/**
 * Deserialize persisted ratchet counters. Returns null on invalid input.
 * Note: the returned object has no chainKey; callers must supply the chain key
 * when reconstructing a full RatchetState (see createRatchetState).
 * @param {{ outCounter: number, inCounter: number }} obj
 * @returns {{ outCounter: number, inCounter: number }|null}
 */
export function deserializeRatchetState(obj) {
  if (
    !obj ||
    typeof obj.outCounter !== 'number' ||
    typeof obj.inCounter !== 'number'
  )
    return null
  if (
    !Number.isInteger(obj.outCounter) ||
    obj.outCounter < 0 ||
    obj.outCounter > MAX_COUNTER ||
    !Number.isInteger(obj.inCounter) ||
    obj.inCounter < 0 ||
    obj.inCounter > MAX_COUNTER
  )
    return null
  return {
    outCounter: obj.outCounter,
    inCounter: obj.inCounter,
  }
}

async function messageKeyToCryptoKey(messageKey) {
  const subtle = getCrypto()
  return subtle.importKey('raw', messageKey, { name: 'AES-GCM' }, false, [
    'encrypt',
    'decrypt',
  ])
}

/**
 * Encrypt plaintext with the ratchet; advances outbound chain.
 * Payload format: version(1) || counter(4) || nonce(12) || ciphertext || tag.
 * @param {RatchetState} state - Will be mutated (chainKey, outCounter updated)
 * @param {string} plaintext
 * @returns {Promise<Uint8Array|null>} Full payload or null
 */
export async function ratchetEncrypt(state, plaintext) {
  const counter = state.outCounter
  if (counter >= MAX_COUNTER) throw new Error('ratchet counter overflow')
  const { messageKey, nextChainKey } = await deriveRatchetStep(
    state.chainKey,
    counter
  )
  const key = await messageKeyToCryptoKey(messageKey)
  const nonce = randomNonce()
  const ciphertextWithTag = await encrypt(key, nonce, plaintext)
  state.chainKey = nextChainKey
  state.outCounter = counter + 1
  const payload = new Uint8Array(
    1 + COUNTER_LENGTH + NONCE_LENGTH + ciphertextWithTag.length
  )
  payload[0] = MESSAGE_VERSION_V2
  payload[1] = (counter >>> 24) & 0xff
  payload[2] = (counter >>> 16) & 0xff
  payload[3] = (counter >>> 8) & 0xff
  payload[4] = counter & 0xff
  payload.set(nonce, 5)
  payload.set(ciphertextWithTag, 5 + NONCE_LENGTH)
  return payload
}

/**
 * Decrypt payload from ratchet; advances inbound chain. Handles catch-up if we missed
 * messages (inCounter < counter), up to MAX_RATCHET_CATCHUP steps.
 * @param {RatchetState} state - Will be mutated
 * @param {Uint8Array} payload - Version(1) || counter(4) || nonce(12) || ciphertext || tag
 * @returns {Promise<string|null>} plaintext or null on failure
 */
export async function ratchetDecrypt(state, payload) {
  if (!payload || payload.length < 1 + COUNTER_LENGTH + NONCE_LENGTH + 16)
    return null
  if (payload[0] !== MESSAGE_VERSION_V2) return null
  // Decode as unsigned 32-bit integer.
  const counter =
    ((payload[1] << 24) |
      (payload[2] << 16) |
      (payload[3] << 8) |
      payload[4]) >>>
    0
  if (counter < state.inCounter) return null
  if (counter - state.inCounter > MAX_RATCHET_CATCHUP) {
    // Counter too far ahead — possible attack or severe packet loss.
    return null
  }
  let chainKey = new Uint8Array(state.chainKey)
  let inCounter = state.inCounter
  while (inCounter < counter) {
    const { nextChainKey } = await deriveRatchetStep(chainKey, inCounter)
    chainKey = nextChainKey
    inCounter++
  }
  const { messageKey, nextChainKey } = await deriveRatchetStep(
    chainKey,
    counter
  )
  const key = await messageKeyToCryptoKey(messageKey)
  const nonce = payload.slice(5, 5 + NONCE_LENGTH)
  const ciphertextWithTag = payload.slice(5 + NONCE_LENGTH)
  try {
    const plainBytes = await decrypt(key, nonce, ciphertextWithTag)
    state.chainKey = nextChainKey
    state.inCounter = counter + 1
    return new TextDecoder().decode(plainBytes)
  } catch {
    return null
  }
}
