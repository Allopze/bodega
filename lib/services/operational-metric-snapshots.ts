/** Instantáneas diarias para comparativos reales de backlog. */
import { and, count, desc, eq, gte, inArray, lt, sql } from "drizzle-orm"
import type { Session } from "next-auth"
import { db } from "@/db"
import { operationalMetricSnapshots, pdtpObligations, preventionCapaActions, purchaseOrders, purchaseRequests, worksiteStock, worksites } from "@/db/schema"
import { nanoid } from "@/lib/id"
import { resolveWorksiteScope } from "@/lib/auth/scope"

const BACKLOG_METRICS = ["backlog_requests", "backlog_orders", "backlog_capa", "backlog_pdtp"] as const

/**
 * `stock_alerts` se instantánea igual que el backlog pero no es backlog: no
 * aparece en "Backlog comparado", alimenta la tendencia del tile de Stock
 * crítico. Es la única métrica de los tiles que se puede agregar por faena sin
 * perder fidelidad — las de la cola operacional dependen de los permisos del
 * usuario (`requests:view_own` filtra por `requesterId`), así que ninguna suma
 * por faena reconstruye la cifra que el tile muestra.
 */
const SNAPSHOT_METRICS = [...BACKLOG_METRICS, "stock_alerts"] as const

export type OperationalBacklogMetric = typeof BACKLOG_METRICS[number]
export type OperationalSnapshotMetric = typeof SNAPSHOT_METRICS[number]

export interface OperationalBacklogComparison {
  metric: OperationalBacklogMetric
  current: number
  previous: number | null
  snapshotDate: string | null
}

function todayInChile(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Santiago", year: "numeric", month: "2-digit", day: "2-digit" }).format(now)
}

function monthStartInChile(now = new Date()) {
  return `${todayInChile(now).slice(0, 7)}-01`
}

async function currentBacklogRows(worksiteIds: string[]) {
  if (worksiteIds.length === 0) return [[], [], [], []] as const
  return Promise.all([
    db.select({ worksiteId: purchaseRequests.worksiteId, value: count() }).from(purchaseRequests).where(and(inArray(purchaseRequests.worksiteId, worksiteIds), inArray(purchaseRequests.status, ["draft", "submitted", "in_review", "partially_approved", "approved", "returned", "in_purchasing"]))).groupBy(purchaseRequests.worksiteId),
    db.select({ worksiteId: purchaseOrders.worksiteId, value: count() }).from(purchaseOrders).where(and(inArray(purchaseOrders.worksiteId, worksiteIds), inArray(purchaseOrders.status, ["draft", "issued", "sent", "partially_office_received", "office_received", "partially_received"]))).groupBy(purchaseOrders.worksiteId),
    db.select({ worksiteId: preventionCapaActions.worksiteId, value: count() }).from(preventionCapaActions).where(and(inArray(preventionCapaActions.worksiteId, worksiteIds), inArray(preventionCapaActions.status, ["pending", "in_progress", "pending_verification", "reopened"]))).groupBy(preventionCapaActions.worksiteId),
    db.select({ worksiteId: pdtpObligations.worksiteId, value: count() }).from(pdtpObligations).where(and(inArray(pdtpObligations.worksiteId, worksiteIds), inArray(pdtpObligations.status, ["pending", "overdue", "reported"]))).groupBy(pdtpObligations.worksiteId),
  ])
}

