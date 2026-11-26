import type {
  CatalogEquipment,
  CatalogPartsAvailable,
  CatalogWorkOrder,
  CatalogWorkOrderItem,
  MantCatalog,
  PartsNoteLineStage,
  WorkOrderOpRequest,
} from "../contracts"
import { OT_ITEM_MAX_PER_KIND, type OtItemKind, type OtStatus } from "../work-order-states"
import type { FlowJob, FlowPart } from "./flow-types"
import { parseQuantity } from "./flow-validate"
import type { QueueItem, QueuePartsNoteItem, QueueRecordItem, QueueWorkOrderItem } from "./types"

/**
 * La OT tal como la ve el mecánico: lo que el servidor dijo en el catálogo más
 * lo que el propio teléfono ya hizo y todavía no llegó (registró el ingreso,
 * marcó ítems, terminó…). Todo puro, sin red ni IndexedDB. El mecánico sólo ve
 * las OT que tiene asignadas: ya no las toma (2026-11).
 *
 * Reglas:
 *  - Una operación pendiente (o enviándose, o esperando que su autor entre de
 *    nuevo) se aplica siempre, SI el estado de la OT todavía la admite. Las
 *    mismas guardias que el servidor: ingresar sólo «asignada», lo demás sólo
 *    «en taller». Un «tomar» que quedó en la cola de antes no cambia nada: el
 *    servidor lo rechaza.
 *  - Una operación ya enviada sólo se aplica mientras el catálogo guardado sea
 *    más viejo que el envío: después el catálogo ya la trae y reaplicarla podría
 *    pisar un cambio posterior (p. ej. dejar «por recibir» una OT que la
 *    recepción devolvió).
 *  - Una operación rechazada no se aplica; se muestra su motivo en la OT.
 *  - `canFinish` calca la guardia del servidor: todos los ítems marcados y al
 *    menos un registro enlazado posterior a la última devolución.
 *  - Repuestos (ADR mantención 0001): las notas de pedido del catálogo más las que
 *    el teléfono aún no envió («por enviar»), y lo reservado para la OT menos lo que
 *    un registro guardado en el teléfono ya usó. Un catálogo de antes de las notas
 *    no trae `partsNotes` ni `partsAvailable`: se leen como vacíos.
 */

export type OtSource = "mine"

export interface OtRejectedOp {
  /** Id de la operación en la cola. */
  id: string
  /** Incluye «take»: un «tomar» viejo de la cola se muestra rechazado. */
  action: WorkOrderOpRequest["action"]
  message: string
}

export interface OtLinkedRecord {
  id: string
  folio: string | null
  kind: "P" | "C"
  signedAt: string
  /** Todavía no llegó al servidor. */
  pending: boolean
}

export interface OtFlags {
  canStart: boolean
  /** Fecha estimada, ítems SÍ/NO y registros: sólo con la OT «en taller». */
  canWork: boolean
  canFinish: boolean
  /** «Pedir repuestos»: la OT está asignada o en ejecución y es de este usuario (la misma guardia del servidor). */
  canRequestParts: boolean
}

/** Etapa de una línea de pedido para la vista: las del servidor más «por enviar» (sólo está en el teléfono). */
export type OtPartStage = PartsNoteLineStage | "por_enviar"

export interface OtPartLine {
  /** Estable entre renders: el id de la línea del servidor, o nota + posición si aún está en la cola. */
  key: string
  description: string
  quantity: number
  unit: string
  stage: OtPartStage
  /** Lo que llegó a la faena para esta línea y lo ya usado de eso (sólo con `en_bodega`). */
  arrived: number
  used: number
  rejectionReason: string | null
  /** «NP-2026-0001»; `null` mientras la nota está sólo en el teléfono. */
  noteCode: string | null
}

/** Un pedido de repuestos que el servidor rechazó al recibirlo (409/422): se lee y se quita con «Entendido». */
export interface OtRejectedPartsNote {
  /** Id del elemento en la cola. */
  id: string
  message: string
}

