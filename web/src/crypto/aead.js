/**
 * AEAD helpers for PQ+ E2E. AES-256-GCM with 12-byte nonce, 128-bit tag.
 * See https://the-b4r.netlify.app/wiki/e2e_protocol.
 */

import { getCrypto } from './cryptoPrimitives'
import { NONCE_LENGTH, GCM_TAG_LENGTH } from './constants'

/**
 * Encrypt plaintext with AES-256-GCM. Caller provides or gets a random nonce.
 * @param {CryptoKey} key - AES-GCM key (256-bit)
 * @param {Uint8Array} nonce - 12 bytes (unique per message)
 * @param {Uint8Array|string} plaintext - If string, encoded as UTF-8
 * @param {Uint8Array} [aad] - Optional additional authenticated data
 * @returns {Promise<Uint8Array>} ciphertext (includes 16-byte tag at end)
 */
export async function encrypt(key, nonce, plaintext, aad = new Uint8Array(0)) {
  const subtle = getCrypto()
  const data =
    typeof plaintext === 'string'
      ? new TextEncoder().encode(plaintext)
      : plaintext
  const opts = { name: 'AES-GCM', iv: nonce, tagLength: GCM_TAG_LENGTH * 8 }
  if (aad && aad.length > 0) opts.additionalData = aad
  const ciphertext = await subtle.encrypt(opts, key, data)
  return new Uint8Array(ciphertext)
}

/**
 * Decrypt ciphertext (ciphertext includes 16-byte GCM tag at end).
 * @param {CryptoKey} key - AES-GCM key
 * @param {Uint8Array} nonce - 12 bytes
 * @param {Uint8Array} ciphertextWithTag - Ciphertext + 16-byte tag
 * @param {Uint8Array} [aad] - Optional AAD (must match encrypt)
 * @returns {Promise<Uint8Array>} plaintext bytes
 */
export async function decrypt(
  key,
  nonce,
  ciphertextWithTag,
  aad = new Uint8Array(0)
) {
  const subtle = getCrypto()
  const opts = { name: 'AES-GCM', iv: nonce, tagLength: GCM_TAG_LENGTH * 8 }
  if (aad && aad.length > 0) opts.additionalData = aad
  const dec = await subtle.decrypt(opts, key, ciphertextWithTag)
  return new Uint8Array(dec)
}

/**
 * Generate a random 12-byte nonce for AES-GCM.
 * @returns {Uint8Array}
 */
export function randomNonce() {
  return crypto.getRandomValues(new Uint8Array(NONCE_LENGTH))
}

export { NONCE_LENGTH, GCM_TAG_LENGTH }
