import { z } from "zod"
import type { MantEquipmentState, MantExecutorKind, MantItemValue, MantPhotoKind, MantRecordKind, MantReview, MantRecordStatus, MantScheduleSnapshot, MantUnit } from "./types"
import type { OtItemDone, OtItemKind, OtItemOrigin, OtStatus } from "./work-order-states"

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

// ── Registro desde el PC (formulario web de la OT) ──────────────────────────

/**
 * Dispositivo y versión con los que queda un registro firmado desde el PC (la
 * ficha de la OT) y no desde la app: así se distingue en la bitácora y en la
 * fila. El servidor los impone; lo que mande el navegador no cuenta.
 */
export const MANT_WEB_DEVICE_ID = "00000000-0000-4000-8000-00000000c0de"
export const MANT_WEB_APP_VERSION = "web"
/** Lo que Chrome de escritorio decodifica sin ayuda: HEIC (iPhone) no, y por eso no se acepta. */
export const MANT_WEB_PHOTO_TYPES = ["image/jpeg", "image/png"] as const
/** Campos del `FormData` del registro web: `record` (JSON del contrato) y, por foto, el archivo y su `meta` en JSON. */
export const webPhotoField = (id: string) => `photo:${id}`
export const webMetaField = (id: string) => `meta:${id}`

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
  /**
   * OT a la que pertenece el trabajo (2026-11). Opcional, no sólo nulo: hay
   * colas en teléfonos que se armaron antes de que existiera.
   */
  workOrderId: id.nullable().optional(),
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

/** Tope de horas de un trabajo y del total de la correctiva (columna `hours`, regla 9). */
export const MANT_JOB_HOURS_MAX = 72
export const MANT_MAX_JOBS = 20

const jobHours = z.number().min(0.5, "Mínimo 0,5 horas por trabajo.").max(MANT_JOB_HOURS_MAX).refine((value) => Number.isInteger(value * 2), "Las horas van en pasos de 0,5.")

/** Un trabajo de la correctiva: su tipo, sus horas y sus repuestos (o «No se usaron repuestos»). */
export const correctiveJobSchema = z.object({
  workTypeId: id,
  hours: jobHours,
  /** Con `noParts`, `parts` va vacío; sin él, al menos un repuesto (lo exige el servidor con mensaje). */
  noParts: z.boolean(),
  parts: z.array(z.object({
    quantity: z.number().positive().max(100_000),
    description: z.string().trim().min(1).max(300),
  })).max(50),
})
export type SyncCorrectiveJob = z.infer<typeof correctiveJobSchema>

