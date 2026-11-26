import { and, asc, desc, eq, gt, ilike, inArray, or, sql, type SQL } from "drizzle-orm"
import { alias } from "drizzle-orm/pg-core"
import { db } from "@/db"
import { fuelVehicles, mantPartsNoteItems, mantPartsNotes, mantWorkOrders, products, users, worksiteStock, worksites } from "@/db/schema"
import { roundQty } from "@/lib/services/stock-reservations"
import { escapeLikePattern } from "@/lib/utils"
import type { MantViewer } from "../access"
import { stockReservationSummary } from "../parts/reads"
import type {
  NoteItemResolution, PartsNoteDetail, PartsNoteDetailLine, PartsNoteListFilters, PartsNoteListRow, PartsNoteStatus, PartsNoteStockOption, PartsNoteTab,
} from "../parts/types"
import { canSeeNote, NP_PERMISSIONS, noteVisibility, noteVisibilitySql } from "./access"
import { loadLineStates } from "./lines"

export { loadWorkOrderPartsOverview } from "./overview"
export { loadPartsNotePrefill } from "./prefill"

/**
 * Lecturas de notas de pedido (NP): bandeja, detalle y prellenado de la solicitud.
 * El alcance lo pone SIEMPRE el servidor (`access.ts`): un filtro de la URL nunca
 * amplía lo que se ve.
 */

const EMPTY_COUNTS: Record<PartsNoteTab, number> = { pendientes: 0, en_gestion: 0, cerradas: 0 }
const MAX_PAGE_SIZE = 200
const iso = (value: string) => new Date(value).toISOString()

/** Líneas pendientes y totales de la NP, para la columna «n de m». */
const pendingLinesSql = sql<number>`(select count(*)::int from ${mantPartsNoteItems} where ${mantPartsNoteItems.noteId} = ${mantPartsNotes.id} and ${mantPartsNoteItems.resolution} = 'pendiente')`
const totalLinesSql = sql<number>`(select count(*)::int from ${mantPartsNoteItems} where ${mantPartsNoteItems.noteId} = ${mantPartsNotes.id})`

/** La NP tiene al menos una línea pendiente: lo que jefatura todavía tiene que resolver. */
export const noteHasPendingLineSql = sql`exists (select 1 from ${mantPartsNoteItems} where ${mantPartsNoteItems.noteId} = ${mantPartsNotes.id} and ${mantPartsNoteItems.resolution} = 'pendiente')`
/** NP abierta: ni cerrada ni anulada. */
const noteOpenSql = sql`${mantPartsNotes.status} in ('enviada', 'en_gestion')`

/**
 * Qué agrupa cada pestaña de la bandeja (NP4-2, decisión 2026-11-26). «Pendientes» (las notas por resolver, y la cifra del
 * Panel) es toda nota abierta con al menos una línea pendiente, aunque tenga otras ya resueltas. «En gestión» es lo que
 * no tiene nada pendiente pero espera una compra que aún no llega a la faena. «Cerradas», lo cerrado y lo anulado.
 */
export const TAB_CONDITIONS: Record<PartsNoteTab, SQL> = {
  pendientes: sql`(${noteOpenSql} and ${noteHasPendingLineSql})`,
  en_gestion: sql`(${noteOpenSql} and not ${noteHasPendingLineSql})`,
  cerradas: sql`${mantPartsNotes.status} in ('cerrada', 'anulada')`,
}

/** Filtros comunes a la bandeja y a los conteos (todo menos la pestaña). */
function baseConditions(viewer: MantViewer, filters: PartsNoteListFilters): SQL[] {
  const conditions: SQL[] = [noteVisibilitySql(noteVisibility(viewer))]
  if (filters.worksiteId) conditions.push(eq(mantPartsNotes.worksiteId, filters.worksiteId))
  const text = filters.q?.trim()
  if (text) {
    const pattern = `%${escapeLikePattern(text)}%`
    conditions.push(or(
      ilike(mantPartsNotes.code, pattern),
      ilike(mantWorkOrders.folio, pattern),
      ilike(fuelVehicles.code, pattern),
      ilike(fuelVehicles.plate, pattern),
      sql`exists (select 1 from ${mantPartsNoteItems} where ${mantPartsNoteItems.noteId} = ${mantPartsNotes.id} and ${mantPartsNoteItems.description} ilike ${pattern})`,
    )!)
  }
  return conditions
}

