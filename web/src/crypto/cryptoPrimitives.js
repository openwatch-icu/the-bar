/**
 * Web Crypto access and constant-time compare for PQ+ E2E.
 * Used by KDF, AEAD, and wire modules.
 */

export function getCrypto() {
  if (typeof crypto !== 'undefined' && crypto.subtle) return crypto.subtle
  throw new Error('Web Crypto (crypto.subtle) not available')
}

/**
 * Constant-time compare of two Uint8Arrays (for auth tags / verification).
 * @param {Uint8Array} a
 * @param {Uint8Array} b
 * @returns {boolean}
 */
export function constantTimeCompare(a, b) {
  if (a.length !== b.length) return false
  let out = 0
  for (let i = 0; i < a.length; i++) {
    out |= a[i] ^ b[i]
  }
  return out === 0
}
