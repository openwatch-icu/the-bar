/**
 * Key derivation for PQ+ E2E. Domain-separated KDF using SHA-256.
 * Used to derive message keys, chain keys, and algorithm-bound material.
 * See https://the-b4r.netlify.app/wiki/e2e_protocol.
 */

import { getCrypto } from './cryptoPrimitives'

const KDF_DOMAIN_PQPLUS_DM_V1 = 'pqplus-dm-v1'
const KDF_DOMAIN_PQPLUS_DM_HYBRID = 'pqplus-dm-hybrid-v1'
const KDF_DOMAIN_MSG = 'pqplus-msg'

/**
 * Derive key material from a shared secret (and optional salt) using SHA-256 and domain separation.
 * Output length in bytes (e.g. 32 for AES-256 key).
 * @param {Uint8Array} secret - ECDH shared secret or combined ECDH||KEM material
 * @param {string} domain - Domain separation string (e.g. KDF_DOMAIN_PQPLUS_DM_V1)
 * @param {Uint8Array} [salt] - Optional salt
 * @param {number} length - Desired output length in bytes
 * @returns {Promise<Uint8Array>}
 */
export async function deriveKeyMaterial(
  secret,
  domain,
  salt = new Uint8Array(0),
  length = 32
) {
  const subtle = getCrypto()
  const domainEnc = new TextEncoder().encode(domain)
  const combined = new Uint8Array(
    domainEnc.length + secret.length + salt.length
  )
  combined.set(domainEnc, 0)
  combined.set(secret, domainEnc.length)
  combined.set(salt, domainEnc.length + secret.length)
  const hash = await subtle.digest('SHA-256', combined)
  const out = new Uint8Array(hash)
  if (length <= 32) return out.slice(0, length)
  // Multiple iterations if more than 32 bytes needed (e.g. for multiple keys)
  let result = new Uint8Array(length)
  result.set(out.slice(0, 32), 0)
  let offset = 32
  let prev = out
  while (offset < length) {
    const nextInput = new Uint8Array(prev.length + domainEnc.length + 1)
    nextInput.set(prev, 0)
    nextInput.set(domainEnc, prev.length)
    nextInput[prev.length + domainEnc.length] = offset >>> 8
    const nextHash = await subtle.digest('SHA-256', nextInput)
    const next = new Uint8Array(nextHash)
    const toCopy = Math.min(32, length - offset)
    result.set(next.slice(0, toCopy), offset)
    offset += toCopy
    prev = next
  }
  return result
}

/**
 * Derive a 256-bit AES key from ECDH shared secret for DM (v1 classical).
 * @param {ArrayBuffer} ecdhBits - Raw ECDH deriveBits output (256 bits)
 * @returns {Promise<CryptoKey>}
 */
export async function deriveAesKeyFromEcdh(ecdhBits) {
  const subtle = getCrypto()
  const secret = new Uint8Array(ecdhBits)
  const keyMaterial = await deriveKeyMaterial(
    secret,
    KDF_DOMAIN_PQPLUS_DM_V1,
    new Uint8Array(0),
    32
  )
  return subtle.importKey('raw', keyMaterial, { name: 'AES-GCM' }, false, [
    'encrypt',
    'decrypt',
  ])
}

/**
 * Derive both AES key and ratchet chain key from ECDH bits for DM (enables symmetric ratchet).
 * @param {ArrayBuffer} ecdhBits - Raw ECDH deriveBits output (256 bits)
 * @returns {Promise<{ aesKey: CryptoKey, chainKey: Uint8Array }>}
 */
export async function deriveDmSessionKeysFromEcdhBits(ecdhBits) {
  const subtle = getCrypto()
  const secret = new Uint8Array(ecdhBits)
  const keyMaterial = await deriveKeyMaterial(
    secret,
    KDF_DOMAIN_PQPLUS_DM_V1,
    new Uint8Array(0),
    64
  )
  const aesKey = await subtle.importKey(
    'raw',
    keyMaterial.slice(0, 32),
    { name: 'AES-GCM' },
    false,
    ['encrypt', 'decrypt']
  )
  const chainKey = keyMaterial.slice(32, 64)
  return { aesKey, chainKey }
}

/**
 * Derive session keys from hybrid (ECDH + KEM) shared material. combinedSecret = ecdhBits || kemSharedSecret.
 * @param {ArrayBuffer} ecdhBits - Raw ECDH deriveBits output (256 bits)
 * @param {Uint8Array} kemSharedSecret - From PQ KEM decapsulate/encapsulate
 * @returns {Promise<{ aesKey: CryptoKey, chainKey: Uint8Array }>}
 */
export async function deriveHybridSessionKeys(ecdhBits, kemSharedSecret) {
  const subtle = getCrypto()
  const ecdhArr = new Uint8Array(ecdhBits)
  const combined = new Uint8Array(ecdhArr.length + kemSharedSecret.length)
  combined.set(ecdhArr, 0)
  combined.set(kemSharedSecret, ecdhArr.length)
  const keyMaterial = await deriveKeyMaterial(
    combined,
    KDF_DOMAIN_PQPLUS_DM_HYBRID,
    new Uint8Array(0),
    64
  )
  const aesKey = await subtle.importKey(
    'raw',
    keyMaterial.slice(0, 32),
    { name: 'AES-GCM' },
    false,
    ['encrypt', 'decrypt']
  )
  const chainKey = keyMaterial.slice(32, 64)
  return { aesKey, chainKey }
}

/**
 * Derive message key and next chain key from chain key (for symmetric ratchet).
 * @param {Uint8Array} chainKey
 * @param {number} counter
 * @returns {Promise<{ messageKey: Uint8Array, nextChainKey: Uint8Array }>}
 */
export async function deriveRatchetStep(chainKey, counter) {
  const counterBytes = new Uint8Array(4)
  counterBytes[0] = (counter >>> 24) & 0xff
  counterBytes[1] = (counter >>> 16) & 0xff
  counterBytes[2] = (counter >>> 8) & 0xff
  counterBytes[3] = counter & 0xff
  const domain = KDF_DOMAIN_MSG + counter
  const out = await deriveKeyMaterial(chainKey, domain, new Uint8Array(0), 64)
  return {
    messageKey: out.slice(0, 32),
    nextChainKey: out.slice(32, 64),
  }
}
