import { and, asc, count, desc, eq, gt, inArray, sql } from "drizzle-orm"
import { alias } from "drizzle-orm/pg-core"
import { db } from "@/db"
import { costCenters, fuelVehicles, mantPartsNoteItems, mantPartsNotes, mantWorkOrders, products, suppliers, users, worksiteStock, worksites } from "@/db/schema"
import { OT_OPEN_STATUSES } from "@/lib/mantencion/work-order-states"
import { roundQty } from "@/lib/services/stock-reservations"
import type { MantViewer } from "../access"
import { stockReservationSummary } from "../parts/reads"
import type {
  NoteItemResolution, PartsNoteDetail, PartsNoteDetailLine, PartsNoteLineCharge, PartsNoteListFilters, PartsNoteListRow, PartsNoteStatus, PartsNoteStockOption, PartsNoteTab,
} from "../parts/types"
import { canSeeNote, inWorksiteScope, NP_PERMISSIONS, noteVisibility } from "./access"
import { loadNoteEvents, statusSinceSql } from "./history"
import { loadLineStates } from "./lines"
import { noteFilterConditions, statusCondition, TAB_CONDITIONS } from "./list-filters"
import { allowedNoteActions } from "./transitions"

export { noteHasPendingLineSql, TAB_CONDITIONS } from "./list-filters"
export { loadWorkOrderPartsOverview } from "./overview"
export { loadPartsNotePrefill } from "./prefill"

/**
 * Lecturas de notas de pedido (NP): bandeja, detalle y prellenado de la solicitud.
 * El alcance lo pone SIEMPRE el servidor (`access.ts`): un filtro de la URL nunca
 * amplía lo que se ve. Una NP puede no tener OT, equipo ni solicitante (importada):
 * todas las uniones con esas tablas son `leftJoin`.
 */

const EMPTY_COUNTS: Record<PartsNoteTab, number> = { pendientes: 0, en_gestion: 0, cerradas: 0 }
const MAX_PAGE_SIZE = 200
const iso = (value: string) => new Date(value).toISOString()

/** Líneas pendientes y totales de la NP, para la columna «n de m». */
const pendingLinesSql = sql<number>`(select count(*)::int from ${mantPartsNoteItems} where ${mantPartsNoteItems.noteId} = ${mantPartsNotes.id} and ${mantPartsNoteItems.resolution} = 'pendiente')`
const totalLinesSql = sql<number>`(select count(*)::int from ${mantPartsNoteItems} where ${mantPartsNoteItems.noteId} = ${mantPartsNotes.id})`

/** Cargos de las líneas de las notas de la página (equipo, centro de costo o texto original), sin repetir y en el orden de las líneas. */
async function loadChargeLabels(noteIds: readonly string[]): Promise<Map<string, string[]>> {
  const byNote = new Map<string, string[]>()
  if (noteIds.length === 0) return byNote
  const rows = await db
    .select({
      noteId: mantPartsNoteItems.noteId,
      label: sql<string | null>`coalesce(${fuelVehicles.code}, ${costCenters.name}, ${mantPartsNoteItems.chargeText})`,
    })
    .from(mantPartsNoteItems)
    .leftJoin(fuelVehicles, eq(fuelVehicles.id, mantPartsNoteItems.chargeVehicleId))
    .leftJoin(costCenters, eq(costCenters.id, mantPartsNoteItems.chargeCostCenterId))
    .where(inArray(mantPartsNoteItems.noteId, [...noteIds]))
    .orderBy(asc(mantPartsNoteItems.noteId), asc(mantPartsNoteItems.sortOrder))
  for (const row of rows) {
    if (!row.label) continue
    const labels = byNote.get(row.noteId) ?? []
    if (!labels.includes(row.label)) labels.push(row.label)
    byNote.set(row.noteId, labels)
  }
  return byNote
}

