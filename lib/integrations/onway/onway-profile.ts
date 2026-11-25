/**
 * Perfil persistente del navegador de OnWay.
 *
 * Auth0 decide si pide un reCAPTCHA según la confianza que le da al navegador.
 * Un contexto recién creado, sin historial, es sospechoso y el desafío aparece
 * casi siempre; uno que conserva cookies e identidad lo pasa sin interacción.
 * El README del referente lo dice con datos medidos: "la vía práctica es
 * resolver el primer captcha a mano con el perfil ya confiable, las consultas
 * siguientes pasan con un click y sin desafío".
 *
 * Hasta 2026-11-25 la plataforma creaba el contexto en memoria en cada corrida,
 * así que cada `ONWAY_INTERACTIVE_AUTH_REQUIRED` era inevitable y el cron de 5
 * minutos lo repetía 288 veces al día. ADR-001 rechazó persistir cookies por
 * impacto de filtración; la enmienda del 2026-11-25 acepta un archivo dedicado
 * con permisos 0600, fuera de los respaldos.
 *
 * Se persiste `storageState` (cookies + localStorage) en vez de un perfil de
 * Chrome completo: es lo que Playwright restaura sin cambiar cómo se abre el
 * navegador, y `_GRECAPTCHA` —la cookie de la que depende la reputación— viaja
 * ahí. El nombre deriva del hash de las credenciales, así que cambiarlas abre
 * una sesión limpia y el archivo anterior queda huérfano.
 */

import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, statSync } from "node:fs"
import path from "node:path"
import type { BrowserContext } from "playwright"

/**
 * Directorio por defecto del volumen en el contenedor.
 *
 * No usa `resolveStorageFile()` porque este archivo **no** vive en el
 * almacenamiento de la app (`STORAGE_PATH`): es un volumen Docker aparte, fuera
 * de los respaldos a propósito. El `turbopackIgnore` sí es obligatorio — sin él
 * Turbopack evalúa el `join` como patrón y traza el proyecto entero dentro de
 * `.next/standalone` (ver la regla `no-restricted-imports` de `lib/**`).
 */
export const ONWAY_PROFILE_DEFAULT_DIR = "/data/onway-profile"

/**
 * El archivo contiene cookies de sesión de Auth0: mismo criterio que una
 * credencial, sólo el usuario de la app debe poder leerlo.
 */
const PROFILE_FILE_MODE = 0o600

/**
 * Un hash SHA-256 hexadecimal tiene 64 caracteres. Se usan 32 para que el
 * nombre no revele nada de la credencial y siga siendo único en la práctica.
 */
const PROFILE_KEY_LENGTH = 32

export function onwayProfileRoot(): string {
  const configured = process.env.ONWAY_CAPTCHA_PROFILE_DIR?.trim() || ONWAY_PROFILE_DEFAULT_DIR
  return path.resolve(/*turbopackIgnore: true*/ configured)
}

function profileKey(account: string): string {
  return account.replace(/[^a-z0-9]/gi, "").slice(0, PROFILE_KEY_LENGTH)
}

export function onwayProfilePath(account: string): string {
  const key = profileKey(account)
  if (!key) throw new Error("ONWAY_PROFILE_ACCOUNT_REQUIRED")
  return path.join(/*turbopackIgnore: true*/ onwayProfileRoot(), `${key}.storage-state.json`)
}

/**
 * Crea el directorio del perfil si se puede.
 *
 * Devuelve `false` cuando el volumen no está montado o no es escribible: la
 * lectura del portal **no puede depender** de eso, así que el cliente sigue con
 * un contexto en memoria como hasta 2026-11-25.
 */
export function ensureOnwayProfileDir(): boolean {
  const root = onwayProfileRoot()
  try {
    mkdirSync(root, { recursive: true, mode: 0o700 })
    // `mkdirSync` no ajusta el modo de un directorio que ya existía.
    chmodSync(root, 0o700)
    return true
  } catch {
    return false
  }
}

export interface OnwayProfileState {
  account: string
  exists: boolean
  path: string
  /** Momento en que se guardó la última sesión, si existe. */
  updatedAt: string | null
}

export function onwayProfileState(account: string): OnwayProfileState {
  const path = onwayProfilePath(account)
  if (!existsSync(path)) return { account, exists: false, path, updatedAt: null }
  try {
    return { account, exists: true, path, updatedAt: statSync(path).mtime.toISOString() }
  } catch {
    return { account, exists: true, path, updatedAt: null }
  }
}

/** Ajusta los permisos del archivo tras guardarlo; en sistemas sin POSIX no falla. */
export function restrictOnwayProfileFile(account: string): void {
  try { chmodSync(onwayProfilePath(account), PROFILE_FILE_MODE) } catch { /* sin permisos POSIX */ }
}

/**
 * Guarda cookies y localStorage del contexto.
 *
 * Best-effort a propósito: si el volumen no está montado o no es escribible, la
 * lectura del portal sigue; lo único que se pierde es la próxima corrida sin
 * CAPTCHA. Nunca lanza.
 */
export async function saveOnwayProfile(context: BrowserContext, account: string): Promise<boolean> {
  try {
    if (!ensureOnwayProfileDir()) return false
    await context.storageState({ path: onwayProfilePath(account) })
    restrictOnwayProfileFile(account)
    return true
  } catch {
    return false
  }
}

/**
 * Restaura la sesión anterior en el contexto recién creado.
 *
 * Sólo añade cookies: son las que llevan la sesión de Auth0 y `_GRECAPTCHA`,
 * que es de donde cuelga la reputación del navegador. Si el archivo está
 * corrupto o vencido, el flujo cae al login normal, como hasta hoy. Nunca lanza.
 */
export async function restoreOnwayProfile(context: BrowserContext, account: string): Promise<boolean> {
  try {
    const path = onwayProfilePath(account)
    if (!existsSync(path)) return false
    const cookies = readCookieState(path)
    if (cookies.length === 0) return false
    await context.addCookies(cookies)
    return true
  } catch {
    return false
  }
}

function readCookieState(path: string): NonNullable<Parameters<BrowserContext["addCookies"]>[0]> {
  const raw = JSON.parse(readFileSync(path, "utf8")) as {
    cookies?: NonNullable<Parameters<BrowserContext["addCookies"]>[0]>
  }
  if (!Array.isArray(raw.cookies)) return []
  // Una cookie sin dominio no se puede restaurar y `addCookies` falla por todas.
  return raw.cookies.filter((cookie) => typeof cookie?.domain === "string" && typeof cookie?.name === "string")
}

/**
 * Borra la sesión guardada de una cuenta.
 *
 * Es la última salida del referente (`recrearNavegador`): un perfil que falló un
 * captcha queda marcado y el portal repite el mismo desafío, así que ninguna
 * consulta vuelve a pasar. Se invoca a mano desde administración, nunca de forma
 * automática: perder la sesión significa volver a resolver el primer CAPTCHA.
 */
export function resetOnwayProfile(account: string): boolean {
  const path = onwayProfilePath(account)
  if (!existsSync(path)) return false
  rmSync(path, { force: true })
  return true
}
