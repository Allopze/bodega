/**
 * lib/pwa/heartbeat-contract.ts — Formato del aviso que cada app del teléfono
 * manda a `POST /api/pwa/aviso`.
 *
 * La ruta es pública (PPA y TAE no tienen login), así que el esquema es estricto
 * y todo está acotado: un campo extra o una cadena larga se rechazan sin
 * escribir nada. No lleva datos del trabajador ni el token de TAE en claro
 * (sólo su SHA-256, que es lo que guarda `fuel_tae_public_links.token_hash`).
 *
 * El cliente importa sólo el tipo (`import type`) para no cargar zod en las apps.
 */
import { z } from "zod"
import { FIELD_APP_IDS, type FieldAppId } from "@/lib/apps/field-apps"

export const HEARTBEAT_LIMITS = {
  maxCount:      10_000,
  errorChars:    200,
  versionChars:  40,
  platformChars: 60,
  maxBodyBytes:  4096,
} as const

/**
 * Fecha mínima aceptada en cualquier marca de tiempo. Zod deja pasar
 * `0000-01-01T00:00:00Z`, que Postgres rechaza al insertar («date/time field
 * value out of range») y la ruta, pública, respondía 500 y mandaba un evento a
 * Sentry por cada petición. Ningún teléfono con estas apps existía antes.
 */
export const HEARTBEAT_MIN_DATE = "2020-01-01T00:00:00.000Z"
export const HEARTBEAT_MIN_MS = Date.parse(HEARTBEAT_MIN_DATE)

/** Sin caracteres de control (incluido NUL, que Postgres no admite en `text`). */
const NO_CONTROL_CHARS = /^[^\u0000-\u001F\u007F]*$/

/**
 * Cadena sin caracteres de control. Va ANTES de `.trim()`: un `\n` al borde se
 * recortaría y dejaría pasar justo lo que se quiere rechazar.
 */
const text = () => z.string().regex(NO_CONTROL_CHARS, "caracteres de control")

const isoDate = z.string()
  .datetime({ offset: true })
  .refine((value) => Date.parse(value) >= HEARTBEAT_MIN_MS, "fecha anterior a 2020")
const isoOrNull = isoDate.nullable()
const count = z.number().int().min(0).max(HEARTBEAT_LIMITS.maxCount)

export const pwaHeartbeatSchema = z.object({
  app:             z.enum(FIELD_APP_IDS as [FieldAppId, ...FieldAppId[]]),
  deviceId:        z.string().uuid(),
  version:         text().trim().min(1).max(HEARTBEAT_LIMITS.versionChars),
  builtAt:         isoOrNull,
  /** Hora del reloj del teléfono al mandar el aviso: el servidor la usa para corregir el desfase de ese reloj. */
  sentAt:          isoDate,
  installed:       z.boolean(),
  platform:        text().trim().min(1).max(HEARTBEAT_LIMITS.platformChars),
  pending:         count,
  failed:          count,
  oldestPendingAt: isoOrNull,
  lastAttemptAt:   isoOrNull,
  lastError:       text().max(HEARTBEAT_LIMITS.errorChars).nullable(),
  worksiteId:      text().min(1).max(64).optional(),
  linkHash:        z.string().regex(/^[0-9a-f]{64}$/).optional(),
}).strict()

export type PwaHeartbeat = z.infer<typeof pwaHeartbeatSchema>