export async function listPartsNotes(viewer: MantViewer, filters: PartsNoteListFilters): Promise<{ rows: PartsNoteListRow[]; total: number; counts: Record<PartsNoteTab, number> }> {
  if (noteVisibility(viewer).kind === "none") return { rows: [], total: 0, counts: { ...EMPTY_COUNTS } }
  const base = noteFilterConditions(viewer, filters)
  const pageSize = Math.min(Math.max(Math.trunc(filters.pageSize ?? 25) || 25, 1), MAX_PAGE_SIZE)
  const page = Math.max(Math.trunc(filters.page ?? 1) || 1, 1)

  // Un solo recorrido: cada nota cae en una sola pestaña, la misma que filtra la lista de abajo. El estado exacto NO
  // entra en los conteos: las pestañas dicen cuánto hay con el resto de los filtros, y el estado afina dentro de una.
  const [counted] = await db
    .select({
      pendientes: sql<number>`(count(*) filter (where ${TAB_CONDITIONS.pendientes}))::int`,
      en_gestion: sql<number>`(count(*) filter (where ${TAB_CONDITIONS.en_gestion}))::int`,
      cerradas: sql<number>`(count(*) filter (where ${TAB_CONDITIONS.cerradas}))::int`,
    })
    .from(mantPartsNotes)
    .leftJoin(mantWorkOrders, eq(mantWorkOrders.id, mantPartsNotes.workOrderId))
    .leftJoin(fuelVehicles, eq(fuelVehicles.id, mantPartsNotes.vehicleId))
    .where(and(...base))
  const counts: Record<PartsNoteTab, number> = {
    pendientes: Number(counted?.pendientes ?? 0),
    en_gestion: Number(counted?.en_gestion ?? 0),
    cerradas: Number(counted?.cerradas ?? 0),
  }

  const where = and(...base, TAB_CONDITIONS[filters.tab], filters.status ? statusCondition(filters.status) : undefined)
  // Con un estado exacto el total de la lista ya no es el de la pestaña: la paginación tiene que contar lo que se ve.
  let total = counts[filters.tab]
  if (filters.status) {
    const [exact] = await db
      .select({ total: count() })
      .from(mantPartsNotes)
      .leftJoin(mantWorkOrders, eq(mantWorkOrders.id, mantPartsNotes.workOrderId))
      .leftJoin(fuelVehicles, eq(fuelVehicles.id, mantPartsNotes.vehicleId))
      .where(where)
    total = Number(exact?.total ?? 0)
  }

  const requestedBy = alias(users, "np_requested_by")
  const rows = await db
    .select({
      id: mantPartsNotes.id,
      code: mantPartsNotes.code,
      externalRef: mantPartsNotes.externalRef,
      status: mantPartsNotes.status,
      statusSince: statusSinceSql,
      workOrderId: mantPartsNotes.workOrderId,
      workOrderFolio: mantWorkOrders.folio,
      equipmentCode: fuelVehicles.code,
      equipmentPlate: fuelVehicles.plate,
      worksiteId: mantPartsNotes.worksiteId,
      worksiteName: worksites.name,
      requestedByName: sql<string>`coalesce(${requestedBy.name}, ${mantPartsNotes.requestedByName}, '')`,
      equipmentStopped: mantPartsNotes.equipmentStopped,
      urgent: mantPartsNotes.urgent,
      pendingLines: pendingLinesSql,
      totalLines: totalLinesSql,
      createdAt: mantPartsNotes.createdAt,
    })
    .from(mantPartsNotes)
    .leftJoin(mantWorkOrders, eq(mantWorkOrders.id, mantPartsNotes.workOrderId))
    .leftJoin(fuelVehicles, eq(fuelVehicles.id, mantPartsNotes.vehicleId))
    .innerJoin(worksites, eq(worksites.id, mantPartsNotes.worksiteId))
    .leftJoin(requestedBy, eq(requestedBy.id, mantPartsNotes.requestedByUserId))
    .where(where)
    // Lo que espera respuesta: primero lo urgente y lo más antiguo; el resto, lo más reciente primero.
    .orderBy(
      ...(filters.tab === "pendientes"
        ? [desc(mantPartsNotes.urgent), asc(mantPartsNotes.createdAt)]
        : [desc(mantPartsNotes.createdAt)]),
      asc(mantPartsNotes.id),
    )
    .limit(pageSize)
    .offset((page - 1) * pageSize)

  const charges = await loadChargeLabels(rows.map((row) => row.id))
  return {
    rows: rows.map((row): PartsNoteListRow => ({
      ...row,
      equipmentCode: row.equipmentCode ?? "",
      equipmentPlate: row.equipmentPlate ?? "",
      status: row.status as PartsNoteStatus,
      statusSince: iso(row.statusSince),
      requestedByName: row.requestedByName ?? "",
      pendingLines: Number(row.pendingLines),
      totalLines: Number(row.totalLines),
      charges: charges.get(row.id) ?? [],
      createdAt: iso(row.createdAt),
    })),
    total,
    counts,
  }
}

