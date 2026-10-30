import { and, asc, desc, eq, gte, inArray, sql, type SQL } from "drizzle-orm"
import { db } from "@/db"
import { mantRecordCorrectives, mantRecordItems, mantRecords, mantWorksiteSettings, worksites } from "@/db/schema"
import { MANT_EQUIPMENT_STATES, type MantEquipmentState, type MantUnit } from "@/lib/mantencion/types"
import { todayInChile } from "@/lib/utils"
import { equipmentScope, recordVisibility, recordVisibilitySql, type MantViewer } from "./access"
import { loadFleet, type FleetRow, type MantWorksiteScope } from "./fleet"
import { lastWeeks, periodStart, stoppedDaysWithin, type PanelFilters } from "./panel-filters"
import { loadWorkshopCases } from "./records-workshop"

/**
 * Datos del panel de jefatura (§10). Reglas que no se negocian:
 *
 * - Todo lo que cuenta REGISTROS excluye los anulados y respeta el alcance del
 *   usuario (`recordVisibilitySql`): el panel de un supervisor es el de su faena.
 * - Todo lo que cuenta EQUIPOS (vencidas, próximas, en taller, estado de la
 *   flota) sale de `loadFleet`, la única fuente del estado de un equipo.
 */

export const WEEKS_SHOWN = 8
export const UPCOMING_LIMIT = 8
export const NOT_DONE_LIMIT = 5

export interface PanelWeek { start: string; preventive: number; corrective: number }

export interface PanelUpcomingRow {
  vehicleId: string
  code: string
  plate: string
  worksiteName: string
  scheduleName: string | null
  unit: MantUnit
  reading: number | null
  nextReading: number | null
  remaining: number | null
  nextIntervalValue: number | null
  state: MantEquipmentState
  /**
   * Días que lleva detenido en taller; `null` si no está en taller. Es lo que
   * evita que un equipo con 15 días en taller salga sólo como «Al día».
   */
  workshopDays: number | null
}

export interface PanelWorkshopRow {
  recordId: string
  folio: string | null
  code: string
  plate: string
  worksiteName: string
  summary: string
  /** Por qué sigue en taller, tal como lo escribió el mecánico. */
  reason: string | null
  daysStopped: number | null
  stale: boolean
}

export interface PanelData {
  filters: PanelFilters
  today: string
  /** Primer día del período; `null` = todo el historial. */
  from: string | null
  records: { total: number; preventive: number; corrective: number; hours: number; pendingReview: number }
  fleet: { counts: Record<MantEquipmentState, number>; active: number }
  workshop: { equipment: number; stale: number; rows: PanelWorkshopRow[] }
  stoppedDays: { total: number; equipment: number }
  weeks: PanelWeek[]
  upcoming: PanelUpcomingRow[]
  hoursByWorksite: Array<{ worksiteId: string; worksiteName: string; hours: number }>
  notDone: Array<{ item: string; group: string; count: number; lastReason: string | null }>
}

/** El filtro de faena sólo puede achicar el alcance de equipos, nunca agrandarlo. */
function fleetScopeFor(viewer: MantViewer, worksiteId: string | undefined): MantWorksiteScope {
  const scope = equipmentScope(viewer)
  if (!worksiteId) return scope
  if (scope === "all") return [worksiteId]
  return scope.includes(worksiteId) ? [worksiteId] : []
}

