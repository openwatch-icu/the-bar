/**
 * PQ+ E2E crypto module. Same protocol for web and Tauri.
 * See https://the-b4r.netlify.app/wiki/e2e_protocol.
 */

export {
  PROTOCOL_NAME,
  E2E_PREFIX,
  MESSAGE_VERSION_V1,
  MESSAGE_VERSION_V2,
  KEY_EXCHANGE_VERSION_V1,
  KEY_EXCHANGE_VERSION_V2,
  KEY_EXCHANGE_VERSION_V3,
  ALG_ID_ECDH_P256,
  ALG_ID_ML_KEM_768,
  ALG_ID_PQ_KEM_2,
  ALG_ID_ML_DSA,
  NONCE_LENGTH,
  GCM_TAG_LENGTH,
} from './constants'
export { getCrypto, constantTimeCompare } from './cryptoPrimitives'
export {
  deriveKeyMaterial,
  deriveAesKeyFromEcdh,
  deriveDmSessionKeysFromEcdhBits,
  deriveHybridSessionKeys,
  deriveRatchetStep,
} from './kdf'
export {
  encrypt,
  decrypt,
  randomNonce,
  NONCE_LENGTH as AEAD_NONCE_LENGTH,
  GCM_TAG_LENGTH as AEAD_TAG_LENGTH,
} from './aead'
export {
  encodeMessagePayload,
  decodeMessagePayload,
  buildE2EMessageLine,
  parseAndDecryptE2ELine,
  encodeKeyExchangePayloadV1,
  encodeKeyExchangePayloadV2,
  decodeKeyExchangePayload,
} from './wire'
export {
  registerKEM,
  getKEM,
  listRegisteredKEMs,
  hasHybridKEM,
} from './kemRegistry'
export {
  generateKeypair,
  exportPublicKeyRaw,
  exportPublicKeyBase64,
  importPublicKeyRaw,
  importPublicKeyBase64,
  deriveAesKey,
  deriveDmSessionKeys,
  fingerprintFromRaw,
} from './keyAgreement'
export {
  createRatchetState,
  serializeRatchetState,
  deserializeRatchetState,
  ratchetEncrypt,
  ratchetDecrypt,
} from './ratchet'
export {
  isTauri,
  getItem as storageGetItem,
  setItem as storageSetItem,
  removeItem as storageRemoveItem,
  getStoredPrivateKey,
  storePrivateKey,
  deleteStoredPrivateKey,
} from './storage'
