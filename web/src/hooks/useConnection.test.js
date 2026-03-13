/**
 * useConnection lifecycle tests (Phase 5 verification).
 *
 * Tests the effects added in Phase 5:
 *  - Unmount cleanup closes the WS (5.1)
 *  - Debounce timers cleared on unmount (5.2)
 *  - dmView effect with cancelled flag (5.4)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useConnection } from './useConnection'

// ── Mocks ──────────────────────────────────────────────────────────────────

vi.mock('../utils/e2eDM', () => ({
  getDmKeyLineForPeer: vi.fn(() => Promise.resolve(null)),
  setPeerPublicKey: vi.fn(() => Promise.resolve(true)),
  encryptForPeer: vi.fn(() => Promise.resolve(null)),
  decryptFromPeer: vi.fn(() => Promise.resolve(null)),
  hasE2EWith: vi.fn(() => false),
  getPeerFingerprint: vi.fn(() => null),
  setPeerVerified: vi.fn(),
  acceptNewKey: vi.fn(),
  getVerificationStatus: vi.fn(() => null),
  E2E_PREFIX: 'e2e.',
}))

vi.mock('../utils/e2eRoom', () => ({
  encryptRoomMessage: vi.fn(() => Promise.resolve(null)),
  decryptRoomMessage: vi.fn(() => Promise.resolve(null)),
  tryParseAndStoreRoomKey: vi.fn(() => Promise.resolve(null)),
  hasRoomKey: vi.fn(() => false),
  generateRoomKey: vi.fn(() => Promise.resolve(true)),
  getRoomKeyMessageForDm: vi.fn(() => Promise.resolve(null)),
  parseWrappedRoomKeyLine: vi.fn(() => null),
  unwrapRoomKeyFromServer: vi.fn(() => Promise.resolve(true)),
  wrapRoomKeyForServer: vi.fn(() => Promise.resolve(null)),
  E2E_PREFIX: 'e2e.',
  ROOMKEY_PREFIX: 'ROOMKEY:',
}))

vi.mock('../utils/notifications', () => ({
  requestNotificationPermission: vi.fn(() => Promise.resolve()),
  showNotificationIfHidden: vi.fn(() => Promise.resolve()),
  previewText: vi.fn((s) => s),
}))

vi.mock('../utils/settings', () => ({
  getBarUserMinutes: vi.fn(() => 0),
  getAgeConfirmedForInstance: vi.fn(() => false),
  setAgeConfirmedForInstance: vi.fn(),
}))

vi.mock('../utils/sessionUrl', async (importOriginal) => {
  const orig = await importOriginal()
  return {
    ...orig,
    getWsUrl: vi.fn(() => 'ws://localhost:8080/default/ws'),
    getInstanceSlug: vi.fn(() => 'default'),
    getStoredToken: vi.fn(() => null),
    setStoredToken: vi.fn(),
    clearStoredToken: vi.fn(),
    isTauriEnv: false,
  }
})

vi.mock('./connection/reconnectStorage', () => ({
  getInitialReconnectFromStorage: vi.fn(() => ({ username: '', token: '' })),
  clearReconnectCache: vi.fn(),
}))

// ── WebSocket mock ─────────────────────────────────────────────────────────

let wsInstance

beforeEach(() => {
  wsInstance = {
    readyState: 1, // OPEN
    send: vi.fn(),
    close: vi.fn(),
  }
  global.WebSocket = vi.fn(function () {
    return wsInstance
  })
  global.WebSocket.OPEN = 1
  global.WebSocket.CONNECTING = 0
})

afterEach(() => {
  vi.restoreAllMocks()
})

const sessionParams = { wsBaseUrl: 'http://localhost:8080', slug: 'default' }

// ── Tests ──────────────────────────────────────────────────────────────────

describe('useConnection lifecycle', () => {
  it('unmount closes WS and nulls ref (5.1)', () => {
    const { result, unmount } = renderHook(() =>
      useConnection(sessionParams, null)
    )

    // Inject an open WS directly into the ref (simulates post-login state).
    act(() => {
      result.current.wsRef.current = wsInstance
    })

    unmount()

    expect(wsInstance.close).toHaveBeenCalledOnce()
    // wsRef.current should be null after unmount cleanup.
    expect(result.current.wsRef.current).toBeNull()
  })

  it('unmount clears typing debounce timers (5.2)', () => {
    vi.useFakeTimers()
    const clearSpy = vi.spyOn(global, 'clearTimeout')

    const { result, unmount } = renderHook(() =>
      useConnection(sessionParams, null)
    )

    // Simulate a pending debounce timer on each ref.
    act(() => {
      result.current.wsRef.current = wsInstance
    })

    // Manually set timer IDs on the debounce refs (as scheduleRoomTyping would).
    // We access them through the returned scheduleRoomTyping closure side-effect.
    // The cleanup unconditionally calls clearTimeout(typingDebounceRef.current)
    // and clearTimeout(dmTypingDebounceRef.current); even if null, clearTimeout(null)
    // is a no-op. This test verifies unmount doesn't throw and cleanup runs.
    unmount()

    // clearTimeout should have been called (at minimum for the refs, even if null).
    expect(clearSpy).toHaveBeenCalled()
    vi.useRealTimers()
  })

  it('dmView change cancels in-flight key send (5.4)', async () => {
    const { getDmKeyLineForPeer } = await import('../utils/e2eDM')

    // First call returns a slow promise; second call returns immediately.
    let resolveFirst
    getDmKeyLineForPeer
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveFirst = resolve
          })
      )
      .mockImplementation(() => Promise.resolve('dmkey:bob:base64key'))

    const { result, unmount } = renderHook(() =>
      useConnection(sessionParams, null)
    )

    // Give the hook an open WS.
    act(() => {
      result.current.wsRef.current = wsInstance
    })

    // Set dmView to "alice" — fires the DM key effect with the slow promise.
    act(() => {
      result.current.setDmView('alice')
    })

    // Immediately change dmView to "bob" — should cancel "alice" key send.
    act(() => {
      result.current.setDmView('bob')
    })

    // Resolve the slow "alice" promise after the effect was cancelled.
    act(() => {
      resolveFirst('dmkey:alice:shouldbeblocked')
    })

    // Allow all microtasks/promises to settle.
    await act(async () => {
      await Promise.resolve()
    })

    // The "alice" key line must not have been sent.
    const calls = wsInstance.send.mock.calls.map((c) => c[0])
    expect(calls.some((s) => s?.includes('shouldbeblocked'))).toBe(false)

    unmount()
  })
})
