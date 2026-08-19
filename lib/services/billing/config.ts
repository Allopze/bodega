/**
 * lib/services/billing/config.ts
 *
 * Configuración y feature flags del módulo de Facturación y Cobranza.
 *
 * Todo se lee **solo en el servidor**. Ninguna variable lleva prefijo
 * `NEXT_PUBLIC_`: las credenciales de un proveedor financiero no entran al
 * bundle del cliente bajo ninguna circunstancia.
 */

/* ── Sincronización de ventas (FacturaEnLínea) ───────────────────────────── */

export interface BillingSalesSyncConfig {
  /** Habilita la sincronización automática de ventas por cron. */
  enabled: boolean
  /**
   * Período más antiguo que una importación histórica puede alcanzar, "YYYY-MM".
   * Existe para que un error de tipeo no dispare una descarga de 10 años.
   */
  historyFloor: string
}

export function readSalesSyncConfig(): BillingSalesSyncConfig {
  return {
    enabled: process.env.BILLING_SALES_SYNC_ENABLED?.trim().toLowerCase() === "true",
    historyFloor: normalizePeriod(process.env.BILLING_HISTORY_FLOOR) ?? "2024-01",
  }
}

/* ── Chipax ──────────────────────────────────────────────────────────────── */

export interface ChipaxConfig {
  /** Feature flag. Apagado por defecto. */
  enabled: boolean
  /** Automatización diaria; puede quedar apagada para uso manual. */
  syncEnabled: boolean
  /** URL del contrato OpenAPI. */
  openApiUrl: string
  /** URL base de la API. Ver `DEFAULT_CHIPAX_BASE_URL`. */
  baseUrl: string
  /**
   * Credenciales de aplicación. **Nunca se exponen ni se loguean**: solo se
   * consulta `hasCredentials` fuera de la capa de autenticación.
   */
  appId: string
  secretKey: string
  /** True si ambas credenciales están presentes. */
  hasCredentials: boolean
  /**
   * RUT de la empresa emisora, para las facturas de venta que Chipax devuelve
   * sin identificar al emisor (obvio para Chipax: es la cuenta). Cae al RUT ya
   * configurado del portal DTE, que es la misma empresa.
   */
  companyTaxId: string
  /** Timeout por request. */
  requestTimeoutMs: number
}

const DEFAULT_CHIPAX_OPENAPI_URL = "https://api.chipax.com/v2/swagger-docs/"

/**
 * URL base verificada empíricamente el 2026-08-05, no asumida:
 *
 *   POST https://api.chipax.com/v2/login  {}                        → 400 "Parámetros inválidos."
 *   POST https://api.chipax.com/v2/login  {usuario, clave}          → 400 "Parámetros inválidos."
 *   POST https://api.chipax.com/v2/login  {app_id, secret_key}      → 401 "Credenciales inválidas"
 *
 * El 401 frente al 400 del control demuestra que la ruta existe bajo `/v2` y
 * que acepta ese cuerpo. Sigue siendo sobrescribible con `CHIPAX_API_BASE_URL`
 * por si el bloque `servers` del contrato indica otra cosa.
 */
const DEFAULT_CHIPAX_BASE_URL = "https://api.chipax.com/v2"

/**
 * Configuración de Chipax **según el entorno**, sin tocar la base de datos.
 *
 * Es el respaldo, no la fuente de verdad: quien quiera la configuración vigente
 * debe usar `readChipaxConfig()` de `./chipax-settings`, que superpone lo que se
 * haya guardado desde la plataforma. Esta función sigue existiendo porque ese
 * respaldo tiene que poder leerse sin BD (y porque `system_settings` no guarda
 * la URL base ni el timeout: eso es del despliegue, no del operador).
 */
export function readChipaxEnvConfig(): ChipaxConfig {
  const appId = process.env.CHIPAX_APP_ID?.trim() ?? ""
  const secretKey = process.env.CHIPAX_SECRET_KEY?.trim() ?? ""

  return {
    enabled: process.env.BILLING_CHIPAX_ENABLED?.trim().toLowerCase() === "true",
    syncEnabled: process.env.BILLING_CHIPAX_SYNC_ENABLED?.trim().toLowerCase() === "true",
    openApiUrl: process.env.CHIPAX_OPENAPI_URL?.trim() || DEFAULT_CHIPAX_OPENAPI_URL,
    baseUrl: (process.env.CHIPAX_API_BASE_URL?.trim() || DEFAULT_CHIPAX_BASE_URL).replace(/\/+$/, ""),
    appId,
    secretKey,
    hasCredentials: Boolean(appId && secretKey),
    companyTaxId:
      process.env.BILLING_COMPANY_TAX_ID?.trim() ||
      process.env.DTE_PORTAL_RUT_EMP?.trim() ||
      "",
    requestTimeoutMs: parsePositiveInt(process.env.CHIPAX_REQUEST_TIMEOUT_MS, 30_000),
  }
}

/* ── Conciliación de pagos ───────────────────────────────────────────────── */

export interface ReconciliationConfig {
  /**
   * Diferencia máxima, en pesos, para considerar que un movimiento calza con el
   * total de una factura. Un peso de diferencia es redondeo bancario; mil no.
   */
  amountToleranceClp: number
  /** Días de ventana alrededor del vencimiento para buscar el pago. */
  dateWindowDays: number
}

export function readReconciliationConfig(): ReconciliationConfig {
  return {
    amountToleranceClp: parsePositiveInt(process.env.BILLING_MATCH_AMOUNT_TOLERANCE_CLP, 1000),
    dateWindowDays: parsePositiveInt(process.env.BILLING_MATCH_DATE_WINDOW_DAYS, 60),
  }
}

/* ── Antigüedad de deuda ─────────────────────────────────────────────────── */

/**
 * Tramos de antigüedad, en un solo lugar para que reportes y dashboard no se
 * contradigan. `maxDays: null` = el último tramo, abierto.
 */
export const AGING_BUCKETS = [
  { id: "not_due",   label: "No vencida",      minDays: null, maxDays: 0 },
  { id: "d1_30",     label: "1–30 días",       minDays: 1,    maxDays: 30 },
  { id: "d31_60",    label: "31–60 días",      minDays: 31,   maxDays: 60 },
  { id: "d61_90",    label: "61–90 días",      minDays: 61,   maxDays: 90 },
  { id: "d90_plus",  label: "Más de 90 días",  minDays: 91,   maxDays: null },
] as const

export type AgingBucketId = typeof AGING_BUCKETS[number]["id"]

/** Clasifica días de atraso (negativo = aún no vence) en un tramo. */
export function agingBucketFor(daysOverdue: number): AgingBucketId {
  if (daysOverdue <= 0) return "not_due"
  if (daysOverdue <= 30) return "d1_30"
  if (daysOverdue <= 60) return "d31_60"
  if (daysOverdue <= 90) return "d61_90"
  return "d90_plus"
}

/* ── Helpers ─────────────────────────────────────────────────────────────── */

function parsePositiveInt(value: string | undefined, fallback: number): number {
  if (!value) return fallback
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed >= 0 ? Math.trunc(parsed) : fallback
}

function normalizePeriod(value: string | undefined): string | null {
  const trimmed = value?.trim()
  return trimmed && /^\d{4}-(0[1-9]|1[0-2])$/.test(trimmed) ? trimmed : null
}
