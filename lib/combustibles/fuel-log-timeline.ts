/**
 * La línea de tiempo de una carga, en palabras: «Ana validó la carga», no
 * `status: validated`. Módulo puro: recibe lo que la página leyó de la auditoría,
 * del historial de estados, de los pedidos de revisión y de los casos, y devuelve
 * los hechos ordenados por fecha. Sin base de datos, así que se prueba sin ella.
 *
 * Reglas de lectura:
 * - Cada hecho sale de UNA sola fuente. Un cambio de estado de un registro en
 *   terreno queda en la auditoría y en `status_history`; aquí se cuenta una vez
 *   (desde `status_history`, que trae el estado anterior y el nuevo). Un pedido
 *   de revisión sale de `fuel_review_marks`, no de su fila de auditoría.
 * - Sin permiso de costos, los montos no aparecen en ninguna frase.
 * - Las personas de las que habla la auditoría son quienes operan la plataforma;
 *   los conductores y supervisores de una carga no aparecen aquí (ver `view_personal`).
 */
import { FLAG_REASON_LABELS, REVIEW_STATUS_LABELS, type FlagReason } from "@/lib/combustibles/control/contracts"
import { ANOMALY_SEVERITY_LABELS, type AnomalySeverity } from "@/lib/combustibles/anomaly-labels"
import { FUEL_LOAD_STATUS_LABELS, TAE_STATUS_LABELS } from "@/lib/combustibles/labels"
import type { FuelLoadOrigin } from "@/lib/combustibles/routes"

export type TimelineTone = "default" | "signal" | "success" | "danger"

export interface LoadTimelineEvent {
  /** Clave estable para React. */
  key: string
  at: string
  /** Quién lo hizo; `null` cuando lo hizo la plataforma o una persona sin cuenta. */
  actor: string | null
  /** La frase completa, empezando por el actor cuando lo hay: «Ana validó la carga». */
  text: string
  /** Motivo o nota que acompaña al hecho. */
  note?: string | null
  tone: TimelineTone
}

export interface TimelineAuditRow {
  id: string
  action: string
  createdAt: string
  /** Nombre de quien lo hizo (su cuenta), o su correo si el usuario ya no existe. */
  actor: string | null
  entityType: string
  oldState: string | null
  newState: string | null
  reason: string | null
}

export interface TimelineStatusRow {
  id: string
  fromStatus: string | null
  toStatus: string
  changedAt: string
  actor: string | null
  reason: string | null
}

export interface TimelineMarkRow {
  id: string
  status: string
  notes: string | null
  createdAt: string
  markedByName: string | null
  resolvedAt: string | null
  resolvedByName: string | null
  resolutionNote: string | null
}

export interface TimelineCaseRow {
  id: string
  ruleName: string
  severity: string
  status: string
  detectedAt: string
  resolvedAt: string | null
  resolvedByName: string | null
  resolution: string | null
}

export interface LoadTimelineInput {
  origen: FuelLoadOrigin
  /** `true` si la sesión puede ver montos (`view_costs`). */
  canViewCosts: boolean
  /** Cuándo llegó la carga a la plataforma. */
  createdAt: string
  /** Quién la registró desde la app (`registered_by`). */
  registeredByName: string | null
  /** Cómo llegó dentro de «terreno»: formulario público, app o histórico de sellos. */
  terrenoSource?: "public_pwa" | "internal_app" | "legacy_xlsx" | null
  /** Motivo de una carga registrada con fecha pasada. */
  backdateReason?: string | null
  /** Planilla: el archivo del que salió y quién lo importó. */
  batch?: { fileName: string; importedByName: string | null } | null
  /** La plataforma la dejó por decidir (`fuel_equipment_loads`): cuándo y por qué. */
  flagged?: { at: string; reasons: string[] } | null
  audit: TimelineAuditRow[]
  statuses: TimelineStatusRow[]
  marks: TimelineMarkRow[]
  cases: TimelineCaseRow[]
}

