import { and, asc, count, desc, eq, inArray, sql, type SQL } from "drizzle-orm"
import { alias } from "drizzle-orm/pg-core"
import { db } from "@/db"
import { costCenters, fuelVehicles, mantPartsNoteItems, mantPartsNotes, mantWorkOrders, users, worksites } from "@/db/schema"
import { EMPTY_NOTE_AGE_COUNTS, NOTE_AGE_BUCKETS, type NoteAgeCounts } from "@/lib/mantencion/parts-notes-age"
import { todayInChile } from "@/lib/utils"
import type { MantViewer } from "../access"
import type { PartsNoteListFilters, PartsNoteListRow, PartsNotePendingLine, PartsNoteStatus, PartsNoteTab } from "../parts/types"
import { noteVisibility } from "./access"
import { statusSinceSql } from "./history"
import { noteAgeDaysSql, noteAgeFilterSql, noteFilterConditions, statusCondition, TAB_CONDITIONS } from "./list-filters"

/**
 * Bandeja de notas de pedido (NP): las filas de la pestaña activa y todo lo que la acompaña (conteos por pestaña, tramos de
 * antigüedad para el gráfico y urgentes abiertas). El alcance lo pone SIEMPRE el servidor (`access.ts`): un filtro de la URL
 * nunca amplía lo que se ve. Una NP puede no tener OT, equipo ni solicitante (importada): todas las uniones con esas tablas
 * son `leftJoin`.
 */

const emptyCounts = (): Record<PartsNoteTab, number> => ({ por_revisar: 0, en_compra: 0, en_recepcion: 0, cerradas: 0 })
const MAX_PAGE_SIZE = 200
const iso = (value: string) => new Date(value).toISOString()

export interface PartsNotesList {
  rows: PartsNoteListRow[]
  /** Notas que cumplen la pestaña y TODOS los filtros (con el estado exacto, si lo hay): lo que pagina la lista. */
  total: number
  /** Notas por pestaña con el resto de los filtros (el estado exacto no entra: afina dentro de una pestaña). */
  counts: Record<PartsNoteTab, number>
  /**
   * Notas de la pestaña activa por tramo de antigüedad, con todos los filtros MENOS el de antigüedad: el gráfico es el
   * selector de ese filtro y, si sus cifras lo respetaran, elegir un tramo dejaría los otros en cero.
   */
  ageCounts: NoteAgeCounts
  /** Notas urgentes y abiertas del alcance de quien mira (y la faena elegida), sin otros filtros: lo que dice «N urgentes». */
  urgentOpen: number
  /** Lo mismo repartido por pestaña (la de cerradas siempre 0): a cuál llevar el enlace «N urgentes». */
  urgentByTab: Record<PartsNoteTab, number>
}

/** Líneas totales de la NP, para la columna «n de m». */
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

/** Las líneas pendientes de las notas de la página (una sola lectura), en el orden de cada nota. */
async function loadPendingLines(noteIds: readonly string[]): Promise<Map<string, PartsNotePendingLine[]>> {
  const byNote = new Map<string, PartsNotePendingLine[]>()
  if (noteIds.length === 0) return byNote
  const rows = await db
    .select({
      noteId: mantPartsNoteItems.noteId,
      id: mantPartsNoteItems.id,
      description: mantPartsNoteItems.description,
      quantity: mantPartsNoteItems.quantity,
      unitOfMeasure: mantPartsNoteItems.unitOfMeasure,
    })
    .from(mantPartsNoteItems)
    .where(and(inArray(mantPartsNoteItems.noteId, [...noteIds]), eq(mantPartsNoteItems.resolution, "pendiente")))
    .orderBy(asc(mantPartsNoteItems.noteId), asc(mantPartsNoteItems.sortOrder), asc(mantPartsNoteItems.id))
  for (const row of rows) {
    const lines = byNote.get(row.noteId) ?? []
    lines.push({ id: row.id, description: row.description, quantity: Number(row.quantity), unitOfMeasure: row.unitOfMeasure })
    byNote.set(row.noteId, lines)
  }
  return byNote
}

/** `count(*) filter (where …)` como entero. */
const countWhere = (condition: SQL) => sql<number>`(count(*) filter (where ${condition}))::int`

