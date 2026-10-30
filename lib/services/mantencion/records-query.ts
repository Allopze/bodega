import { and, asc, desc, eq, gte, ilike, inArray, isNotNull, lte, or, sql, type SQL } from "drizzle-orm"
import { alias } from "drizzle-orm/pg-core"
import { db } from "@/db"
import {
  mantRecordCorrectives, mantRecordItems, mantRecords, mantWorkshopUpdates, mantWorksiteSettings, users, worksites,
  type MantEquipmentSnapshot,
} from "@/db/schema"
import { escapeLikePattern } from "@/lib/utils"
import type { MantExecutorKind, MantRecordKind, MantRecordStatus, MantReview, MantUnit } from "@/lib/mantencion/types"
import { recordVisibility, recordVisibilitySql, type MantViewer } from "./access"
import { loadWorkshopCases } from "./records-workshop"
import type { RecordFilters, RecordListQuery, RecordSortKey } from "./records-filters"
import { RECORDS_PAGE_SIZE } from "./records-filters"

/**
 * Lista e indicadores de «Registros» (§10). El filtrado es SIEMPRE en el
 * servidor y SIEMPRE parte del alcance del usuario (`recordVisibilitySql`):
 * un supervisor sólo ve su faena y lo propio, un mecánico sólo lo propio. Los
 * filtros que llegan de la URL sólo pueden ACHICAR ese conjunto, nunca
 * agrandarlo.
 */

/** Predicado común de la lista, los indicadores y la exportación. */
export function recordsWhere(viewer: MantViewer, filters: RecordFilters): SQL {
  const conditions: Array<SQL | undefined> = [recordVisibilitySql(recordVisibility(viewer))]
  if (filters.worksiteId) conditions.push(eq(mantRecords.worksiteId, filters.worksiteId))
  if (filters.kind) conditions.push(eq(mantRecords.kind, filters.kind))
  if (filters.equipment) {
    const pattern = `%${escapeLikePattern(filters.equipment)}%`
    conditions.push(or(
      ilike(sql`${mantRecords.equipmentSnapshot}->>'code'`, pattern),
      ilike(sql`${mantRecords.equipmentSnapshot}->>'plate'`, pattern),
    ))
  }
  if (filters.executor) {
    const [prefix, id] = filters.executor.split(":") as ["u" | "w", string]
    conditions.push(prefix === "u" ? eq(mantRecords.executorUserId, id) : eq(mantRecords.executorWorkshopId, id))
  }
  if (filters.registeredBy) conditions.push(eq(mantRecords.registeredBy, filters.registeredBy))
  if (filters.from) conditions.push(gte(mantRecords.workDate, filters.from))
  if (filters.to) conditions.push(lte(mantRecords.workDate, filters.to))
  if (filters.status) conditions.push(eq(mantRecords.status, filters.status))
  if (filters.review) {
    // Las pestañas de revisión hablan de trabajo por hacer: un registro anulado ya no lo es.
    conditions.push(eq(mantRecords.review, filters.review), eq(mantRecords.status, "vigente"))
  }
  if (filters.alert === "salto") conditions.push(eq(mantRecords.readingJumpAlert, true))
  if (filters.alert === "fuera") conditions.push(eq(mantRecords.outOfWorksite, true))
  if (filters.alert === "pauta") {
    conditions.push(and(eq(mantRecords.kind, "P"), sql`${mantRecords.intervalValue} is distinct from ${mantRecords.suggestedIntervalValue}`))
  }
  if (filters.alert === "duplicado") conditions.push(isNotNull(mantRecords.duplicateOfRecordId))
  if (filters.situation === "en_taller") {
    conditions.push(and(
      eq(mantRecords.kind, "C"),
      eq(mantRecords.status, "vigente"),
      sql`exists (select 1 from ${mantRecordCorrectives} c where c.record_id = ${mantRecords.id} and c.in_workshop = true)`,
      sql`not exists (select 1 from ${mantWorkshopUpdates} u where u.record_id = ${mantRecords.id} and u.kind = 'salio')`,
    ))
  }
  if (filters.situation === "paso_taller") {
    conditions.push(and(
      eq(mantRecords.kind, "C"),
      sql`exists (select 1 from ${mantRecordCorrectives} c where c.record_id = ${mantRecords.id} and c.in_workshop = true)`,
    ))
  }
  if (filters.situation === "no_realizados") {
    conditions.push(and(
      eq(mantRecords.kind, "P"),
      sql`exists (select 1 from ${mantRecordItems} i where i.record_id = ${mantRecords.id} and i.value = 'NR')`,
    ))
  }
  return and(...conditions)!
}

