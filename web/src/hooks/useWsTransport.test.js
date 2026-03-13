import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useWsTransport } from './useWsTransport'

describe('useWsTransport', () => {
  let wsInstance

  beforeEach(() => {
    wsInstance = {
      readyState: 0,
      send: vi.fn(),
      close: vi.fn(),
    }
    global.WebSocket = vi.fn(function (_url) {
      return wsInstance
    })
    global.WebSocket.OPEN = 1
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns isOpen false initially', () => {
    const { result } = renderHook(() => useWsTransport({ slug: 'default' }))
    expect(result.current.isOpen).toBe(false)
    expect(result.current.wsRef.current).toBe(null)
  })

  it('open creates WebSocket with URL from sessionParams', () => {
    const { result } = renderHook(() =>
      useWsTransport({ wsBaseUrl: 'http://localhost:8080', slug: 'bar' })
    )
    act(() => {
      result.current.open('user accesscode:secret')
    })
    expect(global.WebSocket).toHaveBeenCalledWith('ws://localhost:8080/bar/ws')
  })

  it('onopen sends join line and calls onOpen', () => {
    const { result } = renderHook(() =>
      useWsTransport({ wsBaseUrl: 'http://localhost:8080', slug: 'default' })
    )
    const onOpen = vi.fn()
    act(() => {
      result.current.open('alice accesscode:xyz', { onOpen })
    })
    expect(wsInstance.onopen).toBeDefined()
    wsInstance.onopen()
    expect(wsInstance.send).toHaveBeenCalledWith('alice accesscode:xyz')
    expect(onOpen).toHaveBeenCalled()
  })

  it('setOnMessage callback is invoked when message received', () => {
    const { result } = renderHook(() =>
      useWsTransport({ wsBaseUrl: 'http://localhost:8080', slug: 'default' })
    )
    const onMessage = vi.fn()
    act(() => {
      result.current.setOnMessage(onMessage)
      result.current.open('join')
    })
    wsInstance.onmessage({ data: 'Welcome, alice! (in #general)\n' })
    expect(onMessage).toHaveBeenCalledWith('Welcome, alice! (in #general)\n')
  })

  it('sendLine sends when socket is open', () => {
    const { result } = renderHook(() =>
      useWsTransport({ wsBaseUrl: 'http://localhost:8080', slug: 'default' })
    )
    act(() => {
      result.current.open('join')
    })
    wsInstance.readyState = 1
    act(() => {
      result.current.sendLine('/rooms')
    })
    expect(wsInstance.send).toHaveBeenCalledWith('/rooms')
  })

  it('close clears socket and calls onClose', () => {
    const { result } = renderHook(() =>
      useWsTransport({ wsBaseUrl: 'http://localhost:8080', slug: 'default' })
    )
    const onClose = vi.fn()
    act(() => {
      result.current.open('join', { onClose })
    })
    act(() => {
      result.current.close()
    })
    expect(wsInstance.close).toHaveBeenCalled()
    expect(result.current.wsRef.current).toBe(null)
    expect(result.current.isOpen).toBe(false)
    wsInstance.onclose?.()
    expect(onClose).toHaveBeenCalled()
  })
})
