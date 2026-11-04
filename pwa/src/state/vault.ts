import { db } from './db.ts'

/**
 * The API key at rest. It controls everything (orders, logins, credentials), and every GitHub Pages site of the
 * organisation shares this origin and so this storage. So by default it is sealed under a passphrase:
 * AES-GCM-256 with a PBKDF2-SHA256 key, 210,000 iterations (the bot's own vault uses the same recipe), the
 * connection id bound in as associated data. "device" mode seals it with a non-extractable key kept on this
 * device: it keeps the key out of copies of the storage, not away from pages on the same origin.
 */
export type Sealed =
  | { mode: 'passphrase'; salt: string; iv: string; data: string; iterations: number }
  | { mode: 'device'; iv: string; data: string }

export const ITERATIONS = 210_000
export const MIN_PASSPHRASE = 8

const encoder = new TextEncoder()
const decoder = new TextDecoder()
const b64 = (bytes: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...new Uint8Array(bytes)))
const unb64 = (text: string): Uint8Array<ArrayBuffer> => {
  const binary = atob(text)
  const bytes = new Uint8Array(new ArrayBuffer(binary.length))
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}
const aad = (id: string) => encoder.encode(`beyond-bot:${id}`)

export class WrongPassphrase extends Error {
  constructor() {
    super('That passphrase does not open this key.')
    this.name = 'WrongPassphrase'
  }
}

/** Why a passphrase is not good enough, or null. A short number is refused: copied storage could be tried offline. */
export function passphraseProblem(passphrase: string): string | null {
  if (passphrase.length < MIN_PASSPHRASE) return `Use at least ${MIN_PASSPHRASE} characters.`
  if (/^\d+$/.test(passphrase) && passphrase.length < 14) return 'A passphrase of only digits is easy to guess; add letters or make it longer.'
  if (new Set(passphrase).size < 4) return 'Use more different characters.'
  return null
}

/** A rough strength label for the hint under the field. */
export function strength(passphrase: string): 'weak' | 'fair' | 'strong' {
  const kinds = [/[a-z]/, /[A-Z]/, /\d/, /[^\w]/].filter((re) => re.test(passphrase)).length
  const score = passphrase.length * (1 + kinds / 2)
  return passphraseProblem(passphrase) ? 'weak' : score >= 36 ? 'strong' : 'fair'
}

async function fromPassphrase(passphrase: string, salt: Uint8Array<ArrayBuffer>, iterations: number): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey('raw', encoder.encode(passphrase), 'PBKDF2', false, ['deriveKey'])
  return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
}

async function deviceKey(): Promise<CryptoKey> {
  const existing = await db.get<CryptoKey>('device-key')
  if (existing) return existing
  const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
  await db.set('device-key', key)
  return key
}

export async function seal(id: string, secret: string, passphrase: string | null): Promise<Sealed> {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  if (passphrase == null) {
    const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aad(id) }, await deviceKey(), encoder.encode(secret))
    return { mode: 'device', iv: b64(iv), data: b64(data) }
  }
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const key = await fromPassphrase(passphrase, salt, ITERATIONS)
  const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aad(id) }, key, encoder.encode(secret))
  return { mode: 'passphrase', salt: b64(salt), iv: b64(iv), data: b64(data), iterations: ITERATIONS }
}

export async function unseal(id: string, sealed: Sealed, passphrase?: string): Promise<string> {
  try {
    const key = sealed.mode === 'device' ? await deviceKey() : await fromPassphrase(passphrase ?? '', unb64(sealed.salt), sealed.iterations)
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(sealed.iv), additionalData: aad(id) }, key, unb64(sealed.data))
    return decoder.decode(plain)
  } catch {
    throw new WrongPassphrase()
  }
}
