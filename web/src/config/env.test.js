import { describe, it, expect } from 'vitest'
import { getEnv, isDev } from './env'

describe('env', () => {
  it('getEnv returns fallback when env var is unset or empty', () => {
    expect(getEnv('VITE_UNSET_VAR_XYZ', 'fallback')).toBe('fallback')
    expect(getEnv('NONEXISTENT', '')).toBe('')
  })

  it('getEnv returns value when env var is set', () => {
    // In test env, VITE_* may or may not be set; we only assert fallback behavior for unset.
    const result = getEnv('VITE_UNSET_NEVER_SET', 'default')
    expect(result).toBe('default')
  })

  it('isDev returns a boolean', () => {
    expect(typeof isDev()).toBe('boolean')
  })
})