export interface OtView {
  ot: CatalogWorkOrder
  source: OtSource
  /** Hay operaciones guardadas en el teléfono que aún no llegan al servidor. */
  pending: boolean
  rejected: OtRejectedOp[]
  linked: OtLinkedRecord[]
  /** Ítems todavía sin SÍ/NO. */
  unmarked: number
  /** «Devuelta: <motivo>»: la recepción la mandó de vuelta y sigue en taller. */
  returnedReason: string | null
  flags: OtFlags
  /** Qué falta para terminar (vacío si se puede). */
  finishBlockers: string[]
  /** Una fila por línea pedida: primero lo que aún está en el teléfono, después lo del catálogo. */
  partsLines: OtPartLine[]
  partsRejected: OtRejectedPartsNote[]
  /** Reservado para esta OT y sin usar (ya descontado lo que un registro del teléfono usó). */
  partsAvailable: CatalogPartsAvailable[]
}

export interface OtViews {
  mine: OtView[]
}

/**
 * Un elemento de la cola cuenta sobre el catálogo guardado (ver arriba): lo
 * rechazado nunca; lo pendiente siempre; lo enviado sólo mientras el catálogo
 * sea más viejo que el envío. Es la regla de TODA vista que mezcla cola y
 * catálogo (OT, lecturas, preventivas, taller): después, el catálogo ya lo trae.
 */
export function appliesOver(item: Pick<QueueItem, "status" | "sentAt">, catalogGeneratedAt: string | undefined): boolean {
  if (item.status === "rejected") return false
  if (item.status !== "sent") return true
  if (!item.sentAt || !catalogGeneratedAt) return false
  return item.sentAt > catalogGeneratedAt
}

/**
 * Un registro del propio teléfono cuenta para lecturas, preventivas y taller
 * mientras (1) no esté rechazado, (2) el catálogo no lo refleje ya si fue
 * enviado y (3) jefatura no lo haya anulado: un registro anulado en la web no
 * puede seguir bloqueando la lectura corregida ni dar el equipo por «al día».
 */
export function recordApplies(item: QueueRecordItem, catalog: Pick<MantCatalog, "generatedAt" | "myRecords"> | null | undefined, catalogGeneratedAt?: string): boolean {
  // Un registro enviado trae la hora del SERVIDOR (`receivedAt`): compararla con `generatedAt` (también del
  // servidor) evita que un teléfono con la hora corrida lo dé por reflejado antes de tiempo, o demasiado tarde.
  const sentAt = item.status === "sent" && item.receivedAt ? item.receivedAt : item.sentAt
  if (!appliesOver({ status: item.status, sentAt }, catalogGeneratedAt ?? catalog?.generatedAt)) return false
  return !(catalog?.myRecords ?? []).some((record) => record.id === item.id && record.status === "anulado")
}

function describeUnmarked(count: number): string {
  return `${count === 1 ? "Falta 1 ítem" : `Faltan ${count} ítems`} por marcar con SÍ o NO`
}

/** Aplica una operación a la OT si su estado todavía la admite; si no, la deja igual. */
export function applyOp(ot: CatalogWorkOrder, op: WorkOrderOpRequest, context: { userId: string; userName: string; workshops: ReadonlyArray<{ id: string; name: string }> }): CatalogWorkOrder {
  switch (op.action) {
    case "take":
      // Retirado: el servidor lo rechaza; no se adelanta nada.
      return ot
    case "start": {
      if (ot.status !== "asignada") return ot
      const { workshopId, operatorDriverId: _operatorDriverId, ...entry } = op.entry
      const workshopName = workshopId ? context.workshops.find((workshop) => workshop.id === workshopId)?.name ?? null : null
      return { ...ot, status: "en_ejecucion", entry: { ...entry, workshopName } }
    }
    case "estimate":
      return ot.status === "en_ejecucion" && ot.entry ? { ...ot, entry: { ...ot.entry, estimatedDeliveryDate: op.estimatedDeliveryDate } } : ot
    case "items": {
      if (ot.status !== "en_ejecucion") return ot
      const marks = new Map(op.marks.map((mark) => [mark.itemId, mark]))
      const items: CatalogWorkOrderItem[] = ot.items.map((item) => {
        const mark = marks.get(item.id)
        return mark ? { ...item, done: mark.done, note: mark.note } : item
      })
      for (const added of op.added) {
        if (items.some((item) => item.id === added.id)) continue
        items.push({ id: added.id, kind: added.kind, origin: "taller", description: added.description, done: null, note: null })
      }
      return { ...ot, items }
    }
    case "finish":
      return ot.status === "en_ejecucion" ? { ...ot, status: "trabajo_terminado", exitAt: op.exitAt } : ot
  }
}