export interface RecordListRow {
  id: string
  folio: string | null
  kind: MantRecordKind
  vehicleId: string
  equipment: MantEquipmentSnapshot
  worksiteName: string
  reading: number
  unit: MantUnit
  workDate: string
  signedAt: string
  receivedAt: string
  status: MantRecordStatus
  review: MantReview
  intervalValue: number | null
  executorKind: MantExecutorKind
  executorName: string
  registeredById: string
  registeredByName: string
  /** Preventiva: ítems «No realizado». */
  notDoneCount: number
  alerts: { jump: boolean; outOfWorksite: boolean; manualSchedule: boolean; duplicate: boolean }
  /** Correctiva que dejó el equipo en taller y sigue ahí. */
  workshop: { daysStopped: number | null; stale: boolean } | null
}

/** Columnas de orden. Siempre hay un desempate estable para que la paginación no repita ni pierda filas. */
function orderBy(sort: RecordSortKey, dir: "asc" | "desc"): SQL[] {
  const direction = dir === "asc" ? asc : desc
  const tie = [desc(mantRecords.receivedAt), asc(mantRecords.id)]
  switch (sort) {
    case "folio": return [direction(mantRecords.folio), ...tie]
    case "equipo": return [direction(sql`${mantRecords.equipmentSnapshot}->>'code'`), ...tie]
    case "faena": return [direction(worksites.name), ...tie]
    case "lectura": return [direction(mantRecords.reading), ...tie]
    default: return [direction(mantRecords.workDate), direction(mantRecords.receivedAt), asc(mantRecords.id)]
  }
}

export async function listRecords(
  viewer: MantViewer,
  query: RecordListQuery,
  pageSize: number = RECORDS_PAGE_SIZE,
): Promise<{ rows: RecordListRow[]; total: number; page: number }> {
  const where = recordsWhere(viewer, query.filters)
  const [counted] = await db.select({ total: sql<number>`count(*)::int` }).from(mantRecords).where(where)
  const total = counted?.total ?? 0
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const page = Math.min(query.page, totalPages)
  const registrar = alias(users, "registrar")

  const rows = await db
    .select({
      id: mantRecords.id,
      folio: mantRecords.folio,
      kind: mantRecords.kind,
      vehicleId: mantRecords.vehicleId,
      equipment: mantRecords.equipmentSnapshot,
      worksiteName: worksites.name,
      reading: mantRecords.reading,
      unit: mantRecords.unit,
      workDate: mantRecords.workDate,
      signedAt: mantRecords.signedAt,
      receivedAt: mantRecords.receivedAt,
      status: mantRecords.status,
      review: mantRecords.review,
      intervalValue: mantRecords.intervalValue,
      suggestedIntervalValue: mantRecords.suggestedIntervalValue,
      executorKind: mantRecords.executorKind,
      executorName: mantRecords.executorName,
      registeredById: mantRecords.registeredBy,
      registeredByName: registrar.name,
      jump: mantRecords.readingJumpAlert,
      outOfWorksite: mantRecords.outOfWorksite,
      duplicateOf: mantRecords.duplicateOfRecordId,
      notDoneCount: sql<number>`(select count(*)::int from ${mantRecordItems} i where i.record_id = ${mantRecords.id} and i.value = 'NR')`,
    })
    .from(mantRecords)
    .innerJoin(worksites, eq(worksites.id, mantRecords.worksiteId))
    .innerJoin(registrar, eq(registrar.id, mantRecords.registeredBy))
    .where(where)
    .orderBy(...orderBy(query.sort, query.dir))
    .limit(pageSize)
    .offset((page - 1) * pageSize)

  const correctiveIds = rows.filter((row) => row.kind === "C" && row.status === "vigente").map((row) => row.id)
  const cases = correctiveIds.length
    ? await loadWorkshopCases(and(inArray(mantRecords.id, correctiveIds), eq(mantRecords.status, "vigente")))
    : []
  const open = new Map(cases.filter((item) => item.state.inWorkshop).map((item) => [item.recordId, item.state]))

  return {
    total,
    page,
    rows: rows.map((row): RecordListRow => ({
      id: row.id,
      folio: row.folio,
      kind: row.kind as MantRecordKind,
      vehicleId: row.vehicleId,
      equipment: row.equipment,
      worksiteName: row.worksiteName,
      reading: row.reading,
      unit: row.unit as MantUnit,
      workDate: row.workDate,
      signedAt: row.signedAt,
      receivedAt: row.receivedAt,
      status: row.status as MantRecordStatus,
      review: row.review as MantReview,
      intervalValue: row.intervalValue,
      executorKind: row.executorKind as MantExecutorKind,
      executorName: row.executorName,
      registeredById: row.registeredById,
      registeredByName: row.registeredByName,
      notDoneCount: row.notDoneCount,
      alerts: {
        jump: row.jump,
        outOfWorksite: row.outOfWorksite,
        manualSchedule: row.kind === "P" && row.intervalValue !== row.suggestedIntervalValue,
        duplicate: row.duplicateOf !== null,
      },
      workshop: open.has(row.id) ? { daysStopped: open.get(row.id)!.daysStopped, stale: open.get(row.id)!.stale } : null,
    })),
  }
}