/** Campos auditados de una carga, en palabras. Los de monto se omiten sin `view_costs`. */
const FIELD_LABEL: Record<string, string> = {
  liters: "los litros",
  loadDate: "la fecha",
  month: "el mes",
  odometerReading: "el odómetro",
  hourMeterReading: "el horómetro",
  meterReading: "la lectura del medidor",
  meterType: "el tipo de medidor",
  receiptNumber: "el número de boleta",
  notes: "las observaciones",
  serviceType: "el tipo de servicio",
  product: "el producto",
  vehicleId: "el equipo",
  fuelSupplierId: "el proveedor",
  worksiteId: "la faena",
  meterReplaced: "la declaración de medidor reemplazado",
  meterReplacementReason: "el motivo del reemplazo de medidor",
}

const AMOUNT_FIELDS = new Set(["baseAmount", "iecFixed", "iecVariable", "iecTotal", "ivaAmount", "totalAmount", "unitPrice", "price"])

function parseState(value: string | null): Record<string, unknown> | null {
  if (!value) return null
  try {
    const parsed: unknown = JSON.parse(value)
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null
  } catch {
    return null
  }
}

function sameValue(a: unknown, b: unknown): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null)
}

function plainValue(value: unknown): string {
  if (value === null || value === undefined || value === "") return "sin dato"
  if (typeof value === "number") return value.toLocaleString("es-CL")
  if (typeof value === "boolean") return value ? "sí" : "no"
  return String(value)
}

/** «los litros, la fecha y el odómetro». */
function joinWords(items: string[]): string {
  if (items.length <= 1) return items[0] ?? ""
  return `${items.slice(0, -1).join(", ")} y ${items[items.length - 1]}`
}

function withActor(actor: string | null, phrase: string, fallback: string): string {
  return actor ? `${actor} ${phrase}` : fallback
}

/** Qué cambió en una modificación, en palabras: «los litros (de 100 a 120)». */
function describeChanges(oldState: Record<string, unknown> | null, newState: Record<string, unknown> | null, canViewCosts: boolean): string | null {
  const keys = new Set([...Object.keys(oldState ?? {}), ...Object.keys(newState ?? {})])
  const parts: string[] = []
  for (const key of keys) {
    if (!canViewCosts && AMOUNT_FIELDS.has(key)) continue
    if (AMOUNT_FIELDS.has(key)) {
      if (!sameValue(oldState?.[key], newState?.[key])) parts.push("los montos")
      continue
    }
    if (sameValue(oldState?.[key], newState?.[key])) continue
    const label = FIELD_LABEL[key]
    if (!label) continue
    const hasBoth = oldState && key in oldState && newState && key in newState
    parts.push(hasBoth ? `${label} (de ${plainValue(oldState[key])} a ${plainValue(newState[key])})` : label)
  }
  const unique = [...new Set(parts)]
  return unique.length > 0 ? joinWords(unique) : null
}

function statusLabel(origen: FuelLoadOrigin, status: string): string {
  const table = origen === "terreno" ? TAE_STATUS_LABELS : FUEL_LOAD_STATUS_LABELS
  return (table[status]?.label ?? status).toLowerCase()
}

function statusEvent(row: TimelineStatusRow, origen: FuelLoadOrigin): LoadTimelineEvent {
  const to = row.toStatus
  let phrase: string
  let tone: TimelineTone = "default"
  if (origen === "terreno" && to === "validated") { phrase = "validó la carga"; tone = "success" }
  else if (origen === "terreno" && to === "observed") { phrase = "dejó la carga con observación"; tone = "signal" }
  else if (to === "voided" || to === "cancelled") { phrase = "anuló la carga"; tone = "danger" }
  else if (to === "submitted") phrase = "dejó la carga por validar"
  else phrase = `dejó la carga en «${statusLabel(origen, to)}»`
  // Un estado inicial sin actor es el alta del registro: ya la cuenta el hecho de «llegó».
  return { key: `status:${row.id}`, at: row.changedAt, actor: row.actor, text: withActor(row.actor, phrase, `La carga quedó ${statusLabel(origen, to)}`), note: row.reason, tone }
}