function linkedRecords(ot: CatalogWorkOrder, queue: readonly QueueItem[], userId: string): OtLinkedRecord[] {
  const known = new Map<string, OtLinkedRecord>()
  for (const record of ot.linkedRecords) known.set(record.id, { ...record, pending: false })
  const since = ot.lastRejection?.at ?? null
  for (const item of queue) {
    if (item.type !== "record" || item.authorUserId !== userId || item.status === "rejected") continue
    const record: QueueRecordItem = item
    if (record.payload.workOrderId !== ot.id || known.has(record.id)) continue
    // El servidor decide por la hora en que RECIBIÓ el registro, no por la firma (reloj del
    // teléfono, que puede ir atrasado o adelantado). Uno ya recibido antes de la última devolución
    // no cuenta para terminar; uno aún en cola lo recibirá después de una devolución que el
    // teléfono ya conoce, así que cuenta.
    if (since && record.receivedAt && new Date(record.receivedAt).getTime() <= new Date(since).getTime()) continue
    known.set(record.id, { id: record.id, folio: record.folio, kind: record.payload.kind, signedAt: record.payload.signedAt, pending: record.status !== "sent" })
  }
  return [...known.values()].sort((a, b) => a.signedAt.localeCompare(b.signedAt))
}

export function unmarkedItems(ot: Pick<CatalogWorkOrder, "items">): number {
  return ot.items.filter((item) => item.done === null).length
}

const round2 = (value: number): number => Math.round(value * 100) / 100

/** «2», «1,5»: las cantidades se dicen con coma, sin ceros de más. */
export function qtyText(value: number): string {
  return String(round2(value)).replace(".", ",")
}

function partLinesOf(ot: CatalogWorkOrder, queue: readonly QueueItem[], userId: string, generatedAt: string | undefined): OtPartLine[] {
  const pending: OtPartLine[] = queue
    .filter((item): item is QueuePartsNoteItem => item.type === "parts_note" && item.authorUserId === userId && item.payload.workOrderId === ot.id && appliesOver(item, generatedAt))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .flatMap((item) => item.payload.lines.map((line, index): OtPartLine => ({
      key: `${item.id}:${index}`, description: line.description, quantity: line.quantity, unit: line.unitOfMeasure,
      stage: "por_enviar", arrived: 0, used: 0, rejectionReason: null, noteCode: null,
    })))
  const known = (ot.partsNotes ?? []).flatMap((note) => note.lines.map((line): OtPartLine => ({
    key: line.id, description: line.description, quantity: line.quantity, unit: line.unit,
    stage: line.stage, arrived: line.arrived, used: line.used, rejectionReason: line.rejectionReason, noteCode: note.code,
  })))
  return [...pending, ...known]
}

/** La frase de estado de una línea: lleva el estado en palabras (nunca sólo en color) y, si aporta, un detalle aparte. */
export function partStatusText(line: Pick<OtPartLine, "stage" | "arrived" | "used" | "rejectionReason">): { label: string; detail: string | null; tone: "wait" | "info" | "ok" | "bad" } {
  switch (line.stage) {
    case "por_enviar": return { label: "Pedido · por enviar", detail: null, tone: "wait" }
    case "pedido": return { label: "Pedido", detail: null, tone: "wait" }
    case "en_compra": return { label: "En compra", detail: null, tone: "info" }
    case "rechazado": return { label: line.rejectionReason ? `Rechazado: ${line.rejectionReason}` : "Rechazado", detail: null, tone: "bad" }
    case "en_bodega": {
      const free = round2(Math.max(0, line.arrived - line.used))
      if (line.used > 0) {
        return {
          label: `Usado ${qtyText(line.used)} de ${qtyText(line.arrived)}`,
          detail: free > 0 ? `${free === 1 ? "Queda" : "Quedan"} ${qtyText(free)} ${free === 1 ? "disponible" : "disponibles"}` : null,
          tone: "ok",
        }
      }
      return { label: free > 0 ? `Llegó · ${qtyText(free)} ${free === 1 ? "disponible" : "disponibles"}` : "Llegó", detail: null, tone: "ok" }
    }
  }
}