/** Un solo recorrido: cada nota cae en una sola pestaña, la misma que filtra la lista de abajo. */
async function countByTab(where: SQL | undefined): Promise<Record<PartsNoteTab, number>> {
  const [counted] = await db
    .select({
      por_revisar: countWhere(TAB_CONDITIONS.por_revisar),
      en_compra: countWhere(TAB_CONDITIONS.en_compra),
      en_recepcion: countWhere(TAB_CONDITIONS.en_recepcion),
      cerradas: countWhere(TAB_CONDITIONS.cerradas),
    })
    .from(mantPartsNotes)
    .leftJoin(mantWorkOrders, eq(mantWorkOrders.id, mantPartsNotes.workOrderId))
    .leftJoin(fuelVehicles, eq(fuelVehicles.id, mantPartsNotes.vehicleId))
    .where(where)
  return {
    por_revisar: Number(counted?.por_revisar ?? 0),
    en_compra: Number(counted?.en_compra ?? 0),
    en_recepcion: Number(counted?.en_recepcion ?? 0),
    cerradas: Number(counted?.cerradas ?? 0),
  }
}

async function countByAge(where: SQL | undefined, today: string): Promise<NoteAgeCounts> {
  const [counted] = await db
    .select({
      a: countWhere(noteAgeFilterSql(NOTE_AGE_BUCKETS[0].key, today)),
      b: countWhere(noteAgeFilterSql(NOTE_AGE_BUCKETS[1].key, today)),
      c: countWhere(noteAgeFilterSql(NOTE_AGE_BUCKETS[2].key, today)),
      d: countWhere(noteAgeFilterSql(NOTE_AGE_BUCKETS[3].key, today)),
    })
    .from(mantPartsNotes)
    .leftJoin(mantWorkOrders, eq(mantWorkOrders.id, mantPartsNotes.workOrderId))
    .leftJoin(fuelVehicles, eq(fuelVehicles.id, mantPartsNotes.vehicleId))
    .where(where)
  return {
    [NOTE_AGE_BUCKETS[0].key]: Number(counted?.a ?? 0),
    [NOTE_AGE_BUCKETS[1].key]: Number(counted?.b ?? 0),
    [NOTE_AGE_BUCKETS[2].key]: Number(counted?.c ?? 0),
    [NOTE_AGE_BUCKETS[3].key]: Number(counted?.d ?? 0),
  } as NoteAgeCounts
}

async function countUrgentOpen(where: SQL | undefined): Promise<Record<PartsNoteTab, number>> {
  const [counted] = await db
    .select({
      por_revisar: countWhere(TAB_CONDITIONS.por_revisar),
      en_compra: countWhere(TAB_CONDITIONS.en_compra),
      en_recepcion: countWhere(TAB_CONDITIONS.en_recepcion),
    })
    .from(mantPartsNotes)
    .where(and(where, eq(mantPartsNotes.urgent, true)))
  return {
    por_revisar: Number(counted?.por_revisar ?? 0),
    en_compra: Number(counted?.en_compra ?? 0),
    en_recepcion: Number(counted?.en_recepcion ?? 0),
    cerradas: 0,
  }
}

