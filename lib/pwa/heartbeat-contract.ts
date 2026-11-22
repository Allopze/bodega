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

const isoOrNull = z.string().datetime({ offset: true }).nullable()
const count = z.number().int().min(0).max(HEARTBEAT_LIMITS.maxCount)

export const pwaHeartbeatSchema = z.object({
  app:             z.enum(FIELD_APP_IDS as [FieldAppId, ...FieldAppId[]]),
  deviceId:        z.string().uuid(),
  version:         z.string().trim().min(1).max(HEARTBEAT_LIMITS.versionChars),
  builtAt:         isoOrNull,
  installed:       z.boolean(),
  platform:        z.string().trim().min(1).max(HEARTBEAT_LIMITS.platformChars),
  pending:         count,
  failed:          count,
  oldestPendingAt: isoOrNull,
  lastAttemptAt:   isoOrNull,
  lastError:       z.string().max(HEARTBEAT_LIMITS.errorChars).nullable(),
  worksiteId:      z.string().min(1).max(64).optional(),
  linkHash:        z.string().regex(/^[0-9a-f]{64}$/).optional(),
}).strict()

export type PwaHeartbeat = z.infer<typeof pwaHeartbeatSchema>
