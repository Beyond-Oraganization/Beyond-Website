import { describe, expect, it } from 'vitest'
import { ITERATIONS, passphraseProblem, seal, strength, unseal, WrongPassphrase } from './vault.ts'

describe('the key vault', () => {
  const key = 'a'.repeat(16) + 'b'.repeat(16) + 'c'.repeat(32)

  it('seals under a passphrase and opens only with it', async () => {
    const sealed = await seal('conn-1', key, 'correct horse battery')
    expect(sealed).toMatchObject({ mode: 'passphrase', iterations: ITERATIONS })
    expect(JSON.stringify(sealed)).not.toContain(key)
    expect(await unseal('conn-1', sealed, 'correct horse battery')).toBe(key)
    await expect(unseal('conn-1', sealed, 'wrong horse battery')).rejects.toBeInstanceOf(WrongPassphrase)
  })

  it('binds the connection id, so a sealed key cannot be moved to another connection', async () => {
    const sealed = await seal('conn-1', key, 'correct horse battery')
    await expect(unseal('conn-2', sealed, 'correct horse battery')).rejects.toBeInstanceOf(WrongPassphrase)
  })

  it('seals with the device key when no passphrase is used', async () => {
    const sealed = await seal('conn-3', key, null)
    expect(sealed.mode).toBe('device')
    expect(await unseal('conn-3', sealed)).toBe(key)
  })

  it('refuses short and number-only passphrases', () => {
    expect(passphraseProblem('1234')).toMatch(/at least 8/)
    expect(passphraseProblem('12345678')).toMatch(/digits/)
    expect(passphraseProblem('aaaaaaaaaa')).toMatch(/different/)
    expect(passphraseProblem('gold at dawn 7')).toBeNull()
    expect(strength('1234')).toBe('weak')
    expect(strength('Gold at Dawn, 1977!')).toBe('strong')
  })
})