export async function captureOperationalMetricSnapshots(now = new Date()) {
  const snapshotDate = todayInChile(now)
  const [activeWorksites, requests, orders, capa, obligations, stockAlerts] = await Promise.all([
    db.select({ id: worksites.id }).from(worksites).where(eq(worksites.isActive, true)),
    db.select({ worksiteId: purchaseRequests.worksiteId, value: count() }).from(purchaseRequests).where(inArray(purchaseRequests.status, ["draft", "submitted", "in_review", "partially_approved", "approved", "returned", "in_purchasing"])).groupBy(purchaseRequests.worksiteId),
    db.select({ worksiteId: purchaseOrders.worksiteId, value: count() }).from(purchaseOrders).where(inArray(purchaseOrders.status, ["draft", "issued", "sent", "partially_office_received", "office_received", "partially_received"])).groupBy(purchaseOrders.worksiteId),
    db.select({ worksiteId: preventionCapaActions.worksiteId, value: count() }).from(preventionCapaActions).where(inArray(preventionCapaActions.status, ["pending", "in_progress", "pending_verification", "reopened"])).groupBy(preventionCapaActions.worksiteId),
    db.select({ worksiteId: pdtpObligations.worksiteId, value: count() }).from(pdtpObligations).where(inArray(pdtpObligations.status, ["pending", "overdue", "reported"])).groupBy(pdtpObligations.worksiteId),
    // Mismo predicado que `getCriticalStockAlertCount`, agrupado por faena.
    db.select({ worksiteId: worksiteStock.worksiteId, value: count() }).from(worksiteStock).where(sql`${worksiteStock.minStock} > 0 AND ${worksiteStock.quantity} < ${worksiteStock.minStock}`).groupBy(worksiteStock.worksiteId),
  ])
  const maps = [
    ["backlog_requests", requests], ["backlog_orders", orders], ["backlog_capa", capa], ["backlog_pdtp", obligations],
    ["stock_alerts", stockAlerts],
  ] as const
  const rows = maps.flatMap(([metric, source]) => {
    const values = new Map(source.map((row) => [row.worksiteId, row.value]))
    return activeWorksites.map((worksite) => ({ id: nanoid(), metric, worksiteId: worksite.id, snapshotDate, value: String(values.get(worksite.id) ?? 0) }))
  })
  if (rows.length === 0) return { snapshotDate, written: 0 }
  await db.insert(operationalMetricSnapshots).values(rows).onConflictDoUpdate({
    target: [operationalMetricSnapshots.metric, operationalMetricSnapshots.worksiteId, operationalMetricSnapshots.snapshotDate],
    set: { value: sql`excluded.value` },
  })
  return { snapshotDate, written: rows.length }
}

/** Faenas activas que la sesión puede ver; `[]` si no hay ninguna. */
async function visibleActiveWorksiteIds(session: Session): Promise<string[]> {
  const scope = resolveWorksiteScope(session)
  if (scope.mode === "none") return []
  const worksiteFilter = scope.mode === "all" ? eq(worksites.isActive, true) : and(eq(worksites.isActive, true), inArray(worksites.id, scope.ids))
  const activeWorksites = await db.select({ id: worksites.id }).from(worksites).where(worksiteFilter)
  return activeWorksites.map((worksite) => worksite.id)
}

/**
 * Compara backlog actual con el último corte completo anterior al mes actual.
 * Se exige cobertura de todas las faenas visibles para no comparar universos
 * distintos; si falta una instantánea, la UI lo declara explícitamente.
 */