/**
 * Lo reservado para la OT menos lo que los registros del propio teléfono ya usaron de esa reserva y que el
 * catálogo todavía no refleja (`queue` trae sólo los registros que cuentan: ver `recordApplies`). Lo agotado no se ofrece.
 */
function netAvailable(available: readonly CatalogPartsAvailable[], queue: readonly QueueItem[], workOrderId: string, userId: string): CatalogPartsAvailable[] {
  const used = new Map<string, number>()
  for (const item of queue) {
    if (item.type !== "record" || item.authorUserId !== userId || item.payload.kind !== "C" || item.payload.workOrderId !== workOrderId) continue
    for (const job of item.payload.jobs) {
      for (const part of job.parts) {
        if (part.source === "stock" && part.allocationId) used.set(part.allocationId, (used.get(part.allocationId) ?? 0) + part.quantity)
      }
    }
  }
  return available
    .map((item) => ({ ...item, remaining: round2(item.remaining - (used.get(item.allocationId) ?? 0)) }))
    .filter((item) => item.remaining > 0)
}

/** Lo disponible para el registro de una OT, como lo ve el trabajo en curso (catálogo guardado + cola del teléfono). */
export function availablePartsFor(catalog: MantCatalog | null | undefined, queue: readonly QueueItem[], userId: string, workOrderId: string): CatalogPartsAvailable[] {
  const ot = findWorkOrder(catalog, workOrderId)
  if (!ot?.partsAvailable?.length) return []
  const live = queue.filter((item) => item.type !== "record" || recordApplies(item, catalog))
  return netAvailable(ot.partsAvailable, live, workOrderId, userId)
}

// ── Repuestos de bodega dentro de un trabajo (chips «Disponibles para esta OT») ──────────────────────────────────
//
// La línea de repuesto del borrador lleva `source`/`productId`/`allocationId` como campos opcionales de `FlowPart`.
// Se tipan aquí aparte para no depender del orden en que se integra `flow-types.ts`: una línea sin `source` es el
// texto libre de siempre.

export type StockFlowPart = FlowPart & { source?: "stock" | "externo"; productId?: string | null; allocationId?: string | null }

export function isStockPart(part: FlowPart): part is StockFlowPart & { source: "stock" } {
  return (part as StockFlowPart).source === "stock"
}

const allocationOf = (part: FlowPart): string | null => (isStockPart(part) ? part.allocationId ?? null : null)

/** Lo que las líneas del borrador ya toman de una reserva (todas las líneas de todos los trabajos, salvo `except`). */
function placedStock(jobs: readonly FlowJob[], allocationId: string, except?: { workTypeId: string; index: number }): number {
  let total = 0
  for (const job of jobs) {
    job.parts.forEach((part, index) => {
      if (except && job.workTypeId === except.workTypeId && index === except.index) return
      if (allocationOf(part) === allocationId) total += parseQuantity(part.quantity)
    })
  }
  return round2(total)
}

/** Cuánto queda de una reserva después de lo ya puesto en el borrador. */
export function freeStock(item: CatalogPartsAvailable, jobs: readonly FlowJob[]): number {
  return round2(Math.max(0, item.remaining - placedStock(jobs, item.allocationId)))
}

/**
 * Lo máximo que puede valer esa línea de bodega: lo disponible menos lo puesto en las demás líneas del mismo
 * repuesto; entero si la unidad no admite decimales. Si la reserva ya no figura (se agotó o la OT cambió), la
 * línea sólo puede bajar: su tope es lo que ya tiene.
 */