export async function listPartsNotes(viewer: MantViewer, filters: PartsNoteListFilters): Promise<PartsNotesList> {
  if (noteVisibility(viewer).kind === "none") {
    return { rows: [], total: 0, counts: emptyCounts(), ageCounts: { ...EMPTY_NOTE_AGE_COUNTS }, urgentOpen: 0, urgentByTab: emptyCounts() }
  }
  const today = todayInChile(filters.now)
  const pageSize = Math.min(Math.max(Math.trunc(filters.pageSize ?? 25) || 25, 1), MAX_PAGE_SIZE)
  const page = Math.max(Math.trunc(filters.page ?? 1) || 1, 1)
  const base = noteFilterConditions(viewer, filters, { today })
  const exact = filters.status ? statusCondition(filters.status) : undefined
  const where = and(...base, TAB_CONDITIONS[filters.tab], exact)

  const [counts, ageCounts, urgentByTab] = await Promise.all([
    // El estado exacto NO entra en los conteos: las pestañas dicen cuánto hay con el resto de los filtros.
    countByTab(and(...base)),
    countByAge(and(...noteFilterConditions(viewer, { ...filters, age: undefined }, { today }), TAB_CONDITIONS[filters.tab], exact), today),
    countUrgentOpen(and(...noteFilterConditions(viewer, { worksiteId: filters.worksiteId }, { today }))),
  ])
  // Con un estado exacto el total de la lista ya no es el de la pestaña: la paginación tiene que contar lo que se ve.
  let total = counts[filters.tab]
  if (filters.status) {
    const [exactTotal] = await db
      .select({ total: count() })
      .from(mantPartsNotes)
      .leftJoin(mantWorkOrders, eq(mantWorkOrders.id, mantPartsNotes.workOrderId))
      .leftJoin(fuelVehicles, eq(fuelVehicles.id, mantPartsNotes.vehicleId))
      .where(where)
    total = Number(exactTotal?.total ?? 0)
  }

  const requestedBy = alias(users, "np_requested_by")
  const rows = await db
    .select({
      id: mantPartsNotes.id,
      code: mantPartsNotes.code,
      externalRef: mantPartsNotes.externalRef,
      status: mantPartsNotes.status,
      statusSince: statusSinceSql,
      ageDays: noteAgeDaysSql(today),
      workOrderId: mantPartsNotes.workOrderId,
      workOrderFolio: mantWorkOrders.folio,
      equipmentCode: fuelVehicles.code,
      equipmentPlate: fuelVehicles.plate,
      worksiteId: mantPartsNotes.worksiteId,
      worksiteName: worksites.name,
      requestedByName: sql<string>`coalesce(${requestedBy.name}, ${mantPartsNotes.requestedByName}, '')`,
      equipmentStopped: mantPartsNotes.equipmentStopped,
      urgent: mantPartsNotes.urgent,
      totalLines: totalLinesSql,
      createdAt: mantPartsNotes.createdAt,
    })
    .from(mantPartsNotes)
    .leftJoin(mantWorkOrders, eq(mantWorkOrders.id, mantPartsNotes.workOrderId))
    .leftJoin(fuelVehicles, eq(fuelVehicles.id, mantPartsNotes.vehicleId))
    .innerJoin(worksites, eq(worksites.id, mantPartsNotes.worksiteId))
    .leftJoin(requestedBy, eq(requestedBy.id, mantPartsNotes.requestedByUserId))
    .where(where)
    // Lo que espera una acción (las tres pestañas abiertas): primero lo urgente y lo más antiguo; lo cerrado, lo más reciente primero.
    .orderBy(
      ...(filters.tab === "cerradas" ? [desc(mantPartsNotes.createdAt)] : [desc(mantPartsNotes.urgent), asc(mantPartsNotes.createdAt)]),
      asc(mantPartsNotes.id),
    )
    .limit(pageSize)
    .offset((page - 1) * pageSize)

  const noteIds = rows.map((row) => row.id)
  // Las líneas pendientes sólo se piden donde se deciden (`por_revisar`): en las otras pestañas no queda ninguna por resolver.
  const [charges, pending] = await Promise.all([
    loadChargeLabels(noteIds),
    filters.tab === "por_revisar" ? loadPendingLines(noteIds) : Promise.resolve(new Map<string, PartsNotePendingLine[]>()),
  ])
  return {
    rows: rows.map((row): PartsNoteListRow => ({
      ...row,
      equipmentCode: row.equipmentCode ?? "",
      equipmentPlate: row.equipmentPlate ?? "",
      status: row.status as PartsNoteStatus,
      statusSince: iso(row.statusSince),
      ageDays: Number(row.ageDays),
      requestedByName: row.requestedByName ?? "",
      pendingLines: pending.get(row.id) ?? [],
      totalLines: Number(row.totalLines),
      charges: charges.get(row.id) ?? [],
      createdAt: iso(row.createdAt),
    })),
    total,
    counts,
    ageCounts,
    urgentOpen: urgentByTab.por_revisar + urgentByTab.en_compra + urgentByTab.en_recepcion,
    urgentByTab,
  }
}
