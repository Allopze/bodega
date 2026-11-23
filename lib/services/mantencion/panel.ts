import { and, asc, eq, gte, inArray, lte, sql, type SQL } from "drizzle-orm"
import { db } from "@/db"
import { mantRecords, worksites } from "@/db/schema"
import { equipmentScope, recordVisibility, recordVisibilitySql, type MantViewer } from "./access"
import type { MantWorksiteScope } from "./fleet"

/**
 * Lecturas compartidas del Panel de mantención (`/mantencion/panel`) y de sus Indicadores. Reglas que
 * no se negocian:
 *
 * - Todo lo que cuenta REGISTROS excluye los anulados y respeta el alcance del
 *   usuario (`recordVisibilitySql`): el panel de un supervisor es el de su faena.
 * - Todo lo que cuenta EQUIPOS (vencidas, próximas, en taller, estado de la
 *   flota) sale de `loadFleet`, la única fuente del estado de un equipo.
 *
 * El Panel viejo (`loadPanel`, sus tarjetas y su libro de Excel) se retiró el 2026-11-16: desde que
 * los Indicadores son el Panel nadie lo leía. Aquí queda sólo lo que siguen usando la página y
 * `indicators.ts`.
 */

/** El filtro de faena sólo puede achicar el alcance de equipos, nunca agrandarlo. */
export function fleetScopeFor(viewer: MantViewer, worksiteId: string | undefined): MantWorksiteScope {
  const scope = equipmentScope(viewer)
  if (!worksiteId) return scope
  if (scope === "all") return [worksiteId]
  return scope.includes(worksiteId) ? [worksiteId] : []
}

/**
 * Base de todo lo que cuenta REGISTROS: vigentes, dentro del alcance del usuario y de la faena
 * elegida (sin período). La comparten el panel y los Indicadores.
 */
function recordsBase(viewer: MantViewer, worksiteId: string | undefined): SQL {
  return and(
    recordVisibilitySql(recordVisibility(viewer)),
    eq(mantRecords.status, "vigente"),
    worksiteId ? eq(mantRecords.worksiteId, worksiteId) : undefined,
  )!
}

export type RecordSeriesGranularity = "day" | "week" | "month"

export interface RecordSeriesRow {
  /** Primer día del balde, `YYYY-MM-DD` (el lunes en la semana; el día 1 en el mes). */
  bucket: string
  kind: "P" | "C"
  n: number
}

/**
 * Registros vigentes por balde y tipo (preventiva «P» / correctiva «C»). Es la consulta del
 * gráfico semanal del panel, extraída para que los Indicadores la usen con otra ventana y
 * granularidad. Sólo devuelve baldes con registros: quien dibuja rellena los vacíos.
 *
 * `to` es opcional: el panel no pone tope superior (las 8 semanas llegan hasta hoy).
 * La granularidad entra como literal SQL de una lista cerrada, no como parámetro: con un
 * parámetro `date_trunc($1, …)` en el SELECT y en el GROUP BY serían expresiones distintas
 * para Postgres.
 */
export async function loadRecordSeries(
  viewer: MantViewer,
  input: { from: string; to?: string; granularity: RecordSeriesGranularity; worksiteId?: string },
): Promise<RecordSeriesRow[]> {
  const bucketExpr = {
    day: sql<string>`to_char(date_trunc('day', ${mantRecords.workDate}::date), 'YYYY-MM-DD')`,
    week: sql<string>`to_char(date_trunc('week', ${mantRecords.workDate}::date), 'YYYY-MM-DD')`,
    month: sql<string>`to_char(date_trunc('month', ${mantRecords.workDate}::date), 'YYYY-MM-DD')`,
  }[input.granularity]
  const rows = await db.select({ bucket: bucketExpr, kind: mantRecords.kind, n: sql<number>`count(*)::int` })
    .from(mantRecords)
    .where(and(
      recordsBase(viewer, input.worksiteId),
      gte(mantRecords.workDate, input.from),
      input.to ? lte(mantRecords.workDate, input.to) : undefined,
    ))
    .groupBy(bucketExpr, mantRecords.kind)
  return rows.map((row) => ({ bucket: row.bucket, kind: row.kind === "P" ? "P" : "C", n: row.n }))
}

/**
 * Registros vigentes que esperan revisión de la jefatura, sin período: es trabajo pendiente
 * hoy, no una cifra del período. Misma regla que la pestaña «Por revisar» de Registros.
 */
export async function countPendingReview(viewer: MantViewer, worksiteId: string | undefined): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(mantRecords)
    .where(and(recordsBase(viewer, worksiteId), eq(mantRecords.review, "pendiente")))
  return row?.n ?? 0
}

/**
 * Faenas del selector del panel: las ACTIVAS de su alcance de equipos (nunca las de otros). Es la misma
 * fuente que el filtro de la lista de OT (`loadWorkOrderFilterOptions`): sin `mant_worksite_settings`,
 * que ofrecía faenas desactivadas (duplicadas por la unificación) y omitía activas sin configuración.
 */
export async function loadPanelWorksites(viewer: MantViewer): Promise<Array<{ id: string; name: string }>> {
  const scope = equipmentScope(viewer)
  if (scope !== "all" && scope.length === 0) return []
  return db
    .select({ id: worksites.id, name: worksites.name })
    .from(worksites)
    .where(and(eq(worksites.isActive, true), scope === "all" ? undefined : inArray(worksites.id, scope)))
    .orderBy(asc(worksites.name))
}