export const correctiveRecordSchema = z.object({
  ...recordBase,
  kind: z.literal("C"),
  /** Al menos un trabajo y sin repetir tipo; el total de horas no pasa de 72. */
  jobs: z.array(correctiveJobSchema).min(1, "Agrega al menos un trabajo.").max(MANT_MAX_JOBS)
    .refine((jobs) => new Set(jobs.map((job) => job.workTypeId)).size === jobs.length, "No repitas el mismo tipo de trabajo.")
    .refine((jobs) => jobs.reduce((sum, job) => sum + job.hours, 0) <= MANT_JOB_HOURS_MAX, "El total de horas no puede pasar de 72."),
  /** Vacío sólo si `noOilChange`. */
  oilIds: z.array(id),
  noOilChange: z.boolean(),
  executor: correctiveExecutorSchema,
  description: z.string().trim().min(5, "Describe el trabajo realizado.").max(4000),
  inWorkshop: z.boolean(),
  workshopEntryDate: isoDate.nullable(),
  /** Por qué sigue en taller; obligatorio (≥ 5 caracteres) si `inWorkshop`. */
  workshopReason: z.string().trim().max(1000).nullable(),
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

export type SyncWorkshopResponse =
  | { ok: true; id: string; receivedAt: string; duplicate: boolean }
  | { ok: false; code: "rejected"; message: string }

// ── Respuesta a una observación: POST /api/mantencion/sync/observaciones ────

export const observationReplySchema = z.object({
  observationId: id,
  response: z.string().trim().min(2).max(2000),
})
export type ObservationReply = z.infer<typeof observationReplySchema>

// ── Órdenes de trabajo: POST /api/mantencion/sync/ot ─────────────────────────
//
// Operaciones del mecánico sobre una OT. `id` es la clave de idempotencia (la
// misma operación llega tres veces y queda un evento); el servidor no exige
// versión: guarda el estado bajo bloqueo y rechaza lo que ya no corresponde.

/** Datos de INGRESO A TALLER. La lectura que exige el servidor es la de la unidad del equipo. */
export const workOrderEntrySchema = z.object({
  workshopKind: z.enum(["interno", "externo"]),
  /** Obligatorio si `externo` (catálogo de talleres). */
  workshopId: id.nullable(),
  workshopManagerName: z.string().trim().max(120).nullable(),
  operatorDriverId: id.nullable(),
  operatorName: z.string().trim().max(120).nullable(),
  entryAt: isoDateTime,
  odometer: z.number().finite().min(0).max(99_999_999).nullable(),
  hourmeter: z.number().finite().min(0).max(99_999_999).nullable(),
  estimatedDeliveryDate: isoDate,
})
export type WorkOrderEntryPayload = z.infer<typeof workOrderEntrySchema>

const workOrderOpBase = { id: uuid, workOrderId: id, createdAt: isoDateTime, deviceId: uuid }

/** Lo que la app puede enviar. «Tomar» se retiró (2026-11): las OT las asigna la jefatura o el administrador de contrato. */
export const workOrderOpSchema = z.discriminatedUnion("action", [
  z.object({ ...workOrderOpBase, action: z.literal("start"), entry: workOrderEntrySchema }),
  z.object({
    ...workOrderOpBase,
    action: z.literal("estimate"),
    estimatedDeliveryDate: isoDate,
    /** Obligatorio (≥ 5) al cambiar una fecha estimada que ya existía. */
    reason: z.string().trim().max(500).nullable(),
  }),
  z.object({
    ...workOrderOpBase,
    action: z.literal("items"),
    marks: z.array(z.object({ itemId: id, done: z.enum(["si", "no"]), note: z.string().trim().max(300).nullable() })).max(24),
    added: z.array(z.object({ id: uuid, kind: z.enum(["anexo", "mantencion"]), description: z.string().trim().min(3).max(300) })).max(24),
  }),
  z.object({ ...workOrderOpBase, action: z.literal("finish"), exitAt: isoDateTime, note: z.string().trim().max(1000).nullable() }),
])
export type WorkOrderOpPayload = z.infer<typeof workOrderOpSchema>
export type WorkOrderOpAction = WorkOrderOpPayload["action"]

/**
 * Un «tomar» que un teléfono dejó en su cola antes de que se retirara. El
 * servidor lo sigue aceptando sólo para rechazarlo con un motivo legible (o
 * responder el duplicado si ya se había aplicado), no con un error de esquema.
 */
export const legacyTakeOpSchema = z.object({ ...workOrderOpBase, action: z.literal("take") })
export const workOrderOpRequestSchema = z.discriminatedUnion("action", [legacyTakeOpSchema, ...workOrderOpSchema.options])
export type WorkOrderOpRequest = z.infer<typeof workOrderOpRequestSchema>

/** Misma semántica de HTTP que `SyncRecordResponse` (409/422 = rechazo definitivo). */
export type SyncWorkOrderResponse =
  | { ok: true; id: string; workOrderId: string; status: OtStatus; receivedAt: string; duplicate: boolean; warnings: SyncWarning[] }
  | { ok: false; code: "rejected" | "invalid"; message: string; field?: string }

// ── Catálogo: órdenes de trabajo ─────────────────────────────────────────────

export interface CatalogWorkOrderItem {
  id: string
  kind: OtItemKind
  origin: OtItemOrigin
  description: string
  done: OtItemDone | null
  note: string | null
}

export interface CatalogWorkOrder {
  id: string
  folio: string
  status: OtStatus
  vehicleId: string
  /** Resumen del equipo: la OT puede ser de un equipo que sólo está en el catálogo liviano. */
  equipmentCode: string
  equipmentPlate: string
  equipmentType: string
  unit: MantUnit
  worksiteId: string
  worksiteName: string
  /** El equipo es de una faena que no es del mecánico (sólo un aviso; puede trabajarla igual). */
  outOfWorksite: boolean
  repair: boolean
  maintenance: boolean
  requestDate: string
  requesterName: string
  repairDescription: string | null
  observations: string | null
  assignedToUserId: string | null
  assignedToName: string | null
  entry: (Omit<WorkOrderEntryPayload, "workshopId" | "operatorDriverId"> & { workshopName: string | null }) | null
  exitAt: string | null
  items: CatalogWorkOrderItem[]
  /** Último rechazo en recepción, para mostrar «Devuelta: <motivo>». */
  lastRejection: { count: number; reason: string; at: string } | null
  /** Registros firmados enlazados (correctivas o preventivas) desde el último rechazo. */
  linkedRecords: Array<{ id: string; folio: string | null; kind: "P" | "C"; signedAt: string }>
}

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
  /**
   * OT asignadas a mí (abiertas y las cerradas de los últimos 7 días). Opcional:
   * un catálogo guardado antes de 2026-11 no lo trae y la app lo toma como `[]`.
   */
  workOrders?: CatalogWorkOrder[]
}

/** `alcance=todos`: el resto de los equipos activos, en versión liviana (sin historial). */
export type CatalogOtherEquipment = Omit<CatalogEquipment, "recentPreventives" | "workshop"> & { recentPreventives: []; workshop: null }

export interface MantCatalogOthers {
  version: string
  equipment: CatalogOtherEquipment[]
}

/**
 * Historial de la flota para la app (`GET /api/mantencion/sync/historial`).
 * Va por un canal propio, con su ETag, para no engordar el catálogo: los
 * últimos `HISTORY_PER_EQUIPMENT` registros vigentes de cada equipo activo de
 * TODAS las faenas, de cualquier mecánico. Sólo texto; las fotos se piden una
 * a una (`GET /api/mantencion/sync/fotos/<id>`) y la app guarda las ya vistas.
 *
 * No viaja: anulados, observaciones de supervisión, `review`, datos de la
 * anulación, anomalías de sello ni quién recibió el registro.
 */
export const HISTORY_PER_EQUIPMENT = 10

export interface AppHistoryPhoto {
  id: string
  kind: MantPhotoKind
  width: number
  height: number
}

export interface AppHistoryRecord {
  id: string
  folio: string | null
  kind: MantRecordKind
  vehicleId: string
  worksiteName: string
  /** Fecha del trabajo (`YYYY-MM-DD`). */
  workDate: string
  reading: number
  unit: MantUnit
  executorKind: MantExecutorKind
  /** Mecánico, «otro mecánico» o taller externo, ya resuelto a un nombre. */
  executorName: string
  /** Folio de la OT enlazada, si la hay. */
  workOrderFolio: string | null
  notes: string | null
  /** Preventiva: pauta usada. */
  schedule: { name: string; intervalValue: number } | null
  /** Preventiva: cuántos ítems quedaron «R» (realizados) y los demás con su motivo. */
  itemsDone: number
  itemsFlagged: Array<{ group: string; name: string; value: Exclude<MantItemValue, "R">; reason: string | null }>
  /** Correctiva. */
  corrective: {
    description: string
    hours: number
    workTypes: string[]
    jobs: Array<{ workTypeName: string; hours: number; parts: Array<{ quantity: number; description: string }> }>
    workshopEntryDate: string | null
    /** Fecha de salida del taller; `null` si sigue en taller o no entró. */
    workshopExitDate: string | null
    stillInWorkshop: boolean
  } | null
  photos: AppHistoryPhoto[]
}

export interface AppHistory {
  /** Igual al ETag de la respuesta. */
  version: string
  generatedAt: string
  /** Por `vehicleId`, del más reciente al más antiguo (máx. `HISTORY_PER_EQUIPMENT`). */
  byVehicle: Record<string, AppHistoryRecord[]>
}