export async function getOperationalBacklogComparisons(session: Session, now = new Date()): Promise<OperationalBacklogComparison[]> {
  const worksiteIds = await visibleActiveWorksiteIds(session)
  if (worksiteIds.length === 0) return []

  const currentRowsPromise = currentBacklogRows(worksiteIds)
  const snapshotsPromise = db.select({ metric: operationalMetricSnapshots.metric, worksiteId: operationalMetricSnapshots.worksiteId, snapshotDate: operationalMetricSnapshots.snapshotDate, value: operationalMetricSnapshots.value })
      .from(operationalMetricSnapshots)
      .where(and(inArray(operationalMetricSnapshots.metric, BACKLOG_METRICS), inArray(operationalMetricSnapshots.worksiteId, worksiteIds), lt(operationalMetricSnapshots.snapshotDate, monthStartInChile(now))))
      .orderBy(desc(operationalMetricSnapshots.snapshotDate))
  const [[requestRows, orderRows, capaRows, pdtpRows], snapshots] = await Promise.all([currentRowsPromise, snapshotsPromise])

  const currentByMetric = new Map<OperationalBacklogMetric, Map<string, number>>([
    ["backlog_requests", new Map(requestRows.map((row) => [row.worksiteId, row.value]))],
    ["backlog_orders", new Map(orderRows.map((row) => [row.worksiteId, row.value]))],
    ["backlog_capa", new Map(capaRows.map((row) => [row.worksiteId, row.value]))],
    ["backlog_pdtp", new Map(pdtpRows.map((row) => [row.worksiteId, row.value]))],
  ])
  const snapshotsByMetric = new Map<OperationalBacklogMetric, Map<string, Map<string, number>>>()
  for (const row of snapshots) {
    if (!BACKLOG_METRICS.includes(row.metric as OperationalBacklogMetric)) continue
    const metric = row.metric as OperationalBacklogMetric
    const dates = snapshotsByMetric.get(metric) ?? new Map<string, Map<string, number>>()
    const values = dates.get(row.snapshotDate) ?? new Map<string, number>()
    values.set(row.worksiteId, Number(row.value))
    dates.set(row.snapshotDate, values)
    snapshotsByMetric.set(metric, dates)
  }

  return BACKLOG_METRICS.map((metric) => {
    const current = worksiteIds.reduce((total, worksiteId) => total + (currentByMetric.get(metric)?.get(worksiteId) ?? 0), 0)
    const completeSnapshot = [...(snapshotsByMetric.get(metric)?.entries() ?? [])]
      .sort(([left], [right]) => right.localeCompare(left))
      .find(([, values]) => values.size === worksiteIds.length)
    return {
      metric,
      current,
      previous: completeSnapshot ? [...completeSnapshot[1].values()].reduce((total, value) => total + value, 0) : null,
      snapshotDate: completeSnapshot?.[0] ?? null,
    }
  })
}

function chileDateDaysAgo(days: number, now = new Date()) {
  return todayInChile(new Date(now.getTime() - days * 86_400_000))
}

/**
 * Serie diaria por métrica para los sparklines, en orden cronológico.
 *
 * Aplica la misma regla de cobertura que `getOperationalBacklogComparisons`:
 * un día sólo entra si tiene instantánea de **todas** las faenas visibles. Sin
 * eso la línea caería los días en que faltó el snapshot de una faena, dibujando
 * una mejora que nunca ocurrió.
 *
 * Devuelve `[]` por métrica cuando no hay días completos; el consumidor exige
 * ≥2 puntos antes de dibujar.
 */
export async function getOperationalSnapshotHistory(
  session: Session,
  days = 30,
  now = new Date(),
): Promise<Record<OperationalSnapshotMetric, number[]>> {
  const empty = Object.fromEntries(SNAPSHOT_METRICS.map((metric) => [metric, [] as number[]])) as Record<OperationalSnapshotMetric, number[]>
  const worksiteIds = await visibleActiveWorksiteIds(session)
  if (worksiteIds.length === 0) return empty

  const rows = await db
    .select({ metric: operationalMetricSnapshots.metric, worksiteId: operationalMetricSnapshots.worksiteId, snapshotDate: operationalMetricSnapshots.snapshotDate, value: operationalMetricSnapshots.value })
    .from(operationalMetricSnapshots)
    .where(and(
      inArray(operationalMetricSnapshots.metric, SNAPSHOT_METRICS),
      inArray(operationalMetricSnapshots.worksiteId, worksiteIds),
      gte(operationalMetricSnapshots.snapshotDate, chileDateDaysAgo(days, now)),
    ))

  const byMetric = new Map<string, Map<string, Map<string, number>>>()
  for (const row of rows) {
    const dates = byMetric.get(row.metric) ?? new Map<string, Map<string, number>>()
    const values = dates.get(row.snapshotDate) ?? new Map<string, number>()
    values.set(row.worksiteId, Number(row.value))
    dates.set(row.snapshotDate, values)
    byMetric.set(row.metric, dates)
  }

  for (const metric of SNAPSHOT_METRICS) {
    empty[metric] = [...(byMetric.get(metric)?.entries() ?? [])]
      .filter(([, values]) => values.size === worksiteIds.length)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([, values]) => [...values.values()].reduce((total, value) => total + value, 0))
  }
  return empty
}
