/**
 * PQ+ wire format tests. Ensures versioned-only (no legacy) behavior.
 */
import { describe, it, expect } from 'vitest'
import {
  decodeKeyExchangePayload,
  decodeMessagePayload,
  E2E_PREFIX,
} from './wire'
import {
  KEY_EXCHANGE_VERSION_V1,
  MESSAGE_VERSION_V1,
  NONCE_LENGTH,
  GCM_TAG_LENGTH,
} from './constants'

describe('PQ+ wire format', () => {
  describe('decodeKeyExchangePayload', () => {
    it('rejects payload shorter than 66 bytes (no legacy 65-byte)', () => {
      const raw65 = new Uint8Array(65)
      raw65.fill(0x01)
      expect(decodeKeyExchangePayload(raw65)).toBeNull()
    })

    it('accepts v1 payload (66 bytes: version 0x01 + 65-byte ECDH key)', () => {
      const raw = new Uint8Array(66)
      raw[0] = KEY_EXCHANGE_VERSION_V1
      raw.fill(0xab, 1, 66)
      const decoded = decodeKeyExchangePayload(raw)
      expect(decoded).not.toBeNull()
      expect(decoded.version).toBe(KEY_EXCHANGE_VERSION_V1)
      expect(decoded.ecdhPublicKeyRaw.length).toBe(65)
    })

    it('rejects payload with unknown version byte', () => {
      const raw = new Uint8Array(66)
      raw[0] = 0xff
      raw.fill(0xab, 1, 66)
      expect(decodeKeyExchangePayload(raw)).toBeNull()
    })
  })

  describe('decodeMessagePayload', () => {
    it('rejects payload without valid version byte (PQ+ only)', async () => {
      const minLen = 1 + NONCE_LENGTH + GCM_TAG_LENGTH
      const raw = new Uint8Array(minLen)
      raw[0] = 0x00
      const key = await crypto.subtle.importKey(
        'raw',
        new Uint8Array(32).fill(1),
        { name: 'AES-GCM', length: 256 },
        false,
        ['encrypt', 'decrypt']
      )
      const result = await decodeMessagePayload(key, raw)
      expect(result).toBeNull()
    })

    it('rejects payload with version 0x04 (unknown)', async () => {
      const minLen = 1 + NONCE_LENGTH + GCM_TAG_LENGTH
      const raw = new Uint8Array(minLen)
      raw[0] = 0x04
      const key = await crypto.subtle.importKey(
        'raw',
        new Uint8Array(32).fill(1),
        { name: 'AES-GCM', length: 256 },
        false,
        ['encrypt', 'decrypt']
      )
      const result = await decodeMessagePayload(key, raw)
      expect(result).toBeNull()
    })

    it('rejects too-short payload', async () => {
      const key = await crypto.subtle.importKey(
        'raw',
        new Uint8Array(32).fill(1),
        { name: 'AES-GCM', length: 256 },
        false,
        ['encrypt', 'decrypt']
      )
      const short = new Uint8Array([MESSAGE_VERSION_V1])
      expect(await decodeMessagePayload(key, short)).toBeNull()
    })
  })

  describe('E2E_PREFIX', () => {
    it('is e2e.', () => {
      expect(E2E_PREFIX).toBe('e2e.')
    })
  })
})
