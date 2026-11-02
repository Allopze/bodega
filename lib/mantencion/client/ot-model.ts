import type {
  CatalogEquipment,
  CatalogWorkOrder,
  CatalogWorkOrderItem,
  MantCatalog,
  WorkOrderOpRequest,
} from "../contracts"
import { OT_ITEM_MAX_PER_KIND, type OtItemKind, type OtStatus } from "../work-order-states"
import type { QueueItem, QueueRecordItem, QueueWorkOrderItem } from "./types"

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
}

export interface OtViews {
  mine: OtView[]
}

/** Operaciones que cuentan sobre el catálogo guardado (ver arriba). */
function appliesOver(item: QueueWorkOrderItem, catalogGeneratedAt: string | undefined): boolean {
  if (item.status === "rejected") return false
  if (item.status !== "sent") return true
  if (!item.sentAt || !catalogGeneratedAt) return false
  return item.sentAt > catalogGeneratedAt
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
      const { workshopId, operatorDriverId, ...entry } = op.entry
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
    // Un registro firmado antes de la última devolución ya no cuenta para terminar.
    if (since && record.payload.signedAt <= since) continue
    known.set(record.id, { id: record.id, folio: record.folio, kind: record.payload.kind, signedAt: record.payload.signedAt, pending: record.status !== "sent" })
  }
  return [...known.values()].sort((a, b) => a.signedAt.localeCompare(b.signedAt))
}

export function unmarkedItems(ot: Pick<CatalogWorkOrder, "items">): number {
  return ot.items.filter((item) => item.done === null).length
}

function viewOf(base: CatalogWorkOrder, source: OtSource, queue: readonly QueueItem[], ops: readonly QueueWorkOrderItem[], context: Parameters<typeof applyOp>[2]): OtView {
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
  const pending = mine.some((op) => op.status !== "sent")
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
    },
    finishBlockers,
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

  const mine = (catalog?.workOrders ?? []).map((ot) => viewOf(ot, "mine", queue, ops, context))
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
