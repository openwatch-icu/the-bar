/**
 * Ratchet edge-case tests: counter overflow, catch-up limit, deserialization bounds.
 */
import { describe, it, expect } from 'vitest'
import {
  createRatchetState,
  ratchetEncrypt,
  ratchetDecrypt,
  serializeRatchetState,
  deserializeRatchetState,
} from './ratchet'
import { MESSAGE_VERSION_V2 } from './constants'

const CHAIN_KEY = new Uint8Array(32).fill(0xab)

// ── serializeRatchetState ──────────────────────────────────────────────────

describe('serializeRatchetState', () => {
  it('omits chainKey', () => {
    const state = createRatchetState(CHAIN_KEY)
    const serialized = serializeRatchetState(state)
    expect(serialized.chainKey).toBeUndefined()
    expect(serialized.outCounter).toBe(0)
    expect(serialized.inCounter).toBe(0)
  })
})

// ── deserializeRatchetState ───────────────────────────────────────────────

describe('deserializeRatchetState', () => {
  it('accepts valid zero counters', () => {
    expect(
      deserializeRatchetState({ outCounter: 0, inCounter: 0 })
    ).not.toBeNull()
  })

  it('accepts max valid counter (0xFFFFFFFF)', () => {
    expect(
      deserializeRatchetState({ outCounter: 0xffffffff, inCounter: 0xffffffff })
    ).not.toBeNull()
  })

  it('rejects NaN outCounter', () => {
    expect(
      deserializeRatchetState({ outCounter: NaN, inCounter: 0 })
    ).toBeNull()
  })

  it('rejects NaN inCounter', () => {
    expect(
      deserializeRatchetState({ outCounter: 0, inCounter: NaN })
    ).toBeNull()
  })

  it('rejects Infinity outCounter', () => {
    expect(
      deserializeRatchetState({ outCounter: Infinity, inCounter: 0 })
    ).toBeNull()
  })

  it('rejects Infinity inCounter', () => {
    expect(
      deserializeRatchetState({ outCounter: 0, inCounter: Infinity })
    ).toBeNull()
  })

  it('rejects negative outCounter (-1)', () => {
    expect(deserializeRatchetState({ outCounter: -1, inCounter: 0 })).toBeNull()
  })

  it('rejects negative inCounter (-1)', () => {
    expect(deserializeRatchetState({ outCounter: 0, inCounter: -1 })).toBeNull()
  })

  it('rejects counter exceeding 0xFFFFFFFF', () => {
    expect(
      deserializeRatchetState({ outCounter: 0x100000000, inCounter: 0 })
    ).toBeNull()
  })

  it('rejects non-integer (float) counter', () => {
    expect(
      deserializeRatchetState({ outCounter: 1.5, inCounter: 0 })
    ).toBeNull()
  })

  it('rejects null input', () => {
    expect(deserializeRatchetState(null)).toBeNull()
  })

  it('rejects missing fields', () => {
    expect(deserializeRatchetState({ outCounter: 0 })).toBeNull()
    expect(deserializeRatchetState({ inCounter: 0 })).toBeNull()
  })
})

// ── ratchetEncrypt ─────────────────────────────────────────────────────────

describe('ratchetEncrypt', () => {
  it('counter overflow throws before encrypting', async () => {
    const state = createRatchetState(CHAIN_KEY)
    state.outCounter = 0xffffffff
    await expect(ratchetEncrypt(state, 'hello')).rejects.toThrow(/overflow/i)
  })

  it('advances outCounter after successful encrypt', async () => {
    const state = createRatchetState(CHAIN_KEY)
    await ratchetEncrypt(state, 'hello')
    expect(state.outCounter).toBe(1)
  })

  it('payload version byte is MESSAGE_VERSION_V2', async () => {
    const state = createRatchetState(CHAIN_KEY)
    const payload = await ratchetEncrypt(state, 'hello')
    expect(payload[0]).toBe(MESSAGE_VERSION_V2)
  })
})

// ── ratchetDecrypt ─────────────────────────────────────────────────────────

describe('ratchetDecrypt', () => {
  it('round-trips encrypt → decrypt', async () => {
    const sendState = createRatchetState(CHAIN_KEY)
    const recvState = createRatchetState(CHAIN_KEY)
    const payload = await ratchetEncrypt(sendState, 'secret text')
    const plaintext = await ratchetDecrypt(recvState, payload)
    expect(plaintext).toBe('secret text')
  })

  it('rejects payload with wrong version byte', async () => {
    const state = createRatchetState(CHAIN_KEY)
    const payload = await ratchetEncrypt(state, 'hello')
    payload[0] = 0x00 // corrupt version byte
    const recvState = createRatchetState(CHAIN_KEY)
    const result = await ratchetDecrypt(recvState, payload)
    expect(result).toBeNull()
  })

  it('rejects too-short payload', async () => {
    const state = createRatchetState(CHAIN_KEY)
    const short = new Uint8Array([MESSAGE_VERSION_V2, 0, 0, 0, 0])
    const result = await ratchetDecrypt(state, short)
    expect(result).toBeNull()
  })

  it('rejects counter in the past (counter < inCounter)', async () => {
    const sendState = createRatchetState(CHAIN_KEY)
    const recvState = createRatchetState(CHAIN_KEY)

    // Encrypt two messages.
    const payload0 = await ratchetEncrypt(sendState, 'msg0')
    const payload1 = await ratchetEncrypt(sendState, 'msg1')

    // Receive both in order.
    await ratchetDecrypt(recvState, payload0)
    await ratchetDecrypt(recvState, payload1)

    // Re-deliver first message — counter now below inCounter.
    const result = await ratchetDecrypt(recvState, payload0)
    expect(result).toBeNull()
  })

  it('rejects counter more than MAX_RATCHET_CATCHUP ahead', async () => {
    const recvState = createRatchetState(CHAIN_KEY)
    // Craft a payload with counter = 1001 (> MAX_RATCHET_CATCHUP=1000).
    const fakePayload = new Uint8Array(1 + 4 + 12 + 16 + 1)
    fakePayload[0] = MESSAGE_VERSION_V2
    const counter = 1001
    fakePayload[1] = (counter >>> 24) & 0xff
    fakePayload[2] = (counter >>> 16) & 0xff
    fakePayload[3] = (counter >>> 8) & 0xff
    fakePayload[4] = counter & 0xff
    const result = await ratchetDecrypt(recvState, fakePayload)
    expect(result).toBeNull()
  })
})
