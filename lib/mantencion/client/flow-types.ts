import type { MantChecklistItem, MantExecutorKind, MantItemValue, MantScheduleSnapshot } from "../types"
import { todayInChile } from "@/lib/utils"

/**
 * El borrador de un registro en curso. Se guarda solo (por cuenta y tipo) para
 * que una llamada, el cierre de la app o la batería no cuesten el trabajo hecho.
 */

export type FlowStep = "equipo" | "lectura" | "pauta" | "fotos" | "trabajo" | "revisar"

export const STEPS_PREVENTIVE: readonly FlowStep[] = ["equipo", "lectura", "pauta", "fotos", "revisar"]
export const STEPS_CORRECTIVE: readonly FlowStep[] = ["equipo", "lectura", "trabajo", "revisar"]

export function stepsFor(kind: "P" | "C"): readonly FlowStep[] {
  return kind === "P" ? STEPS_PREVENTIVE : STEPS_CORRECTIVE
}

export type FlowErrors = Record<string, string>

export interface FlowPart { quantity: string; description: string }

/** Un trabajo de la correctiva (único por tipo): sus horas y sus repuestos. */
export interface FlowJob {
  workTypeId: string
  hours: number
  noParts: boolean
  parts: FlowPart[]
}

export interface FlowDraft {
  /** Id del registro: la llave de idempotencia con la que se envía. */
  id: string
  userId: string
  kind: "P" | "C"
  createdAt: string
  updatedAt: string

  step: number
  /** Índice del paso al que volver (Revisar) tras un «Cambiar»; `null` si no se viene de ahí. */
  ret: number | null

  // Paso 1 · Equipo
  vehicleId: string | null
  scope: "mine" | "all"
  query: string
  /** Pauta con la versión que tenía al elegir el equipo: el borrador conserva su versión aunque el catálogo cambie. */
  schedule: MantScheduleSnapshot | null

  // Paso 2 · Lectura
  /** Sólo dígitos. */
  readingText: string
  workDate: string
  /** Pauta elegida a mano (índice en `schedule.intervals`); `null` = la sugerida. */
  intervalIndex: number | null
  intervalOpen: boolean
  intervalReason: string
  ackJump: { reading: number; workDate: string } | null
  /** Id de la preventiva anterior que el mecánico vio y aceptó repetir. */
  ackDuplicate: string | null

  // Paso 3 · Pauta (preventiva), congelada al salir de «Lectura»
  checklist: MantChecklistItem[]
  intervalValue: number | null
  suggestedIntervalValue: number | null
  marks: Record<string, MantItemValue>
  reasons: Record<string, string>
  openGroup: number

  // Fotos y observaciones (preventiva)
  photos: { filtros: string | null; sticker: string | null; correctiva: string[] }
  notes: string

  // Paso 3 · Trabajo (correctiva)
  jobs: FlowJob[]
  oilIds: string[]
  noOilChange: boolean
  executorKind: MantExecutorKind
  executorUserId: string
  executorWorkshopId: string
  description: string
  workOrder: string
  inWorkshop: boolean | null
  workshopEntryDate: string
  workshopReason: string
  driverIds: string[]
  driverQuery: string

  correctsRecordId: string | null
  /** Registro rechazado que este borrador corrige: al firmar, el rechazado sale de la cola. */
  replacesQueueId: string | null

  errors: FlowErrors
}

export function draftKey(userId: string, kind: "P" | "C"): string {
  return `${userId}:${kind}`
}

export function newDraft(input: { userId: string; kind: "P" | "C"; vehicleId?: string | null; schedule?: MantScheduleSnapshot | null; id?: string; now?: Date }): FlowDraft {
  const now = input.now ?? new Date()
  const today = todayInChile(now)
  return {
    id: input.id ?? crypto.randomUUID(),
    userId: input.userId,
    kind: input.kind,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    step: input.vehicleId ? 1 : 0,
    ret: null,
    vehicleId: input.vehicleId ?? null,
    scope: "mine",
    query: "",
    schedule: input.schedule ?? null,
    readingText: "",
    workDate: today,
    intervalIndex: null,
    intervalOpen: false,
    intervalReason: "",
    ackJump: null,
    ackDuplicate: null,
    checklist: [],
    intervalValue: null,
    suggestedIntervalValue: null,
    marks: {},
    reasons: {},
    openGroup: 0,
    photos: { filtros: null, sticker: null, correctiva: [] },
    notes: "",
    jobs: [],
    oilIds: [],
    noOilChange: false,
    executorKind: "yo",
    executorUserId: "",
    executorWorkshopId: "",
    description: "",
    workOrder: "",
    inWorkshop: null,
    workshopEntryDate: today,
    workshopReason: "",
    driverIds: [],
    driverQuery: "",
    correctsRecordId: null,
    replacesQueueId: null,
    errors: {},
  }
}

/** Todas las fotos que el borrador referencia. */
export function draftPhotoIds(draft: Pick<FlowDraft, "photos">): string[] {
  const { filtros, sticker, correctiva } = draft.photos
  return [filtros, sticker, ...correctiva].filter((id): id is string => Boolean(id))
}

/** ¿Hay algo que perder? Un borrador recién abierto sin equipo ni datos se descarta sin preguntar. */
export function draftHasContent(draft: FlowDraft): boolean {
  return draft.vehicleId !== null || draftPhotoIds(draft).length > 0
}

/** Un trabajo recién agregado: una hora y una línea de repuesto en blanco. */
export function newJob(workTypeId: string): FlowJob {
  return { workTypeId, hours: 1, noParts: false, parts: [{ quantity: "1", description: "" }] }
}

export const totalHours = (jobs: readonly Pick<FlowJob, "hours">[]): number => jobs.reduce((sum, job) => sum + job.hours, 0)

/**
 * Borradores guardados con el formato anterior (`workTypeIds`, `hours`, `parts`,
 * `noParts` sueltos) se normalizan al abrirlos: un trabajo por cada tipo marcado,
 * con las horas totales y los repuestos en el primero. No se pierde nada de lo escrito.
 */
export function normalizeDraft(raw: FlowDraft): FlowDraft {
  const legacy = raw as unknown as { workTypeIds?: string[]; hours?: number; parts?: FlowPart[]; noParts?: boolean }
  if (!legacy.workTypeIds && Array.isArray(raw.jobs)) return { ...raw, workshopReason: raw.workshopReason ?? "" }
  const { workTypeIds = [], hours = 1, parts, noParts = false, ...rest } = legacy as typeof legacy & Record<string, unknown>
  const jobs = workTypeIds.map((workTypeId, index): FlowJob => index === 0
    ? { workTypeId, hours, noParts, parts: parts && parts.length > 0 ? parts : [{ quantity: "1", description: "" }] }
    : newJob(workTypeId))
  return { ...(rest as unknown as FlowDraft), jobs, workshopReason: raw.workshopReason ?? "" }
}
