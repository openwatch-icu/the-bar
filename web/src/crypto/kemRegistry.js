/**
 * Pluggable KEM registry for PQ+ hybrid key agreement.
 * Register ML-KEM-768 (or other NIST PQC KEM) when available; v1 (ECDH only) works when no KEM is registered.
 * See https://the-b4r.netlify.app/wiki/e2e_protocol.
 */

import {
  ALG_ID_ECDH_P256,
  ALG_ID_ML_KEM_768,
  ALG_ID_PQ_KEM_2,
} from './constants'

const registry = new Map()

/**
 * Register a KEM by algorithm ID.
 * @param {number} id - ALG_ID_ML_KEM_768 (0x02) or ALG_ID_PQ_KEM_2 (0x03), etc.
 * @param {{ encapsulate: () => Promise<{ ciphertext: Uint8Array, sharedSecret: Uint8Array }>, decapsulate: (ciphertext: Uint8Array) => Promise<Uint8Array> }} impl
 */
export function registerKEM(id, impl) {
  if (
    impl &&
    typeof impl.encapsulate === 'function' &&
    typeof impl.decapsulate === 'function'
  ) {
    registry.set(id, impl)
  }
}

/**
 * Get KEM implementation by ID.
 * @param {number} id
 * @returns {{ encapsulate: () => Promise<{ ciphertext: Uint8Array, sharedSecret: Uint8Array }>, decapsulate: (ciphertext: Uint8Array) => Promise<Uint8Array> }|undefined}
 */
export function getKEM(id) {
  return registry.get(id)
}

/**
 * List registered KEM algorithm IDs (for negotiation).
 * @returns {number[]}
 */
export function listRegisteredKEMs() {
  return Array.from(registry.keys())
}

/**
 * Check if we have at least one PQ KEM (for hybrid / v2).
 * @returns {boolean}
 */
export function hasHybridKEM() {
  return registry.has(ALG_ID_ML_KEM_768) || registry.has(ALG_ID_PQ_KEM_2)
}

export { ALG_ID_ECDH_P256, ALG_ID_ML_KEM_768, ALG_ID_PQ_KEM_2 }