export async function listPartsNotes(viewer: MantViewer, filters: PartsNoteListFilters): Promise<{ rows: PartsNoteListRow[]; total: number; counts: Record<PartsNoteTab, number> }> {
  if (noteVisibility(viewer).kind === "none") return { rows: [], total: 0, counts: { ...EMPTY_COUNTS } }
  const base = baseConditions(viewer, filters)
  const pageSize = Math.min(Math.max(Math.trunc(filters.pageSize ?? 25) || 25, 1), MAX_PAGE_SIZE)
  const page = Math.max(Math.trunc(filters.page ?? 1) || 1, 1)

  // Un solo recorrido: cada nota cae en una sola pestaña, la misma que filtra la lista de abajo.
  const [counted] = await db
    .select({
      pendientes: sql<number>`(count(*) filter (where ${TAB_CONDITIONS.pendientes}))::int`,
      en_gestion: sql<number>`(count(*) filter (where ${TAB_CONDITIONS.en_gestion}))::int`,
      cerradas: sql<number>`(count(*) filter (where ${TAB_CONDITIONS.cerradas}))::int`,
    })
    .from(mantPartsNotes)
    .innerJoin(mantWorkOrders, eq(mantWorkOrders.id, mantPartsNotes.workOrderId))
    .innerJoin(fuelVehicles, eq(fuelVehicles.id, mantPartsNotes.vehicleId))
    .where(and(...base))
  const counts: Record<PartsNoteTab, number> = {
    pendientes: Number(counted?.pendientes ?? 0),
    en_gestion: Number(counted?.en_gestion ?? 0),
    cerradas: Number(counted?.cerradas ?? 0),
  }

  const requestedBy = alias(users, "np_requested_by")
  const rows = await db
    .select({
      id: mantPartsNotes.id,
      code: mantPartsNotes.code,
      status: mantPartsNotes.status,
      workOrderId: mantPartsNotes.workOrderId,
      workOrderFolio: mantWorkOrders.folio,
      equipmentCode: fuelVehicles.code,
      equipmentPlate: fuelVehicles.plate,
      worksiteId: mantPartsNotes.worksiteId,
      worksiteName: worksites.name,
      requestedByName: requestedBy.name,
      equipmentStopped: mantPartsNotes.equipmentStopped,
      pendingLines: pendingLinesSql,
      totalLines: totalLinesSql,
      createdAt: mantPartsNotes.createdAt,
    })
    .from(mantPartsNotes)
    .innerJoin(mantWorkOrders, eq(mantWorkOrders.id, mantPartsNotes.workOrderId))
    .innerJoin(fuelVehicles, eq(fuelVehicles.id, mantPartsNotes.vehicleId))
    .innerJoin(worksites, eq(worksites.id, mantPartsNotes.worksiteId))
    .innerJoin(requestedBy, eq(requestedBy.id, mantPartsNotes.requestedByUserId))
    .where(and(...base, TAB_CONDITIONS[filters.tab]))
    // Lo que espera respuesta: primero el equipo detenido y lo más antiguo; el resto, lo más reciente primero.
    .orderBy(
      ...(filters.tab === "pendientes"
        ? [desc(mantPartsNotes.equipmentStopped), asc(mantPartsNotes.createdAt)]
        : [desc(mantPartsNotes.createdAt)]),
      asc(mantPartsNotes.id),
    )
    .limit(pageSize)
    .offset((page - 1) * pageSize)

  return {
    rows: rows.map((row): PartsNoteListRow => ({
      ...row,
      equipmentCode: row.equipmentCode ?? "",
      status: row.status as PartsNoteStatus,
      requestedByName: row.requestedByName ?? "",
      pendingLines: Number(row.pendingLines),
      totalLines: Number(row.totalLines),
      createdAt: iso(row.createdAt),
    })),
    total: counts[filters.tab],
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

export async function getPartsNote(viewer: MantViewer, noteId: string): Promise<PartsNoteDetail | null> {
  const visibility = noteVisibility(viewer)
  if (visibility.kind === "none") return null
  const requestedBy = alias(users, "np_requested_by")
  const [note] = await db
    .select({
      id: mantPartsNotes.id,
      code: mantPartsNotes.code,
      status: mantPartsNotes.status,
      workOrderId: mantPartsNotes.workOrderId,
      workOrderFolio: mantWorkOrders.folio,
      equipmentCode: fuelVehicles.code,
      equipmentPlate: fuelVehicles.plate,
      vehicleWorksiteId: fuelVehicles.worksiteId,
      worksiteId: mantPartsNotes.worksiteId,
      worksiteName: worksites.name,
      requestedByName: requestedBy.name,
      equipmentStopped: mantPartsNotes.equipmentStopped,
      notes: mantPartsNotes.notes,
      voidReason: mantPartsNotes.voidReason,
      createdAt: mantPartsNotes.createdAt,
    })
    .from(mantPartsNotes)
    .innerJoin(mantWorkOrders, eq(mantWorkOrders.id, mantPartsNotes.workOrderId))
    .innerJoin(fuelVehicles, eq(fuelVehicles.id, mantPartsNotes.vehicleId))
    .innerJoin(worksites, eq(worksites.id, mantPartsNotes.worksiteId))
    .innerJoin(requestedBy, eq(requestedBy.id, mantPartsNotes.requestedByUserId))
    .where(eq(mantPartsNotes.id, noteId))
    .limit(1)
  if (!note || !canSeeNote(visibility, note)) return null

  const resolver = alias(users, "np_resolved_by")
  const items = await db
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
      sortOrder: mantPartsNoteItems.sortOrder,
    })
    .from(mantPartsNoteItems)
    .leftJoin(products, eq(products.id, mantPartsNoteItems.productId))
    .leftJoin(resolver, eq(resolver.id, mantPartsNoteItems.resolvedByUserId))
    .where(eq(mantPartsNoteItems.noteId, noteId))
    .orderBy(asc(mantPartsNoteItems.sortOrder))

  const states = await loadLineStates(items.map((item) => ({
    id: item.id, noteId, workOrderId: note.workOrderId, productId: item.productId, resolution: item.resolution, sortOrder: item.sortOrder, noteCreatedAt: note.createdAt,
  })))
  // Repuesto efectivo de cada línea: el elegido o, si llegó por una compra sin elegirlo, el de la reserva que la atendió.
  const productIds = [...new Set([...states.values()].map((state) => state.productId).filter((id): id is string => !!id))]
  const [free, names] = await Promise.all([
    freeByProduct(note.vehicleWorksiteId, productIds),
    productIds.length
      ? db.select({ id: products.id, name: products.name }).from(products).where(inArray(products.id, productIds))
      : Promise.resolve([] as Array<{ id: string; name: string }>),
  ])
  const nameOf = new Map(names.map((row) => [row.id, row.name]))

  const canManage = viewer.permissions.includes(NP_PERMISSIONS.manage)
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
    }
  })

  return {
    id: note.id,
    code: note.code,
    status: note.status as PartsNoteStatus,
    workOrderId: note.workOrderId,
    workOrderFolio: note.workOrderFolio,
    equipmentCode: note.equipmentCode ?? "",
    equipmentPlate: note.equipmentPlate,
    worksiteId: note.worksiteId,
    worksiteName: note.worksiteName,
    requestedByName: note.requestedByName ?? "",
    equipmentStopped: note.equipmentStopped,
    createdAt: iso(note.createdAt),
    notes: note.notes,
    voidReason: note.voidReason,
    lines,
    canManage,
    stockOptions: canManage && note.vehicleWorksiteId ? await stockOptionsIn(note.vehicleWorksiteId) : [],
  }
}
