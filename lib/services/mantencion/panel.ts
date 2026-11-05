import { and, asc, desc, eq, gte, inArray, sql, type SQL } from "drizzle-orm"
import { db } from "@/db"
import { mantRecordCorrectives, mantRecordItems, mantRecords, mantWorkOrders, mantWorksiteSettings, worksites } from "@/db/schema"
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
  /**
   * OT que retiene el equipo en taller; `null` (o ausente) si lo retiene una
   * correctiva. Con OT, `recordId` es el de la orden y «Trabajo»/«Motivo» salen
   * de la OT, no de `mant_record_correctives`.
   */
  workOrderId?: string | null
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

  // Días fuera de servicio del período: tramos ingreso → salida, o hasta hoy si el
  // equipo sigue detenido. `cases` sólo trae correctivas con `in_workshop`, y en el
  // flujo con OT la correctiva no lo marca: el tramo de una OT en ejecución sólo
  // existe en `fleet.workshop`. Sin esto, un equipo en taller por OT sumaba 0 días.
  let stoppedTotal = 0
  const stoppedEquipment = new Set<string>()
  const addSegment = (vehicleId: string, entryDate: string, exitDate: string | null) => {
    const days = stoppedDaysWithin(entryDate, exitDate, today, from)
    if (days <= 0) return
    stoppedTotal += days
    stoppedEquipment.add(vehicleId)
  }

  // Tramo ABIERTO por equipo, tal como lo resolvió `loadFleet`: una OT en ejecución
  // reemplaza a la correctiva del mismo equipo. Es la fuente autoritativa del tramo
  // abierto y su `recordId` es el que no debe contarse dos veces desde `cases`.
  const openByVehicle = new Map<string, { recordId: string; entryDate: string; workOrderId: string | null }>()
  for (const row of fleet) {
    const workshop = row.workshop
    if (!workshop?.entryDate || workshop.exitDate) continue
    openByVehicle.set(row.vehicleId, {
      recordId: workshop.recordId,
      entryDate: workshop.entryDate,
      workOrderId: workshop.workOrderId ?? null,
    })
  }

  // 1. Tramos cerrados: ingreso → salida de la correctiva.
  for (const item of cases) {
    if (!item.entryDate || !item.state.exitDate) continue
    addSegment(item.vehicleId, item.entryDate, item.state.exitDate)
  }

  // 2. Tramos abiertos que conoce la flota (OT o la correctiva abierta que eligió
  //    `loadFleet`): una vez por equipo, recortados al período.
  const countedRecords = new Set<string>()
  for (const [vehicleId, open] of openByVehicle) {
    countedRecords.add(open.recordId)
    addSegment(vehicleId, open.entryDate, null)
  }

  // 3. Correctivas abiertas que la flota no trae (equipo de baja, tipo sin unidad de
  //    medida o fuera del alcance de equipos): una vez por registro. Si el equipo
  //    tiene una OT abierta, no se suman: la OT ya contó ese tramo y el dato es
  //    inconsistente (la OT manda).
  for (const item of cases) {
    if (!item.entryDate || item.state.exitDate) continue
    if (openByVehicle.get(item.vehicleId)?.workOrderId) continue
    if (countedRecords.has(item.recordId)) continue
    countedRecords.add(item.recordId)
    addSegment(item.vehicleId, item.entryDate, null)
  }

  const weekMap = new Map(weeks.map((start) => [start, { start, preventive: 0, corrective: 0 }]))
  for (const row of weekRows) {
    const bucket = weekMap.get(row.week)
    if (bucket) bucket[row.kind === "P" ? "preventive" : "corrective"] += row.n
  }

  const inShop = fleet.filter((row) => row.workshop)
  const [summaries, orderSummaries] = await Promise.all([
    correctiveSummaries(inShop.filter((row) => !row.workshop!.workOrderId).map((row) => row.workshop!.recordId)),
    workOrderSummaries(inShop.filter((row) => row.workshop!.workOrderId).map((row) => row.workshop!.recordId)),
  ])

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
        .map((row): PanelWorkshopRow => {
          const workOrderId = row.workshop!.workOrderId ?? null
          // Con OT, «Trabajo» y «Motivo» están en la OT; la correctiva del mismo equipo no existe.
          const described = workOrderId ? orderSummaries.get(workOrderId) : summaries.get(row.workshop!.recordId)
          return {
            recordId: row.workshop!.recordId,
            workOrderId,
            folio: row.workshop!.folio,
            code: row.code,
            plate: row.plate,
            worksiteName: row.worksiteName,
            summary: described?.description ?? "",
            reason: described?.reason ?? null,
            daysStopped: row.workshop!.daysStopped,
            stale: row.workshop!.stale,
          }
        })
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

/** «Trabajo» y «Motivo» de una OT en taller: lo que se pidió reparar y las observaciones. */
async function workOrderSummaries(workOrderIds: string[]): Promise<Map<string, { description: string; reason: string | null }>> {
  if (workOrderIds.length === 0) return new Map()
  const rows = await db
    .select({ id: mantWorkOrders.id, description: mantWorkOrders.repairDescription, reason: mantWorkOrders.observations })
    .from(mantWorkOrders)
    .where(inArray(mantWorkOrders.id, workOrderIds))
  return new Map(rows.map((row) => [row.id, { description: row.description ?? "", reason: row.reason }]))
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