export async function loadPanel(viewer: MantViewer, filters: PanelFilters, today: string = todayInChile()): Promise<PanelData> {
  const from = periodStart(filters.period, today)
  const visible = recordVisibilitySql(recordVisibility(viewer))
  // Base: vigentes, dentro del alcance y de la faena elegida (sin período).
  const base: SQL = and(
    visible,
    eq(mantRecords.status, "vigente"),
    filters.worksiteId ? eq(mantRecords.worksiteId, filters.worksiteId) : undefined,
  )!
  const inPeriod: SQL = and(base, from ? gte(mantRecords.workDate, from) : undefined)!
  const weeks = lastWeeks(today, WEEKS_SHOWN)
  const weekExpr = sql<string>`to_char(date_trunc('week', ${mantRecords.workDate}::date), 'YYYY-MM-DD')`

  const [fleet, [totals], weekRows, hoursRows, notDoneRows, cases] = await Promise.all([
    loadFleet({ scope: fleetScopeFor(viewer, filters.worksiteId), today }),
    db.select({
      total: sql<number>`count(*)::int`,
      preventive: sql<number>`(count(*) filter (where ${mantRecords.kind} = 'P'))::int`,
      corrective: sql<number>`(count(*) filter (where ${mantRecords.kind} = 'C'))::int`,
      pendingReview: sql<number>`(count(*) filter (where ${mantRecords.review} = 'pendiente'))::int`,
      hours: sql<number>`coalesce(sum(${mantRecordCorrectives.hours}), 0)::float`,
    }).from(mantRecords)
      .leftJoin(mantRecordCorrectives, eq(mantRecordCorrectives.recordId, mantRecords.id))
      .where(inPeriod),
    db.select({ week: weekExpr, kind: mantRecords.kind, n: sql<number>`count(*)::int` })
      .from(mantRecords)
      .where(and(base, gte(mantRecords.workDate, weeks[0]!)))
      .groupBy(weekExpr, mantRecords.kind),
    db.select({
      worksiteId: worksites.id,
      worksiteName: worksites.name,
      hours: sql<number>`coalesce(sum(${mantRecordCorrectives.hours}), 0)::float`,
    }).from(mantRecords)
      .innerJoin(mantRecordCorrectives, eq(mantRecordCorrectives.recordId, mantRecords.id))
      .innerJoin(worksites, eq(worksites.id, mantRecords.worksiteId))
      .where(inPeriod)
      .groupBy(worksites.id, worksites.name)
      .orderBy(desc(sql`sum(${mantRecordCorrectives.hours})`), asc(worksites.name)),
    db.select({
      item: mantRecordItems.itemName,
      group: mantRecordItems.groupName,
      count: sql<number>`count(*)::int`,
      lastReason: sql<string | null>`(array_agg(${mantRecordItems.reason} order by ${mantRecords.workDate} desc, ${mantRecords.receivedAt} desc))[1]`,
    }).from(mantRecordItems)
      .innerJoin(mantRecords, eq(mantRecords.id, mantRecordItems.recordId))
      .where(and(eq(mantRecordItems.value, "NR"), inPeriod))
      .groupBy(mantRecordItems.itemName, mantRecordItems.groupName)
      .orderBy(desc(sql`count(*)`), asc(mantRecordItems.itemName))
      .limit(NOT_DONE_LIMIT),
    loadWorkshopCases(and(base, eq(mantRecords.kind, "C")), today),
  ])

  const counts = Object.fromEntries(MANT_EQUIPMENT_STATES.map((state) => [state, 0])) as Record<MantEquipmentState, number>
  for (const row of fleet) counts[row.status.state] += 1

  // Días fuera de servicio del período (tramos ingreso → salida, o hasta hoy).
  let stoppedTotal = 0
  const stoppedEquipment = new Set<string>()
  for (const item of cases) {
    if (!item.entryDate) continue
    const days = stoppedDaysWithin(item.entryDate, item.state.exitDate, today, from)
    if (days > 0) {
      stoppedTotal += days
      stoppedEquipment.add(item.vehicleId)
    }
  }

  const weekMap = new Map(weeks.map((start) => [start, { start, preventive: 0, corrective: 0 }]))
  for (const row of weekRows) {
    const bucket = weekMap.get(row.week)
    if (bucket) bucket[row.kind === "P" ? "preventive" : "corrective"] += row.n
  }

  const inShop = fleet.filter((row) => row.workshop)
  const summaries = await correctiveSummaries(inShop.map((row) => row.workshop!.recordId))

  return {
    filters,
    today,
    from,
    records: {
      total: totals?.total ?? 0,
      preventive: totals?.preventive ?? 0,
      corrective: totals?.corrective ?? 0,
      hours: totals?.hours ?? 0,
      pendingReview: totals?.pendingReview ?? 0,
    },
    fleet: { counts, active: fleet.length },
    workshop: {
      equipment: inShop.length,
      stale: inShop.filter((row) => row.workshop!.stale).length,
      rows: inShop
        .map((row): PanelWorkshopRow => ({
          recordId: row.workshop!.recordId,
          folio: row.workshop!.folio,
          code: row.code,
          plate: row.plate,
          worksiteName: row.worksiteName,
          summary: summaries.get(row.workshop!.recordId)?.description ?? "",
          reason: summaries.get(row.workshop!.recordId)?.reason ?? null,
          daysStopped: row.workshop!.daysStopped,
          stale: row.workshop!.stale,
        }))
        .sort((a, b) => (b.daysStopped ?? -1) - (a.daysStopped ?? -1) || a.code.localeCompare(b.code, "es", { numeric: true })),
    },
    stoppedDays: { total: stoppedTotal, equipment: stoppedEquipment.size },
    weeks: [...weekMap.values()],
    upcoming: upcomingRows(fleet),
    hoursByWorksite: hoursRows.filter((row) => row.hours > 0),
    notDone: notDoneRows,
  }
}

