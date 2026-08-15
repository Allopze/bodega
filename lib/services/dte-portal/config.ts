/**
 * lib/services/dte-portal/config.ts
 *
 * Configuración del portal DTE. Dos capas:
 *
 * 1. `readDtePortalEnv()` — la capa de variables de entorno (DTE_PORTAL_*),
 *    síncrona y sin tocar la base de datos. Es el fallback.
 * 2. `readDtePortalConfig()` — la configuración EFECTIVA: lo guardado en
 *    `system_settings` desde Administración › Sincronización DTE gana sobre
 *    el .env; lo no guardado cae a la variable de entorno y luego al default.
 *
 * Patrón: similar a COPEC_USERNAME/PASSWORD + RESEND_API_KEY.
 * Nunca exponer credenciales en logs.
 *
 * Variables de entorno (fallback):
 *   DTE_PORTAL_BASE_URL      - URL base del portal (default: https://clientes.dtefacturaenlinea.cl/facturaenlinea)
 *   DTE_PORTAL_RUT_USR       - RUT del usuario individual
 *   DTE_PORTAL_RUT_EMP       - RUT de la empresa
 *   DTE_PORTAL_CLAVE         - Contraseña
 *   DTE_PORTAL_CODEMP        - Código interno de empresa en el portal
 *   DTE_SYNC_IMPORTER_EMAIL  - Email del usuario técnico para resolver el "importer"
 *   DTE_SYNC_DELAY_MS        - Milisegundos entre requests (default: 500)
 *   DTE_SYNC_ENABLED         - "true" para habilitar la sincronización
 */

import type { DtePortalClientConfig, DtePortalCredentials } from "./types"
import { readStoredDteSettingsStrict } from "./settings"
import { DTE_PORTAL_BASE_URL, assertDtePortalBaseUrl } from "./portal-origin"
import { readDteSettingsKeyring } from "./settings-crypto"

const DEFAULT_DELAY_MS = 500
// La Bandeja de Entrada (PNC_PanelCorreo.php) puede tardar ~80s en responder
// para un mes de alto volumen (verificado: 681 documentos); 30s cortaba la
// consulta antes de tiempo. paneldte.php responde en <1s, así que un timeout
// más alto acá no le cuesta nada.
const DEFAULT_TIMEOUT_MS = 120_000

export interface DtePortalEnvConfig {
  baseUrl: string
  credentials: DtePortalCredentials
  delayMs: number
  requestTimeoutMs: number
  syncEnabled: boolean
  importerEmail: string | null
}

/**
 * Lee las variables de entorno y construye la configuración.
 * No lanza error si faltan credenciales — retorna el estado para que
 * el caller decida si proceder. Es la capa de fallback: los valores
 * guardados en `system_settings` la reemplazan (ver readDtePortalConfig).
 */
export function readDtePortalEnv(): DtePortalEnvConfig {
  return {
    baseUrl: assertDtePortalBaseUrl(process.env.DTE_PORTAL_BASE_URL),
    credentials: {
      rutUsr: process.env.DTE_PORTAL_RUT_USR?.trim() ?? "",
      rutEmp: process.env.DTE_PORTAL_RUT_EMP?.trim() ?? "",
      // La contraseña es opaca: quitar espacios cambia el secreto. El panel
      // persistido ya conserva exactamente el valor ingresado.
      clave: process.env.DTE_PORTAL_CLAVE ?? "",
      codEmp: process.env.DTE_PORTAL_CODEMP?.trim() ?? "",
    },
    delayMs: parseIntStrict(process.env.DTE_SYNC_DELAY_MS, DEFAULT_DELAY_MS),
    requestTimeoutMs: DEFAULT_TIMEOUT_MS,
    syncEnabled: process.env.DTE_SYNC_ENABLED?.trim().toLowerCase() === "true",
    importerEmail: process.env.DTE_SYNC_IMPORTER_EMAIL?.trim() || null,
  }
}

function parseIntStrict(value: string | undefined, fallback: number): number {
  if (!value) return fallback
  const n = Number(value)
  return Number.isFinite(n) && n >= 0 ? Math.trunc(n) : fallback
}