function auditEvent(row: TimelineAuditRow, origen: FuelLoadOrigin, canViewCosts: boolean): LoadTimelineEvent | null {
  const oldState = parseState(row.oldState)
  const newState = parseState(row.newState)
  const base = { key: `audit:${row.id}`, at: row.createdAt, actor: row.actor, note: row.reason, tone: "default" as TimelineTone }

  // Los pedidos de revisión salen de `fuel_review_marks`.
  if (newState && "reviewRequest" in newState) return null
  if (oldState && "reviewRequest" in oldState) return null

  if (row.entityType === "fuel_equipment_load") {
    const to = typeof newState?.reviewStatus === "string" ? newState.reviewStatus : null
    const from = typeof oldState?.reviewStatus === "string" ? oldState.reviewStatus : null
    if (to === "approved") return { ...base, text: withActor(row.actor, "decidió que la carga cuenta", "Se decidió que la carga cuenta"), tone: "success" }
    if (to === "rejected") return { ...base, text: withActor(row.actor, "decidió que la carga no cuenta", "Se decidió que la carga no cuenta"), tone: "danger" }
    if ((from === "approved" || from === "rejected") && (to === "ok" || to === "flagged")) {
      return { ...base, text: withActor(row.actor, "deshizo la decisión: la carga vuelve a estar por decidir", "Se deshizo la decisión de la carga"), tone: "signal" }
    }
    return null
  }

  // El cambio de estado de un registro en terreno ya viene de `status_history`.
  if (row.action === "status_change" && origen === "terreno") return null

  if (row.action === "create") {
    return { ...base, text: withActor(row.actor, origen === "factura" ? "creó la factura de esta carga" : "creó el registro", "Se creó el registro") }
  }
  if (row.action === "delete") return { ...base, text: withActor(row.actor, "eliminó la carga", "Se eliminó la carga"), tone: "danger" }
  if (row.action === "cancel") return { ...base, text: withActor(row.actor, "anuló la carga", "Se anuló la carga"), tone: "danger" }
  if (row.action === "export") return null

  const newStatus = typeof newState?.status === "string" ? newState.status : null
  const oldStatus = typeof oldState?.status === "string" ? oldState.status : null
  if (origen === "factura" && newStatus && newStatus !== oldStatus && Object.keys(newState ?? {}).length === 1) {
    if (newStatus === "registered") return { ...base, text: withActor(row.actor, "registró la factura", "Se registró la factura"), tone: "success" }
    if (newStatus === "cancelled") return { ...base, text: withActor(row.actor, "anuló la carga", "Se anuló la carga"), tone: "danger" }
    return { ...base, text: withActor(row.actor, `dejó la factura en «${statusLabel(origen, newStatus)}»`, `La factura quedó ${statusLabel(origen, newStatus)}`) }
  }

  // Corrección de la lectura del medidor (registro en terreno).
  if (newState && "meterReading" in newState && origen === "terreno") {
    const phrase = `corrigió la lectura del medidor de ${plainValue(oldState?.meterReading)} a ${plainValue(newState.meterReading)}`
    const reset = newState.meterReset === true ? " e indicó que el medidor se reinició: parte una serie nueva" : ""
    return { ...base, text: withActor(row.actor, `${phrase}${reset}`, "Se corrigió la lectura del medidor") }
  }

  const changes = describeChanges(oldState, newState, canViewCosts)
  if (changes) return { ...base, text: withActor(row.actor, `modificó ${changes}`, `Se modificó ${changes}`) }
  if (row.action === "update" || row.action === "status_change") {
    return { ...base, text: withActor(row.actor, "modificó la carga", "Se modificó la carga") }
  }
  return null
}

function registrationEvent(input: LoadTimelineInput): LoadTimelineEvent {
  const { origen, createdAt, registeredByName, terrenoSource, backdateReason, batch } = input
  if (origen === "planilla") {
    return {
      key: "registered",
      at: createdAt,
      actor: batch?.importedByName ?? null,
      text: batch ? `Entró con la planilla «${batch.fileName}»${batch.importedByName ? `, importada por ${batch.importedByName}` : ""}` : "Entró con una planilla de cargas",
      tone: "default",
    }
  }
  if (origen === "factura") {
    return { key: "registered", at: createdAt, actor: null, text: "Llegó como factura de combustible", tone: "default" }
  }
  if (backdateReason) {
    return {
      key: "registered",
      at: createdAt,
      actor: registeredByName,
      text: withActor(registeredByName, "registró la carga con fecha pasada", "Se registró la carga con fecha pasada"),
      note: backdateReason,
      tone: "signal",
    }
  }
  if (terrenoSource === "legacy_xlsx") return { key: "registered", at: createdAt, actor: null, text: "Entró desde el histórico de sellos", tone: "default" }
  if (terrenoSource === "internal_app") {
    return { key: "registered", at: createdAt, actor: registeredByName, text: withActor(registeredByName, "registró la carga desde la app", "Se registró la carga desde la app"), tone: "default" }
  }
  return { key: "registered", at: createdAt, actor: null, text: "Se registró desde el formulario en terreno (QR)", tone: "default" }
}

