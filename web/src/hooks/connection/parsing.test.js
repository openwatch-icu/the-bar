import { describe, it, expect } from 'vitest'
import { isServerCommand, parseBARLine } from './parsing'

describe('parsing', () => {
  describe('isServerCommand', () => {
    it('returns false for non-commands', () => {
      expect(isServerCommand('hello')).toBe(false)
      expect(isServerCommand('')).toBe(false)
      expect(isServerCommand('  /notacmd')).toBe(false)
      expect(isServerCommand('/unknown')).toBe(false)
    })

    it('returns true for server commands', () => {
      expect(isServerCommand('/join')).toBe(true)
      expect(isServerCommand('/quit')).toBe(true)
      expect(isServerCommand('/rooms')).toBe(true)
      expect(isServerCommand('/heartbeat')).toBe(true)
      expect(isServerCommand('/msg alice hi')).toBe(true)
    })
  })

  describe('parseBARLine', () => {
    it('returns line and null burnTs for plain line', () => {
      const result = parseBARLine('hello world')
      expect(result).toEqual({ line: 'hello world', burnTs: null })
    })

    it('parses [ts:...] [burn:N] prefix', () => {
      const result = parseBARLine('[ts:123] [burn:999] secret message')
      expect(result.line).toBe('secret message')
      expect(result.burnTs).toBe(999)
    })

    it('returns raw line when no burn prefix', () => {
      const result = parseBARLine('[ts:1] no burn')
      expect(result.burnTs).toBe(null)
    })
  })
})