/**
 * Configuración EFECTIVA del portal DTE: lo guardado en `system_settings`
 * (panel de Administración) gana sobre la variable de entorno; lo no
 * guardado cae a `DTE_PORTAL_*` y luego al default.
 */
export async function readDtePortalConfig(): Promise<DtePortalEnvConfig> {
  const env = readDtePortalEnv()
  // A runtime read must fail closed. Falling back to DTE_PORTAL_* after an
  // unknown database outage could resurrect an old plaintext credential after
  // the durable encrypted-only cutover.
  const stored = await readStoredDteSettingsStrict()
  const keyring = readDteSettingsKeyring()
  // The controlled conversion persists a one-way cutover barrier in addition
  // to the host mode. That means a later clear/reset can never revive a stale
  // plaintext DTE_PORTAL_* value while an operator is rotating credentials.
  const allowEnvironmentFallback = keyring.mode === "compat" && stored.encryptionMode !== "encrypted_only"

  const storedOrEnvironment = (storedValue: string | undefined, environmentValue: string) =>
    storedValue !== undefined ? storedValue : allowEnvironmentFallback ? environmentValue : ""

  return {
    // `dte.base_url` can exist from legacy releases, but it is never used as
    // an override: the portal origin is one fixed, centrally checked value.
    baseUrl: assertDtePortalBaseUrl(DTE_PORTAL_BASE_URL),
    credentials: {
      rutUsr: storedOrEnvironment(stored.rutUsr?.trim(), env.credentials.rutUsr),
      rutEmp: storedOrEnvironment(stored.rutEmp?.trim(), env.credentials.rutEmp),
      clave: storedOrEnvironment(stored.clave, env.credentials.clave),
      codEmp: storedOrEnvironment(stored.codEmp?.trim(), env.credentials.codEmp),
    },
    delayMs: parseIntStrict(stored.delayMs, env.delayMs),
    requestTimeoutMs: env.requestTimeoutMs,
    syncEnabled:
      stored.syncEnabled !== undefined
        ? stored.syncEnabled === "true"
        : allowEnvironmentFallback && env.syncEnabled,
    importerEmail: stored.importerEmail !== undefined
      ? stored.importerEmail.trim() || null
      : allowEnvironmentFallback ? env.importerEmail : null,
  }
}

/**
 * Valida que las credenciales efectivas estén presentes y retorna un
 * DtePortalClientConfig listo para usar.
 *
 * @throws Error si alguna credencial está vacía.
 */
export async function buildDtePortalClientConfig(): Promise<DtePortalClientConfig> {
  const config = await readDtePortalConfig()

  const missing: string[] = []
  if (!config.credentials.rutUsr) missing.push("DTE_PORTAL_RUT_USR")
  if (!config.credentials.rutEmp) missing.push("DTE_PORTAL_RUT_EMP")
  if (!config.credentials.clave) missing.push("DTE_PORTAL_CLAVE")
  if (!config.credentials.codEmp) missing.push("DTE_PORTAL_CODEMP")

  if (missing.length > 0) {
    throw new Error(
      `Faltan credenciales para el portal DTE: ${missing.join(", ")}. ` +
      `Configúrelas en Administración › Sincronización DTE o en las variables de entorno (DTE_PORTAL_*).`,
    )
  }

  return {
    baseUrl: config.baseUrl,
    credentials: config.credentials,
    delayMs: config.delayMs,
    requestTimeoutMs: config.requestTimeoutMs,
  }
}

/**
 * Retorna true si la sincronización DTE está habilitada y configurada
 * (con la configuración efectiva: base de datos + variables de entorno).
 */
export async function isDteSyncEnabled(): Promise<boolean> {
  const config = await readDtePortalConfig()
  return (
    config.syncEnabled &&
    Boolean(config.credentials.rutUsr) &&
    Boolean(config.credentials.rutEmp) &&
    Boolean(config.credentials.clave) &&
    Boolean(config.credentials.codEmp)
  )
}
