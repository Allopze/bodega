import "server-only"
import type { Session } from "next-auth"
import { and, eq, inArray, min, sql, type AnyColumn } from "drizzle-orm"
import { db } from "@/db"
import { fleetGpsSyncRuns, fuelProviderPeriodCoverage, fuelTelemetryDaily, fuelVehicles } from "@/db/schema"
import { worksiteScopeSql } from "@/lib/auth/scope"
import { listCopecPeriodCoverage } from "@/lib/combustibles/copec-coverage-store"
import { dailyTelemetry } from "@/lib/combustibles/control/queries/idle"
import { parseControlFilters } from "@/lib/combustibles/control/filters"
import {
  copecChannelCell,
  coverageWindow,
  dailySourceCell,
  type CoverageCell,
  type CoverageRow,
} from "@/lib/combustibles/coverage-matrix"
import { formatQty, todayInChile } from "@/lib/utils"

/**
 * Datos del mapa de cobertura de «Fuentes de datos» (CHART-022): por cada
 * fuente que existe en el modelo y que esta sesión puede ver, un estado por mes
 * de los últimos 12. La regla de cada estado vive en `coverage-matrix.ts`; aquí
 * sólo se leen los insumos, con el mismo alcance que ya tiene cada fuente en
 * `sources-status.ts`:
 *
 * - **Copec** (tarjeta de equipos y abastecimiento de estanques): cobertura por
 *   mes de `fuel_provider_period_coverage`. Global, como la sincronización:
 *   sólo con `combustibles:sync_integrations`.
 * - **Telemetría de equipos** (VisionLink): días de `fuel_telemetry_daily`, con
 *   una sola fila por equipo y día (`dailyTelemetry`) y acotada a las faenas de
 *   la persona. Con `combustibles:import`.
 * - **GPS OnWay**: días con una sincronización exitosa (`fleet_gps_sync_runs`).
 *   La sincronización no pertenece a una faena: sólo con `sync_integrations`.
 *
 * El registro en terreno no está: es un registro por evento, sin una noción de
 * «mes completo» que mostrar.
 */
export interface FuelCoverageMatrix {
  /** `YYYY-MM`, del más antiguo al mes en curso. */
  months: string[]
  rows: CoverageRow[]
}

/** Día civil chileno de un instante `timestamptz`: la sincronización de las 23:00 es de ese día, no del siguiente en UTC. */
const chileDay = (column: AnyColumn) => sql`(${column} at time zone 'America/Santiago')::date`

const liters = (value: number) => `${formatQty(value, undefined, { maximumFractionDigits: 0 })} L`

/** Una fila se muestra si la fuente alguna vez trajo algo: una fila de puro «no aplica» no informa nada. */
const hasAnyData = (cells: CoverageCell[]) => cells.some((cell) => cell.status !== "na")

export async function getFuelCoverageMatrix(session: Session, today: string = todayInChile()): Promise<FuelCoverageMatrix> {
  const permissions = new Set<string>(session.user?.permissions ?? [])
  const canSync = permissions.has("combustibles:sync_integrations")
  const canImport = permissions.has("combustibles:import")
  const months = coverageWindow(today)
  const from = `${months[0]}-01`

  const [copec, telemetry, onway] = await Promise.all([
    canSync ? copecRows(months, from, today) : [],
    canImport ? telemetryRow(session, months, from, today) : [],
    canSync ? onwayRow(months, from, today) : [],
  ])
  return { months, rows: [...copec, ...telemetry, ...onway].filter((row) => hasAnyData(row.cells)) }
}