export function stockCap(available: readonly CatalogPartsAvailable[], jobs: readonly FlowJob[], at: { workTypeId: string; index: number }): number {
  const part = jobs.find((job) => job.workTypeId === at.workTypeId)?.parts[at.index]
  const allocationId = part ? allocationOf(part) : null
  const item = allocationId ? available.find((entry) => entry.allocationId === allocationId) : undefined
  if (!part || !allocationId || !item) return part ? parseQuantity(part.quantity) : 0
  const cap = round2(Math.max(0, item.remaining - placedStock(jobs, allocationId, at)))
  return item.wholeOnly ? Math.floor(cap) : cap
}

/** Agrega al trabajo una línea de bodega (cantidad 1, o lo poco que quede). Las líneas en blanco de partida se reemplazan. */
export function addStockLine(jobs: readonly FlowJob[], workTypeId: string, item: CatalogPartsAvailable): FlowJob[] {
  const quantity = Math.min(1, Math.max(freeStock(item, jobs), 0)) || 1
  const line: StockFlowPart = { quantity: qtyText(quantity), description: item.name, source: "stock", productId: item.productId, allocationId: item.allocationId }
  return jobs.map((job) => (job.workTypeId === workTypeId
    ? { ...job, parts: [...job.parts.filter((part) => part.description.trim() !== ""), line] }
    : job))
}

function viewOf(base: CatalogWorkOrder, source: OtSource, queue: readonly QueueItem[], ops: readonly QueueWorkOrderItem[], context: Parameters<typeof applyOp>[2], generatedAt: string | undefined): OtView {
  let ot = base
  const mine = ops.filter((op) => op.payload.workOrderId === base.id)
  for (const op of mine) ot = applyOp(ot, op.payload, context)

  const rejectedOps = queue.filter((item): item is QueueWorkOrderItem => item.type === "ot" && item.authorUserId === context.userId && item.status === "rejected" && item.payload.workOrderId === base.id)
  // Un rechazo viejo deja de molestar cuando algo más reciente de esa OT salió bien o quedó en espera.
  const newestLive = mine.reduce((latest, op) => (op.createdAt > latest ? op.createdAt : latest), "")
  const rejected = rejectedOps
    .filter((op) => op.createdAt > newestLive)
    .map((op): OtRejectedOp => ({ id: op.id, action: op.payload.action, message: op.lastError ?? "La plataforma no aceptó la operación." }))

  const linked = linkedRecords(ot, queue, context.userId)
  const unmarked = unmarkedItems(ot)
  const executing = ot.status === "en_ejecucion"
  const finishBlockers: string[] = []
  if (executing) {
    if (!ot.entry) finishBlockers.push("Falta registrar el ingreso a taller")
    if (unmarked > 0) finishBlockers.push(describeUnmarked(unmarked))
    if (linked.length === 0) finishBlockers.push(ot.lastRejection ? "Registra una correctiva o preventiva nueva, después de la devolución" : "Registra al menos una correctiva o preventiva de esta OT")
  }
  const notes = queue.filter((item): item is QueuePartsNoteItem => item.type === "parts_note" && item.authorUserId === context.userId && item.payload.workOrderId === base.id)
  // Un pedido de repuestos que aún no llegó también es un cambio guardado sólo en el teléfono.
  const pending = mine.some((op) => op.status !== "sent") || notes.some((note) => note.status !== "sent" && note.status !== "rejected")
  const partsRejected = notes
    .filter((note) => note.status === "rejected")
    .map((note): OtRejectedPartsNote => ({ id: note.id, message: note.lastError ?? "La plataforma no aceptó el pedido de repuestos." }))
  return {
    ot,
    source,
    pending,
    rejected,
    linked,
    unmarked,
    returnedReason: executing && ot.lastRejection ? ot.lastRejection.reason : null,
    flags: {
      canStart: ot.status === "asignada",
      canWork: executing,
      canFinish: executing && finishBlockers.length === 0,
      canRequestParts: (ot.status === "asignada" || ot.status === "en_ejecucion") && ot.assignedToUserId === context.userId,
    },
    finishBlockers,
    partsLines: partLinesOf(ot, queue, context.userId, generatedAt),
    partsRejected,
    partsAvailable: netAvailable(ot.partsAvailable ?? [], queue, ot.id, context.userId),
  }
}