function reasonWords(reasons: string[]): string {
  return reasons
    .map((code) => (Object.hasOwn(FLAG_REASON_LABELS, code) ? FLAG_REASON_LABELS[code as FlagReason] : code))
    .map((label) => label.charAt(0).toLowerCase() + label.slice(1))
    .join("; ")
}

function caseEvents(row: TimelineCaseRow): LoadTimelineEvent[] {
  const severity = Object.hasOwn(ANOMALY_SEVERITY_LABELS, row.severity) ? ANOMALY_SEVERITY_LABELS[row.severity as AnomalySeverity].toLowerCase() : row.severity
  const events: LoadTimelineEvent[] = [{
    key: `case:${row.id}`,
    at: row.detectedAt,
    actor: null,
    text: `Se abrió el caso «${row.ruleName}» (gravedad ${severity})`,
    tone: "signal",
  }]
  if (row.resolvedAt && (row.status === "resolved" || row.status === "dismissed")) {
    const verb = row.status === "resolved" ? "resolvió" : "descartó"
    events.push({
      key: `case:${row.id}:closed`,
      at: row.resolvedAt,
      actor: row.resolvedByName,
      text: withActor(row.resolvedByName, `${verb} el caso «${row.ruleName}»`, `Se ${verb} el caso «${row.ruleName}»`),
      note: row.resolution,
      tone: row.status === "resolved" ? "success" : "default",
    })
  }
  return events
}

function markEvents(row: TimelineMarkRow): LoadTimelineEvent[] {
  const events: LoadTimelineEvent[] = [{
    key: `mark:${row.id}`,
    at: row.createdAt,
    actor: row.markedByName,
    text: withActor(row.markedByName, "pidió que la revisen", "Se pidió que la revisen"),
    note: row.notes,
    tone: "signal",
  }]
  if (row.resolvedAt && row.status === "withdrawn") {
    events.push({
      key: `mark:${row.id}:withdrawn`,
      at: row.resolvedAt,
      actor: row.resolvedByName,
      text: withActor(row.resolvedByName, "retiró el pedido de revisión", "Se retiró el pedido de revisión"),
      tone: "default",
    })
  }
  if (row.resolvedAt && row.status === "resolved") {
    events.push({
      key: `mark:${row.id}:resolved`,
      at: row.resolvedAt,
      actor: row.resolvedByName,
      text: withActor(row.resolvedByName, "resolvió el pedido de revisión", "Se resolvió el pedido de revisión"),
      note: row.resolutionNote,
      tone: "success",
    })
  }
  return events
}

/** Los hechos de la carga, del más antiguo al más reciente. */
export function buildLoadTimeline(input: LoadTimelineInput): LoadTimelineEvent[] {
  const events: LoadTimelineEvent[] = [registrationEvent(input)]

  if (input.flagged && input.flagged.reasons.length > 0) {
    events.push({
      key: "flagged",
      at: input.flagged.at,
      actor: null,
      text: `La plataforma la dejó por decidir: ${reasonWords(input.flagged.reasons)}`,
      tone: "signal",
    })
  }
  for (const row of input.statuses) {
    // El estado inicial (sin estado anterior) es el alta del registro: ya lo cuenta el hecho de «llegó».
    if (row.fromStatus == null && (row.toStatus === "submitted" || row.toStatus === "draft")) continue
    events.push(statusEvent(row, input.origen))
  }
  for (const row of input.audit) {
    const event = auditEvent(row, input.origen, input.canViewCosts)
    if (event) events.push(event)
  }
  for (const row of input.marks) events.push(...markEvents(row))
  for (const row of input.cases) events.push(...caseEvents(row))

  // Por instante real (las tablas devuelven formatos distintos: `2026-10-30 08:12:00+00` y `…T08:12:00.000Z`).
  // Estable: a igual instante, el registro primero y el resto en el orden en que llegaron.
  const time = (value: string) => {
    const ms = new Date(value).getTime()
    return Number.isNaN(ms) ? 0 : ms
  }
  return events
    .map((event, index) => ({ event, index, ms: time(event.at) }))
    .sort((a, b) => a.ms - b.ms || (a.event.key === "registered" ? -1 : b.event.key === "registered" ? 1 : a.index - b.index))
    .map(({ event }) => event)
}