async function copecRows(months: string[], from: string, today: string): Promise<CoverageRow[]> {
  const [coverage, firsts] = await Promise.all([
    listCopecPeriodCoverage(from, today),
    db.select({ channel: fuelProviderPeriodCoverage.channel, first: min(fuelProviderPeriodCoverage.periodMonth) })
      .from(fuelProviderPeriodCoverage)
      .where(eq(fuelProviderPeriodCoverage.provider, "copec"))
      .groupBy(fuelProviderPeriodCoverage.channel),
  ])
  const firstMonth = new Map(firsts.map((row) => [row.channel, row.first ? row.first.slice(0, 7) : null]))
  const channel = (key: "TCT" | "TAE", id: string, label: string): CoverageRow => ({
    id,
    label,
    cells: months.map((month) => copecChannelCell({
      channel: key,
      month,
      today,
      firstMonth: firstMonth.get(key) ?? null,
      rows: coverage.filter((row) => row.periodMonth === `${month}-01`),
    })),
  })
  return [
    channel("TCT", "copec-tarjeta", "Copec: tarjeta de equipos"),
    channel("TAE", "copec-abastecimiento", "Copec: abastecimiento de estanques"),
  ]
}

async function telemetryRow(session: Session, months: string[], from: string, today: string): Promise<CoverageRow[]> {
  const d = dailyTelemetry(session, parseControlFilters({ desde: from, hasta: today }))
  const [perMonth, [first]] = await Promise.all([
    db.select({
      month: d.month,
      days: sql<number>`count(distinct ${d.day})::int`,
      vehicles: sql<number>`count(distinct ${d.vehicleId})::int`,
      liters: sql<number>`coalesce(sum(coalesce(${d.litersWorking}, 0) + coalesce(${d.litersIdle}, 0)), 0)::float8`,
    }).from(d).groupBy(d.month),
    db.select({ first: min(fuelTelemetryDaily.day) }).from(fuelTelemetryDaily)
      .innerJoin(fuelVehicles, eq(fuelVehicles.id, fuelTelemetryDaily.vehicleId))
      .where(worksiteScopeSql(session, fuelVehicles.worksiteId)),
  ])
  const byMonth = new Map(perMonth.map((row) => [row.month, row]))
  return [{
    id: "telemetria",
    label: "Telemetría de equipos",
    cells: months.map((month) => {
      const row = byMonth.get(month)
      return dailySourceCell({
        month,
        today,
        firstDay: first?.first ?? null,
        daysWithData: row?.days ?? 0,
        // Un equipo que no operó un día no informa ese día: se toleran algunos.
        completeRatio: 0.9,
        unit: "con datos",
        extra: row ? `${formatQty(row.vehicles)} ${row.vehicles === 1 ? "equipo" : "equipos"}, ${liters(row.liters)}` : undefined,
      })
    }),
  }]
}

async function onwayRow(months: string[], from: string, today: string): Promise<CoverageRow[]> {
  const day = chileDay(fleetGpsSyncRuns.startedAt)
  const succeeded = inArray(fleetGpsSyncRuns.status, ["success", "partial"])
  const [perDay, [first]] = await Promise.all([
    db.select({ day: sql<string>`${day}::text`, runs: sql<number>`count(*)::int` })
      .from(fleetGpsSyncRuns)
      .where(and(succeeded, sql`${day} >= ${from}::date`, sql`${day} <= ${today}::date`))
      .groupBy(day),
    db.select({ first: sql<string | null>`min(${day})::text` }).from(fleetGpsSyncRuns).where(succeeded),
  ])
  const byMonth = new Map<string, { days: number; runs: number }>()
  for (const row of perDay) {
    const entry = byMonth.get(row.day.slice(0, 7)) ?? { days: 0, runs: 0 }
    entry.days += 1
    entry.runs += row.runs
    byMonth.set(row.day.slice(0, 7), entry)
  }
  return [{
    id: "onway",
    label: "GPS OnWay",
    cells: months.map((month) => {
      const entry = byMonth.get(month)
      return dailySourceCell({
        month,
        today,
        firstDay: first?.first ?? null,
        daysWithData: entry?.days ?? 0,
        // La sincronización corre cada hora: un día sin ninguna corrida exitosa es un hueco.
        completeRatio: 1,
        unit: "con sincronización",
        extra: entry ? `${formatQty(entry.runs)} ${entry.runs === 1 ? "corrida" : "corridas"}` : undefined,
      })
    }),
  }]
}