/** Orden en «Mis OT»: lo que pide acción primero (devueltas, en taller), lo cerrado al final. */
const STATUS_RANK: Record<OtStatus, number> = {
  en_ejecucion: 0, asignada: 1, trabajo_terminado: 2, recepcionada: 3, solicitada: 4, cerrada: 5, anulada: 6,
}

export function isClosedStatus(status: OtStatus): boolean {
  return status === "cerrada" || status === "anulada"
}

/**
 * Catálogo + cola → las OT del mecánico. Un catálogo de antes de las OT no trae
 * la lista y se toma como vacía.
 */
export function buildOtViews(catalog: MantCatalog | null | undefined, queue: readonly QueueItem[], user: { id: string; name: string }, catalogGeneratedAt?: string): OtViews {
  const context = { userId: user.id, userName: user.name, workshops: catalog?.workshops ?? [] }
  const generatedAt = catalogGeneratedAt ?? catalog?.generatedAt
  const ops = queue
    .filter((item): item is QueueWorkOrderItem => item.type === "ot" && item.authorUserId === user.id && appliesOver(item, generatedAt))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))

  // Un registro enviado que el catálogo ya refleja (o que jefatura anuló) no cuenta para `canFinish`.
  const live = queue.filter((item) => item.type !== "record" || recordApplies(item, catalog, generatedAt))
  const mine = (catalog?.workOrders ?? []).map((ot) => viewOf(ot, "mine", live, ops, context, generatedAt))
  mine.sort((a, b) => {
    const rank = STATUS_RANK[a.ot.status] - STATUS_RANK[b.ot.status]
    if (rank !== 0) return rank
    // Entre las abiertas, la de entrega más próxima primero; sin fecha, por folio.
    const da = a.ot.entry?.estimatedDeliveryDate ?? "9999-99-99"
    const db = b.ot.entry?.estimatedDeliveryDate ?? "9999-99-99"
    return da === db ? a.ot.folio.localeCompare(b.ot.folio) : da.localeCompare(db)
  })
  return { mine }
}

/** La OT con ese id, del catálogo guardado (sin aplicar la cola). */
export function findWorkOrder(catalog: MantCatalog | null | undefined, workOrderId: string): CatalogWorkOrder | null {
  return catalog?.workOrders?.find((ot) => ot.id === workOrderId) ?? null
}

/**
 * Un equipo armado con el resumen de la OT. La OT puede ser de una faena que no
 * es del mecánico y el catálogo liviano («todos») quizá aún no se bajó: sin esto
 * no podría registrar el trabajo. No trae lecturas ni pauta; el servidor valida.
 */
export function equipmentFromWorkOrder(ot: CatalogWorkOrder): CatalogEquipment {
  return {
    id: ot.vehicleId, code: ot.equipmentCode, plate: ot.equipmentPlate, noPlate: ot.equipmentCode === ot.equipmentPlate, typeName: ot.equipmentType, unit: ot.unit,
    brandId: "", brandName: "", model: null, worksiteId: ot.worksiteId, worksiteName: ot.worksiteName,
    scheduleId: null, readings: [], initialReading: null, state: "sin_lecturas", nextReading: null, remaining: null, nextIntervalValue: null,
    lastPreventive: null, recentPreventives: [], workshop: null,
  }
}

/** Cuántos ítems de cada lista hay (para el tope de 12 del talonario). */
export function itemCount(ot: Pick<CatalogWorkOrder, "items">, kind: OtItemKind): number {
  return ot.items.filter((item) => item.kind === kind).length
}

export function canAddItem(ot: Pick<CatalogWorkOrder, "items">, kind: OtItemKind, alsoAdding = 0): boolean {
  return itemCount(ot, kind) + alsoAdding < OT_ITEM_MAX_PER_KIND
}