export interface RecordNeighbors {
  /** Lugar del registro dentro de la lista (desde 1) y cuántos hay en ella. */
  position: number
  total: number
  previous: { id: string; folio: string | null } | null
  next: { id: string; folio: string | null } | null
}

/**
 * Anterior y siguiente de un registro dentro de una lista: la MISMA consulta
 * (`recordsWhere`, con el alcance del usuario) y el MISMO orden que `listRecords`,
 * así «Siguiente» es la fila que el usuario tenía debajo. `null` cuando el
 * registro no está en esa lista (otro filtro, otra faena, ya no coincide).
 */
export async function loadRecordNeighbors(viewer: MantViewer, query: RecordListQuery, recordId: string): Promise<RecordNeighbors | null> {
  const where = recordsWhere(viewer, query.filters)
  const order = sql.join(orderBy(query.sort, query.dir), sql`, `)
  const ranked = db
    .select({
      id: mantRecords.id,
      position: sql<number>`(row_number() over (order by ${order}))::int`.as("position"),
      total: sql<number>`(count(*) over ())::int`.as("total"),
      previousId: sql<string | null>`lag(${mantRecords.id}) over (order by ${order})`.as("previous_id"),
      previousFolio: sql<string | null>`lag(${mantRecords.folio}) over (order by ${order})`.as("previous_folio"),
      nextId: sql<string | null>`lead(${mantRecords.id}) over (order by ${order})`.as("next_id"),
      nextFolio: sql<string | null>`lead(${mantRecords.folio}) over (order by ${order})`.as("next_folio"),
    })
    .from(mantRecords)
    .innerJoin(worksites, eq(worksites.id, mantRecords.worksiteId))
    .where(where)
    .as("ranked")
  const [row] = await db.select().from(ranked).where(eq(ranked.id, recordId)).limit(1)
  if (!row) return null
  return {
    position: row.position,
    total: row.total,
    previous: row.previousId ? { id: row.previousId, folio: row.previousFolio } : null,
    next: row.nextId ? { id: row.nextId, folio: row.nextFolio } : null,
  }
}

/**
 * Cuántos registros hay en cada pestaña de revisión, con los demás filtros de la
 * lista aplicados (el de revisión no, porque cada conteo es el suyo). Sólo cuentan
 * los vigentes: la pestaña «Por revisar» es trabajo por hacer.
 */
export async function loadRecordReviewCounts(viewer: MantViewer, filters: RecordFilters): Promise<Record<MantReview, number>> {
  const where = and(recordsWhere(viewer, { ...filters, review: undefined }), eq(mantRecords.status, "vigente"))
  const rows = await db
    .select({ review: mantRecords.review, total: sql<number>`count(*)::int` })
    .from(mantRecords)
    .where(where)
    .groupBy(mantRecords.review)
  const counts: Record<MantReview, number> = { pendiente: 0, observado: 0, revisado: 0 }
  for (const row of rows) counts[row.review as MantReview] = row.total
  return counts
}

export interface RecordIndicators {
  total: number
  preventive: number
  corrective: number
  /** Equipos distintos con una correctiva aún en taller. */
  workshopEquipment: number
  workshopStale: number
  notDoneItems: number
  notDoneRecords: number
  /** Personas distintas que registraron. */
  registrars: number
  /** Rango de fechas de trabajo de lo contado; `null` sin registros. */
  range: { from: string; to: string } | null
}

