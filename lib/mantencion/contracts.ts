import { z } from "zod"
import type { MantEquipmentState, MantReview, MantRecordStatus, MantScheduleSnapshot, MantUnit } from "./types"

/**
 * Contrato de la sincronización entre la app del mecánico y el servidor
 * (§9 y §11). La app valida con estos mismos esquemas antes de encolar y el
 * servidor vuelve a validar al recibir: nunca confía en el cliente.
 *
 * Autenticación: todas las rutas `/api/mantencion/sync/*` exigen
 * `Authorization: Bearer <credencial de dispositivo>` (ver
 * `POST /api/mantencion/dispositivo`). La credencial identifica al autor; la
 * sesión del navegador no cuenta para estas rutas.
 */

const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, "Identificador inválido")
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha inválida")
const isoDateTime = z.string().datetime({ offset: true })
const id = z.string().min(1).max(64)

// ── Credencial de dispositivo ────────────────────────────────────────────────

export const deviceCredentialRequestSchema = z.object({
  deviceId: uuid,
  label: z.string().trim().max(120).optional(),
})
export type DeviceCredentialRequest = z.infer<typeof deviceCredentialRequestSchema>

export interface DeviceCredentialResponse {
  token: string
  expiresAt: string
  user: { id: string; name: string; email: string }
}

// ── Fotos: PUT /api/mantencion/sync/fotos/{id} (multipart: `file` + `meta`) ──

export const MANT_PHOTO_MAX_BYTES = 10 * 1024 * 1024

export const photoMetaSchema = z.object({
  kind: z.enum(["filtros", "sticker", "correctiva"]),
  sha256: z.string().regex(/^[0-9a-f]{64}$/, "Huella inválida"),
  width: z.number().int().positive().max(10_000),
  height: z.number().int().positive().max(10_000),
  stampedAt: isoDateTime,
  takenAtExif: isoDateTime.nullable(),
  exif: z.record(z.string(), z.string().max(200)).nullable(),
  deviceId: uuid,
})
export type PhotoMeta = z.infer<typeof photoMetaSchema>

// ── Registros: POST /api/mantencion/sync/registros ───────────────────────────

const recordBase = {
  id: uuid,
  vehicleId: id,
  reading: z.number().finite().min(0).max(99_999_999),
  workDate: isoDate,
  signedAt: isoDateTime,
  /** Desde cuándo el teléfono estaba sin señal al firmar; null si firmó con señal. */
  offlineSince: isoDateTime.nullable(),
  deviceId: uuid,
  appVersion: z.string().max(40),
  readingJumpConfirmed: z.boolean(),
  duplicateConfirmed: z.boolean(),
  correctsRecordId: uuid.nullable(),
  photos: z.array(z.object({ id: uuid, kind: z.enum(["filtros", "sticker", "correctiva"]) })).min(1).max(3),
}

export const preventiveRecordSchema = z.object({
  ...recordBase,
  kind: z.literal("P"),
  scheduleId: id,
  scheduleVersion: z.number().int().positive(),
  intervalValue: z.number().int().positive(),
  suggestedIntervalValue: z.number().int().positive(),
  manualScheduleReason: z.string().trim().max(500).nullable(),
  items: z.array(z.object({
    itemKey: z.string().min(1).max(64),
    value: z.enum(["R", "NR", "NA"]),
    reason: z.string().trim().max(300).nullable(),
  })).min(1).max(300),
  notes: z.string().trim().min(3, "Escribe una observación («sin novedad» si no hay nada).").max(2000),
})

export const correctiveExecutorSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("yo") }),
  z.object({ kind: z.literal("otro_mecanico"), userId: id }),
  z.object({ kind: z.literal("externo"), workshopId: id }),
])

export const correctiveRecordSchema = z.object({
  ...recordBase,
  kind: z.literal("C"),
  workTypeIds: z.array(id).min(1, "Marca al menos un tipo de trabajo."),
  /** Vacío sólo si `noOilChange`. */
  oilIds: z.array(id),
  noOilChange: z.boolean(),
  executor: correctiveExecutorSchema,
  description: z.string().trim().min(5, "Describe el trabajo realizado.").max(4000),
  parts: z.array(z.object({
    quantity: z.number().positive().max(100_000),
    description: z.string().trim().min(1).max(300),
  })).max(50),
  noParts: z.boolean(),
  hours: z.number().min(0.5).max(72).refine((value) => Number.isInteger(value * 2), "Las horas van en pasos de 0,5."),
  inWorkshop: z.boolean(),
  workshopEntryDate: isoDate.nullable(),
  workOrder: z.string().trim().max(60).nullable(),
  driverIds: z.array(id).min(1, "Agrega al menos un conductor.").max(20),
})

export const syncRecordSchema = z.discriminatedUnion("kind", [preventiveRecordSchema, correctiveRecordSchema])
export type SyncRecord = z.infer<typeof syncRecordSchema>
export type SyncPreventiveRecord = z.infer<typeof preventiveRecordSchema>
export type SyncCorrectiveRecord = z.infer<typeof correctiveRecordSchema>