/** Stock libre (stock − reservado, nunca negativo) por producto en una faena. Lectura sin bloqueo: sirve para mostrar, no para decidir. */
async function freeByProduct(worksiteId: string, productIds: readonly string[]): Promise<Map<string, number>> {
  if (productIds.length === 0) return new Map()
  const [stock, reserved] = await Promise.all([
    db.select({ productId: worksiteStock.productId, quantity: worksiteStock.quantity }).from(worksiteStock)
      .where(and(eq(worksiteStock.worksiteId, worksiteId), inArray(worksiteStock.productId, [...productIds]))),
    stockReservationSummary({ worksiteIds: [worksiteId], productIds }),
  ])
  const held = new Map(reserved.map((row) => [row.productId, row.reserved]))
  return new Map(productIds.map((productId) => {
    const quantity = roundQty(Number(stock.find((row) => row.productId === productId)?.quantity ?? 0))
    return [productId, Math.max(0, roundQty(quantity - (held.get(productId) ?? 0)))]
  }))
}

/** Repuestos del catálogo con stock libre (> 0) en una faena, por nombre. Lectura sin bloqueo: para mostrar. */
async function stockOptionsIn(worksiteId: string): Promise<PartsNoteStockOption[]> {
  const rows = await db
    .select({ productId: products.id, name: products.name, partNumber: products.partNumber, unit: products.unitOfMeasure, quantity: worksiteStock.quantity })
    .from(worksiteStock)
    .innerJoin(products, eq(products.id, worksiteStock.productId))
    .where(and(eq(worksiteStock.worksiteId, worksiteId), eq(products.isSparePart, true), gt(worksiteStock.quantity, 0)))
    .orderBy(asc(products.name))
  if (rows.length === 0) return []
  const reserved = await stockReservationSummary({ worksiteIds: [worksiteId], productIds: rows.map((row) => row.productId) })
  const held = new Map(reserved.map((row) => [row.productId, row.reserved]))
  return rows
    .map((row) => ({ productId: row.productId, name: row.name, partNumber: row.partNumber, unit: row.unit, free: Math.max(0, roundQty(Number(row.quantity) - (held.get(row.productId) ?? 0))) }))
    .filter((row) => row.free > 0)
}

/** Lo que el cargo de una línea muestra: el equipo (código · patente), el centro de costo, o el texto original sin calce. */
function chargeOf(input: {
  vehicleId: string | null
  vehicleCode: string | null
  vehiclePlate: string | null
  costCenterId: string | null
  costCenterName: string | null
  chargeText: string | null
}): PartsNoteLineCharge | null {
  if (!input.vehicleId && !input.costCenterId && !input.chargeText) return null
  const vehicleLabel = input.vehicleId
    ? [input.vehicleCode, input.vehiclePlate && input.vehiclePlate !== input.vehicleCode ? input.vehiclePlate : null].filter(Boolean).join(" · ")
    : null
  return {
    vehicleId: input.vehicleId,
    costCenterId: input.costCenterId,
    label: vehicleLabel || input.costCenterName || input.chargeText || null,
  }
}