/* ── Cambios campo a campo («Ver cambios campo a campo») ─────────────────── */

export const AUDIT_ACTION_LABEL: Record<string, string> = {
  create: "Alta",
  update: "Modificación",
  status_change: "Cambio de estado",
  delete: "Eliminación",
  cancel: "Anulación",
  export: "Exportación",
  close: "Cierre",
  login: "Ingreso",
}

/** Nombre de cada campo auditado, para mostrarlo en lugar de su clave técnica. */
export const AUDIT_FIELD_NAME: Record<string, string> = {
  liters: "Litros",
  loadDate: "Fecha",
  month: "Mes",
  odometerReading: "Odómetro",
  hourMeterReading: "Horómetro",
  meterReading: "Lectura del medidor",
  meterType: "Tipo de medidor",
  meterReadingSource: "Cómo se obtuvo la lectura",
  meterReset: "El medidor se reinició",
  meterReplaced: "Medidor reemplazado",
  meterReplacementReason: "Motivo del reemplazo de medidor",
  ocrSuggestedReading: "Lectura sugerida por la foto",
  receiptNumber: "Número de boleta",
  notes: "Observaciones",
  serviceType: "Tipo de servicio",
  product: "Producto",
  vehicleId: "Equipo",
  fuelSupplierId: "Proveedor",
  worksiteId: "Faena",
  status: "Estado",
  reviewStatus: "Revisión de la plataforma",
  flagReasons: "Motivos de la revisión",
  duplicateOfId: "Duplicada de",
  reviewedBy: "Revisada por",
  reviewedAt: "Revisada el",
  baseAmount: "Monto neto",
  iecFixed: "IEC fijo",
  iecVariable: "IEC variable",
  iecTotal: "IEC",
  ivaAmount: "IVA",
  totalAmount: "Total",
  reviewRequest: "Pedido de revisión",
  markId: "Pedido",
  rowCount: "Filas",
}

const STATE_WORDS: Record<string, string> = {
  ...Object.fromEntries(Object.entries(TAE_STATUS_LABELS).map(([key, meta]) => [key, meta.label])),
  ...Object.fromEntries(Object.entries(FUEL_LOAD_STATUS_LABELS).map(([key, meta]) => [key, meta.label])),
  ...REVIEW_STATUS_LABELS,
  open: "Abierto",
  withdrawn: "Retirado",
  resolved: "Resuelto",
}

export function auditFieldName(key: string): string {
  return AUDIT_FIELD_NAME[key] ?? key
}

/** El valor de un campo auditado en palabras: «sí», «Validada», «sin dato», una lista separada por comas. */
export function auditValueText(key: string, value: unknown): string {
  if (value === null || value === undefined || value === "") return "sin dato"
  if (typeof value === "boolean") return value ? "sí" : "no"
  if (Array.isArray(value)) {
    return value.length === 0 ? "ninguno" : value.map((item) => (key === "flagReasons" && typeof item === "string" && Object.hasOwn(FLAG_REASON_LABELS, item) ? FLAG_REASON_LABELS[item as FlagReason] : String(item))).join(", ")
  }
  if (typeof value === "number") return value.toLocaleString("es-CL")
  if (typeof value === "string" && (key === "status" || key === "reviewStatus" || key === "reviewRequest") && Object.hasOwn(STATE_WORDS, value)) return STATE_WORDS[value] ?? value
  if (typeof value === "object") return JSON.stringify(value)
  return String(value)
}

/** Los campos que cambiaron en una fila de auditoría, listos para la tabla de cambios. */
export function auditDiffRows(oldRaw: string | null, newRaw: string | null): Array<{ key: string; field: string; before: string; after: string }> {
  const oldState = parseState(oldRaw)
  const newState = parseState(newRaw)
  const keys = [...new Set([...Object.keys(oldState ?? {}), ...Object.keys(newState ?? {})])]
  return keys.map((key) => ({ key, field: auditFieldName(key), before: auditValueText(key, oldState?.[key]), after: auditValueText(key, newState?.[key]) }))
}
