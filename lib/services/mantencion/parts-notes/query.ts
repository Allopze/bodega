import { and, asc, eq, gt, inArray, sql } from "drizzle-orm"
import { alias } from "drizzle-orm/pg-core"
import { db } from "@/db"
import { costCenters, fuelVehicles, mantPartsNoteItems, mantPartsNotes, mantWorkOrders, products, suppliers, users, worksiteStock, worksites } from "@/db/schema"
import { isPartsNoteOpen } from "@/lib/mantencion/contracts"
import { OT_OPEN_STATUSES } from "@/lib/mantencion/work-order-states"
import { roundQty } from "@/lib/services/stock-reservations"
import type { MantViewer } from "../access"
import { stockReservationSummary } from "../parts/reads"
import type { NoteItemResolution, PartsNoteDetail, PartsNoteDetailLine, PartsNoteLineCharge, PartsNoteStatus, PartsNoteStockOption } from "../parts/types"
import { canSeeNote, inWorksiteScope, NP_PERMISSIONS, noteVisibility } from "./access"
import { loadNoteEvents } from "./history"
import { isImportedClosedNote, loadLineStates } from "./lines"
import { allowedNoteActions } from "./transitions"

export { listPartsNotes, type PartsNotesList } from "./inbox"
export { noteHasPendingLineSql, noteHasUnorderedPurchaseSql, TAB_CONDITIONS } from "./list-filters"
export { loadWorkOrderPartsOverview } from "./overview"
export { loadPartsNotePrefill } from "./prefill"

/**
 * Lecturas de notas de pedido (NP): bandeja, detalle y prellenado de la solicitud.
 * El alcance lo pone SIEMPRE el servidor (`access.ts`): un filtro de la URL nunca
 * amplía lo que se ve. Una NP puede no tener OT, equipo ni solicitante (importada):
 * todas las uniones con esas tablas son `leftJoin`.
 */

const iso = (value: string) => new Date(value).toISOString()

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
    quantity: Number(item.quantity),
    importedClosed: isImportedClosedNote(note),
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
    // Una nota sin OT no aparta stock (se compra o se rechaza): no hay repuestos que ofrecer para reservar. Una cerrada, rechazada
    // o anulada tampoco resuelve sus líneas (sólo «Reabrir»): la ficha no ofrece acciones de línea.
    stockOptions: canManage && note.workOrderId && isPartsNoteOpen(note.status) ? await stockOptionsIn(stockWorksiteId) : [],
  }
}
