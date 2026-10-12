import { describe, it, expect } from 'vitest'
import { decideEncryptToggle } from './directAccessToggle.js'

describe('decideEncryptToggle', () => {
  it('turns off at once, turns on with a key in memory, and asks for the passphrase without one', () => {
    expect(decideEncryptToggle({ encrypt: true, keyInMemory: false })).toBe('off')
    expect(decideEncryptToggle({ encrypt: true, keyInMemory: true })).toBe('off')
    expect(decideEncryptToggle({ encrypt: false, keyInMemory: true })).toBe('on')
    expect(decideEncryptToggle({ encrypt: false, keyInMemory: false })).toBe('ask')
  })
})
