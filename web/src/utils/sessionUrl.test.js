import { describe, it, expect } from 'vitest'
import { getEnv } from '../config/env'
import {
  getInstanceSlug,
  getWsUrl,
  getStoredTokenKey,
  getStoredToken,
  setStoredToken,
  clearStoredToken,
  getDefaultWsBaseUrl,
  getDefaultScheme,
  getDefaultPort,
  getSessionInfoUrl,
} from './sessionUrl'

describe('sessionUrl utils', () => {
  it('getInstanceSlug returns slug from sessionOverride', () => {
    expect(getInstanceSlug({ slug: 'my-instance' })).toBe('my-instance')
  })

  it("getInstanceSlug returns env default when no override and no path (or path is 'default')", () => {
    const envSlug = getEnv('VITE_INSTANCE_SLUG', 'default') || 'default'
    const expected = envSlug || 'default'
    expect(getInstanceSlug(null)).toBe(expected)
    expect(getInstanceSlug(undefined)).toBe(expected)
  })

  it('getWsUrl builds path from sessionOverride slug and uses ws or wss', () => {
    const url = getWsUrl({ wsBaseUrl: 'http://localhost:8080', slug: 'foo' })
    expect(url).toMatch(/^wss?:\/\//)
    expect(url).toContain('/foo/ws')
  })

  it('getWsUrl uses wss when base is https', () => {
    const url = getWsUrl({
      wsBaseUrl: 'https://chat.example.com',
      slug: 'default',
    })
    expect(url).toMatch(/^wss:\/\//)
    expect(url).toContain('/default/ws')
  })

  it('getStoredTokenKey returns consistent key for slug and username', () => {
    const key = getStoredTokenKey('default', 'alice')
    expect(key).toBe('thebar_reconnect_default_alice')
  })

  it('getDefaultWsBaseUrl returns env or built default', () => {
    expect(getDefaultWsBaseUrl()).toMatch(/^https?:\/\/.+/)
  })

  it('getDefaultScheme returns http or https', () => {
    expect(['http', 'https']).toContain(getDefaultScheme())
  })

  it('getDefaultPort returns a port string', () => {
    expect(getDefaultPort()).toMatch(/^\d+$/)
  })

  it('getSessionInfoUrl returns null when no base URL', () => {
    // When sessionParams has no wsBaseUrl and getEnv/getDefaultWsBaseUrl would not provide one (e.g. in test), behavior is env-dependent.
    const url = getSessionInfoUrl({ slug: 'default' })
    expect(url === null || typeof url === 'string').toBe(true)
    if (url) expect(url).toContain('/session-info')
  })

  it('getSessionInfoUrl builds URL with sessionParams', () => {
    const url = getSessionInfoUrl({
      wsBaseUrl: 'http://localhost:8080',
      slug: 'my-instance',
    })
    expect(url).toBe('http://localhost:8080/my-instance/session-info')
  })

  it('setStoredToken and getStoredToken round-trip when localStorage is available', () => {
    if (typeof localStorage === 'undefined' || !localStorage.setItem) return
    setStoredToken('default', 'alice', 'token-xyz')
    expect(getStoredToken('default', 'alice')).toBe('token-xyz')
  })

  it('clearStoredToken does not throw', () => {
    clearStoredToken('bar', 'bob')
    clearStoredToken('', '')
  })
})