/** Qué tan cerca está de su próxima pauta, relativo al intervalo base (así un camión y una grúa son comparables). */
function closeness(row: FleetRow): number {
  const base = row.intervals[0] ?? 1
  return (row.status.remaining ?? Number.POSITIVE_INFINITY) / base
}

function upcomingRows(fleet: FleetRow[]): PanelUpcomingRow[] {
  return fleet
    .filter((row) => row.status.state === "vencida" || row.status.state === "proxima" || row.status.state === "al_dia")
    .sort((a, b) => closeness(a) - closeness(b) || a.code.localeCompare(b.code, "es", { numeric: true }))
    .slice(0, UPCOMING_LIMIT)
    .map((row) => ({
      vehicleId: row.vehicleId,
      code: row.code,
      plate: row.plate,
      worksiteName: row.worksiteName,
      scheduleName: row.scheduleName,
      unit: row.unit,
      reading: row.status.currentReading?.value ?? null,
      nextReading: row.status.nextReading,
      remaining: row.status.remaining,
      nextIntervalValue: row.status.nextIntervalValue,
      state: row.status.state,
      // El ingreso a taller es obligatorio en la correctiva (regla 11): `null` sólo sería un dato viejo, y cuenta como «desde hoy».
      workshopDays: row.workshop ? (row.workshop.daysStopped ?? 0) : null,
    }))
}

async function correctiveSummaries(recordIds: string[]): Promise<Map<string, { description: string; reason: string | null }>> {
  if (recordIds.length === 0) return new Map()
  const rows = await db
    .select({ recordId: mantRecordCorrectives.recordId, description: mantRecordCorrectives.description, reason: mantRecordCorrectives.workshopReason })
    .from(mantRecordCorrectives)
    .where(inArray(mantRecordCorrectives.recordId, recordIds))
  return new Map(rows.map((row) => [row.recordId, { description: row.description, reason: row.reason }]))
}

/** Faenas del selector del panel: las de su alcance de equipos (nunca las de otros). */
export async function loadPanelWorksites(viewer: MantViewer): Promise<Array<{ id: string; name: string }>> {
  const scope = equipmentScope(viewer)
  if (scope !== "all" && scope.length === 0) return []
  return db
    .select({ id: worksites.id, name: worksites.name })
    .from(worksites)
    .innerJoin(mantWorksiteSettings, eq(mantWorksiteSettings.worksiteId, worksites.id))
    .where(scope === "all" ? undefined : inArray(worksites.id, scope))
    .orderBy(asc(worksites.name))
}
