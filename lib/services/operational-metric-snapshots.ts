/** Instantáneas diarias para comparativos reales de backlog. */
import { and, count, desc, eq, inArray, lt, sql } from "drizzle-orm"
import type { Session } from "next-auth"
import { db } from "@/db"
import { operationalMetricSnapshots, pdtpObligations, preventionCapaActions, purchaseOrders, purchaseRequests, worksites } from "@/db/schema"
import { nanoid } from "@/lib/id"
import { resolveWorksiteScope } from "@/lib/auth/scope"

const BACKLOG_METRICS = ["backlog_requests", "backlog_orders", "backlog_capa", "backlog_pdtp"] as const

export type OperationalBacklogMetric = typeof BACKLOG_METRICS[number]

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
    db.select({ worksiteId: purchaseOrders.worksiteId, value: count() }).from(purchaseOrders).where(and(inArray(purchaseOrders.worksiteId, worksiteIds), inArray(purchaseOrders.status, ["draft", "issued", "sent", "supplier_confirmed", "partially_office_received", "office_received", "partially_received"]))).groupBy(purchaseOrders.worksiteId),
    db.select({ worksiteId: preventionCapaActions.worksiteId, value: count() }).from(preventionCapaActions).where(and(inArray(preventionCapaActions.worksiteId, worksiteIds), inArray(preventionCapaActions.status, ["pending", "in_progress", "pending_verification", "reopened"]))).groupBy(preventionCapaActions.worksiteId),
    db.select({ worksiteId: pdtpObligations.worksiteId, value: count() }).from(pdtpObligations).where(and(inArray(pdtpObligations.worksiteId, worksiteIds), inArray(pdtpObligations.status, ["pending", "overdue", "reported"]))).groupBy(pdtpObligations.worksiteId),
  ])
}

export async function captureOperationalMetricSnapshots(now = new Date()) {
  const snapshotDate = todayInChile(now)
  const [activeWorksites, requests, orders, capa, obligations] = await Promise.all([
    db.select({ id: worksites.id }).from(worksites).where(eq(worksites.isActive, true)),
    db.select({ worksiteId: purchaseRequests.worksiteId, value: count() }).from(purchaseRequests).where(inArray(purchaseRequests.status, ["draft", "submitted", "in_review", "partially_approved", "approved", "returned", "in_purchasing"])).groupBy(purchaseRequests.worksiteId),
    db.select({ worksiteId: purchaseOrders.worksiteId, value: count() }).from(purchaseOrders).where(inArray(purchaseOrders.status, ["draft", "issued", "sent", "supplier_confirmed", "partially_office_received", "office_received", "partially_received"])).groupBy(purchaseOrders.worksiteId),
    db.select({ worksiteId: preventionCapaActions.worksiteId, value: count() }).from(preventionCapaActions).where(inArray(preventionCapaActions.status, ["pending", "in_progress", "pending_verification", "reopened"])).groupBy(preventionCapaActions.worksiteId),
    db.select({ worksiteId: pdtpObligations.worksiteId, value: count() }).from(pdtpObligations).where(inArray(pdtpObligations.status, ["pending", "overdue", "reported"])).groupBy(pdtpObligations.worksiteId),
  ])
  const maps = [
    ["backlog_requests", requests], ["backlog_orders", orders], ["backlog_capa", capa], ["backlog_pdtp", obligations],
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

/**
 * Compara backlog actual con el último corte completo anterior al mes actual.
 * Se exige cobertura de todas las faenas visibles para no comparar universos
 * distintos; si falta una instantánea, la UI lo declara explícitamente.
 */
export async function getOperationalBacklogComparisons(session: Session, now = new Date()): Promise<OperationalBacklogComparison[]> {
  const scope = resolveWorksiteScope(session)
  if (scope.mode === "none") return []
  const worksiteFilter = scope.mode === "all" ? eq(worksites.isActive, true) : and(eq(worksites.isActive, true), inArray(worksites.id, scope.ids))
  const activeWorksites = await db.select({ id: worksites.id }).from(worksites).where(worksiteFilter)
  const worksiteIds = activeWorksites.map((worksite) => worksite.id)
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
