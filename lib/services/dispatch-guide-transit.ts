import { and, count, eq, inArray, sql, type SQL } from "drizzle-orm"
import { db } from "@/db"
import { dispatchGuides, worksites } from "@/db/schema"
import {
  GUIDE_AGE_BUCKETS,
  bucketGuideAges,
  type GuideAgeCounts,
  type GuideAgeFilter,
  type GuideTransitRow,
} from "@/lib/bodega/guide-transit"

/**
 * Consultas de los gráficos de `/bodega/guias` (CHART-037). Qué significa cada
 * número vive en `lib/bodega/guide-transit.ts`; aquí sólo se leen los insumos.
 *
 * Todas reciben `scopeSql` —el predicado de faena que el llamador ya resolvió con
 * `worksiteScopeSql(session, dispatchGuides.destinationWorksiteId)`—, igual que
 * `listDispatchGuides`: el alcance de las cifras y el de la lista de al lado no
 * pueden discrepar, y quien ve la faena A no cuenta ni una guía de la B.
 */

export interface GuideTransitFilters {
  /** Predicado de faena ya resuelto por el llamador. */
  scopeSql?: SQL | undefined
  /** Una sola faena de destino (se suma al alcance, no lo reemplaza). */
  destinationWorksiteId?: string
}

/**
 * Edad de una guía despachada en días civiles de Chile (hoy menos el día de
 * salida, ambos en `America/Santiago`), la misma regla que la cola de
 * aprobaciones: lo despachado ayer a las 23:00 tiene 1 día esta mañana, no 9
 * horas. Una sola fórmula alimenta el gráfico, el filtro `?antiguedad=` y la
 * lista, para que una guía no pueda contarse en un tramo y faltar al filtrarlo.
 * `now` entra como parámetro para medir todo contra el mismo instante.
 */
export function guideAgeDaysSql(now: Date): SQL<number> {
  return sql<number>`greatest(0, (${now.toISOString()}::timestamptz at time zone 'America/Santiago')::date - (${dispatchGuides.dispatchedAt} at time zone 'America/Santiago')::date)`
}

/** Condición del tramo `?antiguedad=`. `undefined` (sin condición) cuando no hay tramo elegido. */
export function guideAgeFilterSql(key: GuideAgeFilter, now: Date): SQL | undefined {
  if (!key) return undefined
  const bucket = GUIDE_AGE_BUCKETS.find((candidate) => candidate.key === key)
  if (!bucket) return undefined
  const age = guideAgeDaysSql(now)
  return bucket.max === null ? sql`${age} >= ${bucket.min}` : sql`${age} between ${bucket.min} and ${bucket.max}`
}

/**
 * Guías despachadas sin confirmar, por tramo de antigüedad. Es la foto de ahora:
 * no lleva filtro de período (la guía más vieja suele estar fuera de cualquier
 * ventana, y es la que importa) ni de búsqueda.
 */
export async function getGuideAgeCounts(filters: GuideTransitFilters, now: Date = new Date()): Promise<GuideAgeCounts> {
  const rows = await db
    // `group by 1`: agrupar por la expresión repetida no sirve, lleva el instante
    // como parámetro y Postgres ve dos parámetros distintos.
    .select({ ageDays: guideAgeDaysSql(now), guides: count() })
    .from(dispatchGuides)
    .where(and(
      eq(dispatchGuides.status, "dispatched"),
      sql`${dispatchGuides.dispatchedAt} is not null`,
      filters.scopeSql,
      filters.destinationWorksiteId ? eq(dispatchGuides.destinationWorksiteId, filters.destinationWorksiteId) : undefined,
    ))
    .groupBy(sql`1`)
  return bucketGuideAges(rows.map((row) => ({ ageDays: row.ageDays === null ? null : Number(row.ageDays), guides: Number(row.guides) })))
}

/**
 * Tiempo hasta confirmar la recepción, por faena de destino: mediana y P90 en días
 * entre el despacho y la confirmación, sobre las guías `received` emitidas en la
 * ventana `[from, to]` (la misma que la lista filtra: «Emitidas desde / hasta»).
 *
 * Las `partially_received` no entran a la mediana: su `received_at` es el del
 * último cotejo con diferencias, no el de «llegó todo». Se cuentan aparte para
 * poder decir cuántas quedaron fuera. Un reloj adelantado (confirmación antes del
 * despacho) mide cero días, nunca negativo.
 */
export async function getGuideTransitByDestination(
  filters: GuideTransitFilters & { from: string; to?: string },
): Promise<GuideTransitRow[]> {
  const days = sql`greatest(extract(epoch from (${dispatchGuides.receivedAt} - ${dispatchGuides.dispatchedAt})) / 86400, 0)`
  const isReceived = sql`${dispatchGuides.status} = 'received'`
  const rows = await db
    .select({
      worksiteId: dispatchGuides.destinationWorksiteId,
      worksiteName: worksites.name,
      confirmed: sql<number>`count(*) filter (where ${isReceived})`,
      median: sql<number | null>`percentile_cont(0.5) within group (order by ${days}) filter (where ${isReceived})`,
      p90: sql<number | null>`percentile_cont(0.9) within group (order by ${days}) filter (where ${isReceived})`,
      withDifferences: sql<number>`count(*) filter (where ${dispatchGuides.status} = 'partially_received')`,
    })
    .from(dispatchGuides)
    .innerJoin(worksites, eq(worksites.id, dispatchGuides.destinationWorksiteId))
    .where(and(
      inArray(dispatchGuides.status, ["received", "partially_received"]),
      sql`${dispatchGuides.dispatchedAt} is not null`,
      sql`${dispatchGuides.receivedAt} is not null`,
      filters.scopeSql,
      filters.destinationWorksiteId ? eq(dispatchGuides.destinationWorksiteId, filters.destinationWorksiteId) : undefined,
      sql`${dispatchGuides.issuedAt} >= ${`${filters.from}T00:00:00.000Z`}::timestamptz`,
      filters.to ? sql`${dispatchGuides.issuedAt} <= ${`${filters.to}T23:59:59.999Z`}::timestamptz` : undefined,
    ))
    .groupBy(dispatchGuides.destinationWorksiteId, worksites.name)

  return rows.map((row) => ({
    worksiteId: row.worksiteId,
    worksiteName: row.worksiteName,
    confirmed: Number(row.confirmed ?? 0),
    median: row.median === null || row.median === undefined ? null : Number(row.median),
    p90: row.p90 === null || row.p90 === undefined ? null : Number(row.p90),
    withDifferences: Number(row.withDifferences ?? 0),
  }))
}