/**
 * Indicadores de lo que muestra la lista. Excluyen los anulados (regla 13) aunque
 * la lista los muestre marcados: una cifra de gestión no cuenta lo que se anuló.
 */
export async function loadRecordIndicators(viewer: MantViewer, filters: RecordFilters): Promise<RecordIndicators> {
  const where = and(recordsWhere(viewer, filters), eq(mantRecords.status, "vigente"))
  const [[summary], [notDone], cases] = await Promise.all([
    db.select({
      total: sql<number>`count(*)::int`,
      preventive: sql<number>`(count(*) filter (where ${mantRecords.kind} = 'P'))::int`,
      corrective: sql<number>`(count(*) filter (where ${mantRecords.kind} = 'C'))::int`,
      registrars: sql<number>`count(distinct ${mantRecords.registeredBy})::int`,
      from: sql<string | null>`min(${mantRecords.workDate})`,
      to: sql<string | null>`max(${mantRecords.workDate})`,
    }).from(mantRecords).where(where),
    db.select({
      items: sql<number>`count(*)::int`,
      records: sql<number>`count(distinct ${mantRecordItems.recordId})::int`,
    }).from(mantRecordItems).innerJoin(mantRecords, eq(mantRecords.id, mantRecordItems.recordId))
      .where(and(eq(mantRecordItems.value, "NR"), where)),
    loadWorkshopCases(and(where, eq(mantRecords.kind, "C"))),
  ])
  const open = cases.filter((item) => item.state.inWorkshop)
  return {
    total: summary?.total ?? 0,
    preventive: summary?.preventive ?? 0,
    corrective: summary?.corrective ?? 0,
    workshopEquipment: new Set(open.map((item) => item.vehicleId)).size,
    workshopStale: new Set(open.filter((item) => item.state.stale).map((item) => item.vehicleId)).size,
    notDoneItems: notDone?.items ?? 0,
    notDoneRecords: notDone?.records ?? 0,
    registrars: summary?.registrars ?? 0,
    range: summary?.from && summary.to ? { from: summary.from, to: summary.to } : null,
  }
}

export interface RecordFilterOptions {
  worksites: Array<{ id: string; name: string }>
  executors: Array<{ value: string; label: string }>
  registrars: Array<{ value: string; label: string }>
}

/**
 * Opciones de los selectores, sacadas de lo que el usuario puede ver: un
 * supervisor no se entera por el desplegable de qué otras faenas ni qué otros
 * mecánicos existen.
 */
export async function loadRecordFilterOptions(viewer: MantViewer): Promise<RecordFilterOptions> {
  const visibility = recordVisibility(viewer)
  const visible = recordVisibilitySql(visibility)
  const worksiteIds = visibility.kind === "all" ? [] : visibility.worksiteIds
  const [worksiteRows, executorRows, registrarRows] = await Promise.all([
    db.select({ id: worksites.id, name: worksites.name })
      .from(worksites)
      .innerJoin(mantWorksiteSettings, eq(mantWorksiteSettings.worksiteId, worksites.id))
      .where(visibility.kind === "all"
        ? undefined
        : or(
          worksiteIds.length ? inArray(worksites.id, worksiteIds) : sql`false`,
          sql`${worksites.id} in (select ${mantRecords.worksiteId} from ${mantRecords} where ${visible})`,
        ))
      .orderBy(asc(worksites.name)),
    db.selectDistinct({
      userId: mantRecords.executorUserId,
      workshopId: mantRecords.executorWorkshopId,
      name: mantRecords.executorName,
    }).from(mantRecords).where(visible),
    db.selectDistinct({ id: users.id, name: users.name })
      .from(mantRecords).innerJoin(users, eq(users.id, mantRecords.registeredBy)).where(visible),
  ])

  const byLabel = (a: { label: string }, b: { label: string }) => a.label.localeCompare(b.label, "es")
  const executors = new Map<string, string>()
  for (const row of executorRows) {
    if (row.userId) executors.set(`u:${row.userId}`, row.name)
    else if (row.workshopId) executors.set(`w:${row.workshopId}`, `${row.name} (taller externo)`)
  }
  return {
    worksites: worksiteRows,
    executors: [...executors].map(([value, label]) => ({ value, label })).sort(byLabel),
    registrars: registrarRows.map((row) => ({ value: row.id, label: row.name })).sort(byLabel),
  }
}
