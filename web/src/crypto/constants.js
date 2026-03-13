/**
 * PQ+ E2E protocol constants. See https://the-b4r.netlify.app/wiki/e2e_protocol.
 *
 * PQ+ is the only supported encryption standard for this platform; no legacy format is accepted.
 */

/** Official protocol name: the only E2E encryption standard in use. */
export const PROTOCOL_NAME = 'PQ+'

export const E2E_PREFIX = 'e2e.'

/** Message payload version: v1 = classical only (ECDH + AES-GCM), no ratchet */
export const MESSAGE_VERSION_V1 = 0x01
/** Future: v2 = ratchet + AEAD */
export const MESSAGE_VERSION_V2 = 0x02

/** Key exchange payload version: v1 = classical only (raw ECDH public key) */
export const KEY_EXCHANGE_VERSION_V1 = 0x01
/** v2 = hybrid (ECDH + one PQ KEM) */
export const KEY_EXCHANGE_VERSION_V2 = 0x02
/** v3 = hybrid + double-PQ */
export const KEY_EXCHANGE_VERSION_V3 = 0x03

/** Algorithm IDs (pluggable KEM/signatures) */
export const ALG_ID_ECDH_P256 = 0x01
export const ALG_ID_ML_KEM_768 = 0x02
export const ALG_ID_PQ_KEM_2 = 0x03
export const ALG_ID_ML_DSA = 0x10

export const NONCE_LENGTH = 12
export const GCM_TAG_LENGTH = 16
