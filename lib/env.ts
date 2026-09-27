/**
 * Centralized environment-variable validation.
 *
 * Call `validateEnv()` once at startup (instrumentation.ts).
 * Throws with a descriptive message if any required variable is absent,
 * so the server fails immediately instead of deep inside a request.
 *
 * Parsed typed values are exported for use across the app instead of
 * scattering `process.env.*` reads throughout the codebase.
 */

import { addDaysToPlainDate, chileLocalDateTimeToUtc } from "@/lib/utils"

const REQUIRED = ["AUTH_SECRET", "DATABASE_URL"] as const

/** PREV-M06: días de vigencia del enlace público de acuse si no se configura otro. */
export const PREVENTION_ACK_TTL_DAYS_DEFAULT = 14
const PREVENTION_ACK_TTL_DAYS_MAX = 90

/**
 * PREV-M06: vigencia, en días, del enlace público de acuse. Entero 1–90; vacío
 * = 14. Un valor que no se entiende es un error de configuración y se rechaza:
 * emitir enlaces con un plazo distinto del que el operador cree haber puesto es
 * peor que no arrancar.
 */
export function parsePreventionAckTtlDays(raw: string | undefined): number {
  const value = raw?.trim()
  if (!value) return PREVENTION_ACK_TTL_DAYS_DEFAULT
  if (!/^\d+$/.test(value) || Number(value) < 1 || Number(value) > PREVENTION_ACK_TTL_DAYS_MAX) {
    throw new Error(
      `[env] PREVENTION_ACK_TTL_DAYS debe ser un entero de días entre 1 y ${PREVENTION_ACK_TTL_DAYS_MAX} (valor recibido: "${value}").`,
    )
  }
  return Number(value)
}

/**
 * PREV-M06: hasta cuándo se aceptan los enlaces de acuse v1 (sin vencimiento)
 * emitidos antes del despliegue. Fecha `AAAA-MM-DD` en hora de Chile, inclusive:
 * el corte es la medianoche chilena del día siguiente. Vacío = sin ventana (los
 * v1 se rechazan). Devuelve el instante del corte.
 */
export function parsePreventionAckLegacyUntil(raw: string | undefined): Date | null {
  const value = raw?.trim()
  if (!value) return null
  const valid = /^\d{4}-\d{2}-\d{2}$/.test(value) && addDaysToPlainDate(value, 0) === value
  if (!valid) {
    throw new Error(
      `[env] PREVENTION_ACK_LEGACY_UNTIL debe ser una fecha AAAA-MM-DD válida (hora de Chile) o quedar vacía (valor recibido: "${value}").`,
    )
  }
  return new Date(chileLocalDateTimeToUtc(`${addDaysToPlainDate(value, 1)}T00:00`))
}

export function validateEnv(): void {
  const missing = REQUIRED.filter((key) => !process.env[key]?.trim())
  if (missing.length > 0) {
    throw new Error(
      `[env] Variables requeridas no configuradas: ${missing.join(", ")}.\n` +
        "Consulta .env.example para instrucciones de configuración.",
    )
  }
  // Opcionales, pero si vienen deben entenderse (PREV-M06).
  parsePreventionAckTtlDays(process.env.PREVENTION_ACK_TTL_DAYS)
  parsePreventionAckLegacyUntil(process.env.PREVENTION_ACK_LEGACY_UNTIL)
}

export const env = {
  authSecret:       process.env.AUTH_SECRET!,
  databaseUrl:      process.env.DATABASE_URL!,
  nodeEnv:          (process.env.NODE_ENV ?? "development") as "development" | "production" | "test",

  // Optional — gracefully degrade if absent
  appUrl:           process.env.APP_URL?.trim() || null,
  resendApiKey:     process.env.RESEND_API_KEY?.trim() || null,
  storagePath:      process.env.STORAGE_PATH?.trim() || null,

  // Numeric with defaults
  taxRate:          Number(process.env.TAX_RATE ?? 0.19),
  pdfMaxConcurrent: Number(process.env.PDF_MAX_CONCURRENT ?? 2),
} as const
