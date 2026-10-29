/**
 * PIN local de 4 dígitos (D7): protege el cambio de cuenta en un equipo
 * compartido. Se guarda como PBKDF2-SHA256 con sal propia (WebCrypto), nunca en
 * claro. Es una barrera contra un compañero curioso, no contra quien tenga el
 * teléfono desbloqueado y herramientas: por eso la credencial dura 30 días y se
 * revoca desde jefatura.
 */

export const PIN_ITERATIONS = 150_000
const SALT_BYTES = 16
const HASH_BITS = 256

export interface PinHash {
  hash: string
  salt: string
  iterations: number
}

export function isValidPin(pin: string): boolean {
  return /^\d{4}$/.test(pin)
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")
}

function fromHex(hex: string): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(new ArrayBuffer(hex.length / 2))
  for (let i = 0; i < out.length; i++) out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  return out
}

async function derive(pin: string, salt: Uint8Array<ArrayBuffer>, iterations: number): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(pin), "PBKDF2", false, ["deriveBits"])
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, key, HASH_BITS)
  return toHex(new Uint8Array(bits))
}

export async function hashPin(pin: string, iterations: number = PIN_ITERATIONS): Promise<PinHash> {
  if (!isValidPin(pin)) throw new Error("El PIN son 4 dígitos.")
  const salt = crypto.getRandomValues(new Uint8Array(new ArrayBuffer(SALT_BYTES)))
  return { hash: await derive(pin, salt, iterations), salt: toHex(salt), iterations }
}

/** Compara en tiempo constante; un PIN mal formado es simplemente incorrecto. */
export async function verifyPinHash(pin: string, stored: PinHash): Promise<boolean> {
  if (!isValidPin(pin)) return false
  const candidate = await derive(pin, fromHex(stored.salt), stored.iterations)
  if (candidate.length !== stored.hash.length) return false
  let diff = 0
  for (let i = 0; i < candidate.length; i++) diff |= candidate.charCodeAt(i) ^ stored.hash.charCodeAt(i)
  return diff === 0
}