export type SyncWarningCode = "reading_jump" | "duplicate" | "out_of_worksite" | "hours_over_12" | "schedule_outdated"

export interface SyncWarning {
  code: SyncWarningCode
  message: string
  /** Registro relacionado (la preventiva duplicada). */
  recordId?: string
  folio?: string | null
}

/**
 * Respuesta del envío. `ok: true` también cuando el registro ya existía
 * (idempotencia): mismo folio, misma hora de recepción.
 *
 * `ok: false` con HTTP 409/422 es un RECHAZO definitivo: la app lo deja como
 * «Rechazado» con el motivo y la opción de corregir y reenviar; nunca lo
 * descarta. HTTP 401/403 = credencial vencida o revocada (pedir entrar de
 * nuevo). 408/429/5xx o error de red = reintento con backoff.
 */
export type SyncRecordResponse =
  | { ok: true; id: string; folio: string; receivedAt: string; duplicate: boolean; warnings: SyncWarning[] }
  | { ok: false; code: "rejected" | "invalid" | "missing_photos" | "unauthorized" | "forbidden" | "rate_limited" | "error"; message: string; field?: string }

// ── Taller: POST /api/mantencion/sync/taller ─────────────────────────────────

export const workshopUpdateSchema = z.discriminatedUnion("kind", [
  z.object({ id: uuid, recordId: uuid, kind: z.literal("sigue"), note: z.string().trim().min(3, "Cuenta en qué está el equipo.").max(1000), createdAt: isoDateTime, deviceId: uuid }),
  z.object({ id: uuid, recordId: uuid, kind: z.literal("salio"), exitDate: isoDate, createdAt: isoDateTime, deviceId: uuid }),
])
export type WorkshopUpdatePayload = z.infer<typeof workshopUpdateSchema>

// ── Respuesta a una observación: POST /api/mantencion/sync/observaciones ────

export const observationReplySchema = z.object({
  observationId: id,
  response: z.string().trim().min(2).max(2000),
})
export type ObservationReply = z.infer<typeof observationReplySchema>

// ── Catálogo: GET /api/mantencion/sync/catalogo[?alcance=todos] (ETag) ──────

export interface CatalogEquipment {
  id: string
  code: string
  plate: string
  noPlate: boolean
  typeName: string
  unit: MantUnit
  brandId: string
  brandName: string
  model: string | null
  worksiteId: string
  worksiteName: string
  scheduleId: string | null
  /** Lecturas vigentes recientes (hasta 12) + la inicial, para validar sin señal (regla 2). */
  readings: Array<{ value: number; date: string; source: string }>
  initialReading: { value: number; date: string } | null
  state: MantEquipmentState
  nextReading: number | null
  remaining: number | null
  nextIntervalValue: number | null
  lastPreventive: { reading: number; date: string; intervalValue: number } | null
  /** Preventivas vigentes recientes (hasta 5), para el aviso de duplicado (regla 7). */
  recentPreventives: Array<{ id: string; folio: string | null; reading: number; date: string; intervalValue: number }>
  /** Correctiva abierta con el equipo en taller (regla 11). */
  workshop: { recordId: string; folio: string | null; entryDate: string | null; lastActivityDate: string; stale: boolean; daysStopped: number | null } | null
}

export interface CatalogOwnRecord {
  id: string
  folio: string | null
  kind: "P" | "C"
  equipmentCode: string
  equipmentPlate: string
  workDate: string
  receivedAt: string
  status: MantRecordStatus
  review: MantReview
  intervalValue: number | null
  unit: MantUnit
}

export interface CatalogObservation {
  id: string
  recordId: string
  folio: string | null
  equipmentCode: string
  text: string
  by: string
  createdAt: string
  response: string | null
}

export interface MantCatalog {
  /** Igual al ETag de la respuesta. */
  version: string
  generatedAt: string
  user: { id: string; name: string; worksiteIds: string[] }
  worksites: Array<{ id: string; name: string }>
  /** `alcance=mias` (por defecto): equipos activos de sus faenas, completos. */
  equipment: CatalogEquipment[]
  schedules: MantScheduleSnapshot[]
  brands: Array<{ id: string; name: string }>
  workshops: Array<{ id: string; name: string }>
  drivers: Array<{ id: string; name: string }>
  workTypes: Array<{ id: string; name: string }>
  oils: Array<{ id: string; name: string }>
  /** Personas que pueden figurar como «otro mecánico» (tienen la app y comparten faena). */
  mechanics: Array<{ id: string; name: string }>
  myRecords: CatalogOwnRecord[]
  observations: CatalogObservation[]
}

/** `alcance=todos`: el resto de los equipos activos, en versión liviana (sin historial). */
export type CatalogOtherEquipment = Omit<CatalogEquipment, "recentPreventives" | "workshop"> & { recentPreventives: []; workshop: null }

export interface MantCatalogOthers {
  version: string
  equipment: CatalogOtherEquipment[]
}