export async function getPartsNote(viewer: MantViewer, noteId: string): Promise<PartsNoteDetail | null> {
  const visibility = noteVisibility(viewer)
  if (visibility.kind === "none") return null
  const requestedBy = alias(users, "np_requested_by")
  const [note] = await db
    .select({
      id: mantPartsNotes.id,
      code: mantPartsNotes.code,
      externalRef: mantPartsNotes.externalRef,
      status: mantPartsNotes.status,
      holdReason: mantPartsNotes.holdReason,
      workOrderId: mantPartsNotes.workOrderId,
      workOrderFolio: mantWorkOrders.folio,
      workOrderStatus: mantWorkOrders.status,
      equipmentCode: fuelVehicles.code,
      equipmentPlate: fuelVehicles.plate,
      vehicleWorksiteId: fuelVehicles.worksiteId,
      worksiteId: mantPartsNotes.worksiteId,
      worksiteName: worksites.name,
      requestedByUserId: mantPartsNotes.requestedByUserId,
      requestedByName: sql<string>`coalesce(${requestedBy.name}, ${mantPartsNotes.requestedByName}, '')`,
      equipmentStopped: mantPartsNotes.equipmentStopped,
      urgent: mantPartsNotes.urgent,
      notes: mantPartsNotes.notes,
      voidReason: mantPartsNotes.voidReason,
      createdAt: mantPartsNotes.createdAt,
    })
    .from(mantPartsNotes)
    .leftJoin(mantWorkOrders, eq(mantWorkOrders.id, mantPartsNotes.workOrderId))
    .leftJoin(fuelVehicles, eq(fuelVehicles.id, mantPartsNotes.vehicleId))
    .innerJoin(worksites, eq(worksites.id, mantPartsNotes.worksiteId))
    .leftJoin(requestedBy, eq(requestedBy.id, mantPartsNotes.requestedByUserId))
    .where(eq(mantPartsNotes.id, noteId))
    .limit(1)
  if (!note || !canSeeNote(visibility, note)) return null

  const resolver = alias(users, "np_resolved_by")
  const chargeVehicle = alias(fuelVehicles, "np_charge_vehicle")
  const [events, items] = await Promise.all([loadNoteEvents(noteId), db
    .select({
      id: mantPartsNoteItems.id,
      description: mantPartsNoteItems.description,
      quantity: mantPartsNoteItems.quantity,
      unit: mantPartsNoteItems.unitOfMeasure,
      partNumber: mantPartsNoteItems.partNumber,
      productId: mantPartsNoteItems.productId,
      productName: products.name,
      resolution: mantPartsNoteItems.resolution,
      resolutionReason: mantPartsNoteItems.resolutionReason,
      resolvedByName: resolver.name,
      resolvedAt: mantPartsNoteItems.resolvedAt,
      chargeVehicleId: mantPartsNoteItems.chargeVehicleId,
      chargeVehicleCode: chargeVehicle.code,
      chargeVehiclePlate: chargeVehicle.plate,
      chargeCostCenterId: mantPartsNoteItems.chargeCostCenterId,
      chargeCostCenterName: costCenters.name,
      chargeText: mantPartsNoteItems.chargeText,
      suggestedSupplierId: mantPartsNoteItems.suggestedSupplierId,
      suggestedSupplierName: suppliers.name,
      supplierHint: mantPartsNoteItems.supplierHint,
      sortOrder: mantPartsNoteItems.sortOrder,
    })
    .from(mantPartsNoteItems)
    .leftJoin(products, eq(products.id, mantPartsNoteItems.productId))
    .leftJoin(resolver, eq(resolver.id, mantPartsNoteItems.resolvedByUserId))
    .leftJoin(chargeVehicle, eq(chargeVehicle.id, mantPartsNoteItems.chargeVehicleId))
    .leftJoin(costCenters, eq(costCenters.id, mantPartsNoteItems.chargeCostCenterId))
    .leftJoin(suppliers, eq(suppliers.id, mantPartsNoteItems.suggestedSupplierId))
    .where(eq(mantPartsNoteItems.noteId, noteId))
    .orderBy(asc(mantPartsNoteItems.sortOrder))])

  const states = await loadLineStates(items.map((item) => ({
    id: item.id,
    noteId,
    workOrderId: note.workOrderId,
    productId: item.productId,
    resolution: item.resolution,
    sortOrder: item.sortOrder,
    noteCreatedAt: note.createdAt,
  })))
  // Lo que se puede sacar de bodega es lo de la faena que abastece la NP: la del equipo de la OT hoy, o la de la NP si no hay equipo.
  const stockWorksiteId = note.vehicleWorksiteId ?? note.worksiteId
  // Repuesto efectivo de cada línea: el elegido o, si llegó por una compra sin elegirlo, el de la reserva que la atendió.
  const productIds = [...new Set([...states.values()].map((state) => state.productId).filter((id): id is string => !!id))]
  const [free, names] = await Promise.all([
    freeByProduct(stockWorksiteId, productIds),
    productIds.length
      ? db.select({ id: products.id, name: products.name }).from(products).where(inArray(products.id, productIds))
      : Promise.resolve([] as Array<{ id: string; name: string }>),
  ])
  const nameOf = new Map(names.map((row) => [row.id, row.name]))

  // Quien mira es de la faena de la nota (o de la actual de su equipo) o no actúa: con `view_own` solo (su propia nota, de una
  // faena que no es de su alcance) la ficha es de lectura. El servicio repite estas reglas al ejecutar cada acción.
  const inScope = inWorksiteScope(viewer, note.worksiteId) || (!!note.vehicleWorksiteId && inWorksiteScope(viewer, note.vehicleWorksiteId))
  const canManage = viewer.permissions.includes(NP_PERMISSIONS.manage) && inScope
  const canBuy = inScope && (viewer.permissions.includes(NP_PERMISSIONS.manage) || viewer.permissions.includes(NP_PERMISSIONS.purchase))
  const lines = items.map((item): PartsNoteDetailLine => {
    const state = states.get(item.id)!
    return {
      id: item.id,
      description: item.description,
      quantity: Number(item.quantity),
      unit: item.unit,
      partNumber: item.partNumber,
      productId: state.productId,
      productName: item.productName ?? (state.productId ? nameOf.get(state.productId) ?? null : null),
      resolution: item.resolution as NoteItemResolution,
      resolutionReason: item.resolutionReason,
      resolvedByName: item.resolvedByName,
      resolvedAt: item.resolvedAt ? iso(item.resolvedAt) : null,
      stage: state.stage,
      arrived: state.arrived,
      used: state.used,
      purchases: state.purchases,
      freeInWorksite: state.productId ? free.get(state.productId) ?? 0 : null,
      charge: chargeOf({
        vehicleId: item.chargeVehicleId,
        vehicleCode: item.chargeVehicleCode,
        vehiclePlate: item.chargeVehiclePlate,
        costCenterId: item.chargeCostCenterId,
        costCenterName: item.chargeCostCenterName,
        chargeText: item.chargeText,
      }),
      suggestedSupplierId: item.suggestedSupplierId,
      suggestedSupplierName: item.suggestedSupplierName,
      supplierHint: item.supplierHint,
    }
  })

  // Las acciones de cabecera que ve quien mira: su permiso y su alcance de faena y lo que hay en la nota.
  const workOrderOpen = !note.workOrderId || (!!note.workOrderStatus && (OT_OPEN_STATUSES as readonly string[]).includes(note.workOrderStatus))
  const actions = allowedNoteActions(
    note.status as PartsNoteStatus,
    { manage: canManage, reopen: viewer.permissions.includes(NP_PERMISSIONS.reopen) && inScope },
    { rejectedLines: lines.filter((line) => line.resolution === "rechazada").length, workOrderOpen },
  )

  return {
    id: note.id,
    code: note.code,
    externalRef: note.externalRef,
    status: note.status as PartsNoteStatus,
    // El último evento dice desde cuándo está en este estado.
    statusSince: events.at(-1)?.createdAt ?? iso(note.createdAt),
    workOrderId: note.workOrderId,
    workOrderFolio: note.workOrderFolio,
    equipmentCode: note.equipmentCode ?? "",
    equipmentPlate: note.equipmentPlate ?? "",
    worksiteId: note.worksiteId,
    worksiteName: note.worksiteName,
    requestedByName: note.requestedByName ?? "",
    equipmentStopped: note.equipmentStopped,
    urgent: note.urgent,
    createdAt: iso(note.createdAt),
    notes: note.notes,
    voidReason: note.voidReason,
    holdReason: note.holdReason,
    lines,
    events,
    actions,
    canManage,
    canBuy,
    // Una nota sin OT no aparta stock (se compra o se rechaza): no hay repuestos que ofrecer para reservar.
    stockOptions: canManage && note.workOrderId ? await stockOptionsIn(stockWorksiteId) : [],
  }
}
