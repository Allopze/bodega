import { and, count, eq, sql, type SQL } from "drizzle-orm"
import type { DB } from "@/db"
import { purchaseRequestItems, purchaseRequests } from "@/db/schema"
import {
  APPROVAL_AGE_BUCKETS,
  bucketApprovalAges,
  type ApprovalAgeCounts,
  type ApprovalAgeFilter,
} from "@/lib/approvals-age"

/**
 * Edad de lo que espera en la cola de aprobaciones, calculada **en SQL**.
 *
 * Una sola fórmula alimenta tres cosas que no pueden discrepar: el «hace N días»
 * de cada fila, los contadores del gráfico y el filtro `?antiguedad=` de la
 * lista. Si cada una la calculara por su lado (JavaScript para la fila, SQL para
 * el filtro) un ítem podría mostrar «hace 3 días» y no aparecer al filtrar «2–3».
 *
 * Es de **días civiles de Chile** —igual que `todayInChile()`—: la diferencia
 * entre el día de hoy y el día de envío, ambos en `America/Santiago`. Las horas
 * transcurridas darían otra cosa: lo enviado ayer a las 23:00 tiene 1 día esta
 * mañana, no 9 horas.
 *
 * `submitted_at` es `text` y guarda un instante ISO (`toISOString()`) o, en las
 * solicitudes migradas, `now()::text`; los dos se leen como `timestamptz`. `now`
 * entra como parámetro para que la lista, los contadores y el filtro midan contra
 * el mismo instante dentro de una misma petición (y para poder probarlo).
 */
export function approvalAgeDaysSql(now: Date): SQL<number | null> {
  const nowIso = now.toISOString()
  // `greatest` ignora los nulos (devolvería 0 para «sin fecha»), así que el nulo
  // se resuelve antes con el `case`. Un texto que no empieza con una fecha (vacío,
  // basura de una importación) tampoco es un timestamp: sin esta guarda el cast
  // reventaría la página entera por una sola fila.
  return sql<number | null>`case
    when ${purchaseRequests.submittedAt} is null or ${purchaseRequests.submittedAt} !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}' then null
    else greatest(0, (${nowIso}::timestamptz at time zone 'America/Santiago')::date - (${purchaseRequests.submittedAt}::timestamptz at time zone 'America/Santiago')::date)
  end`
}

/** Condición del tramo `?antiguedad=`. `undefined` (sin condición) cuando no hay tramo elegido. */
export function approvalAgeFilterSql(key: ApprovalAgeFilter, now: Date): SQL | undefined {
  if (!key) return undefined
  const bucket = APPROVAL_AGE_BUCKETS.find((candidate) => candidate.key === key)
  if (!bucket) return undefined
  const age = approvalAgeDaysSql(now)
  return bucket.max === null
    ? sql`${age} >= ${bucket.min}`
    : sql`${age} between ${bucket.min} and ${bucket.max}`
}

/**
 * Ítems pendientes de decisión por tramo de antigüedad.
 *
 * `where` es el alcance de la cola (permisos, faena, búsqueda, urgencia) **sin**
 * el filtro de antigüedad: el gráfico es el selector de ese filtro, y si los
 * contadores lo respetaran, elegir un tramo dejaría los otros tres en cero y no
 * habría cómo cambiar de tramo. Cuenta ítems `requested`, que es exactamente lo
 * que la lista despliega bajo cada solicitud.
 */
export async function loadApprovalAgeCounts(
  db: Pick<DB, "select">,
  where: SQL | undefined,
  now: Date,
): Promise<ApprovalAgeCounts> {
  const rows = await db
    // El `group by 1` agrupa por la edad de la primera columna. Agrupar por la
    // expresión repetida no sirve: lleva el instante como parámetro, y Postgres
    // ve dos parámetros distintos y rechaza el `select`.
    .select({ ageDays: approvalAgeDaysSql(now), items: count() })
    .from(purchaseRequestItems)
    .innerJoin(purchaseRequests, eq(purchaseRequests.id, purchaseRequestItems.requestId))
    .where(and(eq(purchaseRequestItems.status, "requested"), where))
    .groupBy(sql`1`)
  return bucketApprovalAges(
    rows.map((row) => ({
      ageDays: row.ageDays === null ? null : Number(row.ageDays),
      items: Number(row.items),
    })),
  )
}
