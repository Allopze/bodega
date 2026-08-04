/**
 * lib/services/dte-portal/config.ts
 *
 * Lee la configuración del portal DTE desde variables de entorno y construye
 * el DtePortalClientConfig.
 *
 * Patrón: similar a COPEC_USERNAME/PASSWORD + RESEND_API_KEY.
 * Nunca exponer credenciales en logs.
 *
 * Variables de entorno:
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

const DEFAULT_BASE_URL = "https://clientes.dtefacturaenlinea.cl/facturaenlinea"
const DEFAULT_DELAY_MS = 500
const DEFAULT_TIMEOUT_MS = 30_000

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
 * el caller decida si proceder.
 */
export function readDtePortalEnv(): DtePortalEnvConfig {
  return {
    baseUrl: process.env.DTE_PORTAL_BASE_URL?.trim() || DEFAULT_BASE_URL,
    credentials: {
      rutUsr: process.env.DTE_PORTAL_RUT_USR?.trim() ?? "",
      rutEmp: process.env.DTE_PORTAL_RUT_EMP?.trim() ?? "",
      clave: process.env.DTE_PORTAL_CLAVE?.trim() ?? "",
      codEmp: process.env.DTE_PORTAL_CODEMP?.trim() ?? "",
    },
    delayMs: parseInt(process.env.DTE_SYNC_DELAY_MS ?? "", 10) || DEFAULT_DELAY_MS,
    requestTimeoutMs: DEFAULT_TIMEOUT_MS,
    syncEnabled: process.env.DTE_SYNC_ENABLED?.trim().toLowerCase() === "true",
    importerEmail: process.env.DTE_SYNC_IMPORTER_EMAIL?.trim() || null,
  }
}

/**
 * Valida que las credenciales estén presentes y retorna un
 * DtePortalClientConfig listo para usar.
 *
 * @throws Error si alguna credencial está vacía.
 */
export function buildDtePortalClientConfig(): DtePortalClientConfig {
  const env = readDtePortalEnv()

  const missing: string[] = []
  if (!env.credentials.rutUsr) missing.push("DTE_PORTAL_RUT_USR")
  if (!env.credentials.rutEmp) missing.push("DTE_PORTAL_RUT_EMP")
  if (!env.credentials.clave) missing.push("DTE_PORTAL_CLAVE")
  if (!env.credentials.codEmp) missing.push("DTE_PORTAL_CODEMP")

  if (missing.length > 0) {
    throw new Error(
      `Faltan variables de entorno para el portal DTE: ${missing.join(", ")}. ` +
      `Configúrelas en .env o en las variables de entorno del servidor.`,
    )
  }

  return {
    baseUrl: env.baseUrl,
    credentials: env.credentials,
    delayMs: env.delayMs,
    requestTimeoutMs: env.requestTimeoutMs,
  }
}

/**
 * Retorna true si la sincronización DTE está habilitada y configurada.
 */
export function isDteSyncEnabled(): boolean {
  const env = readDtePortalEnv()
  return (
    env.syncEnabled &&
    Boolean(env.credentials.rutUsr) &&
    Boolean(env.credentials.rutEmp) &&
    Boolean(env.credentials.clave) &&
    Boolean(env.credentials.codEmp)
  )
}
