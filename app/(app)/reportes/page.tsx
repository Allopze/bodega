import type { Metadata } from "next"
import Link from "next/link"
import { redirect } from "next/navigation"
import { db } from "@/db"
import {
  purchaseRequests, purchaseRequestItems, purchaseOrders,
  receipts, worksites,
} from "@/db/schema"
import { requirePermission } from "@/lib/auth/can"
import { isGlobalRole, visibleWorksiteIds } from "@/lib/auth/can"
import { PageHeader, Breadcrumbs } from "@/components/ui/page-header"
import { PageContainer } from "@/components/ui/page-container"
import { Badge } from "@/components/ui/badge"
import { formatCLP } from "@/lib/utils"
import { and, count, eq, inArray, isNull, sql, sum, asc } from "drizzle-orm"
import { ChartBar, ShoppingCart, Truck } from "@phosphor-icons/react/dist/ssr"
import { ReportMetric, BreakdownPanel, StatusGroup, statusRows } from "./reportes-page.helpers"
import { ReportsExportMenu } from "./reports-export-menu"

export const metadata: Metadata = { title: "Reportes" }

export default async function Page() {
  let session
  try { session = await requirePermission("reports:view") }
  catch { redirect("/forbidden") }

  const isGlobal = isGlobalRole(session)
  const wsIds = visibleWorksiteIds(session)
  const requestWsFilter = isGlobal ? undefined : (wsIds.length > 0 ? inArray(purchaseRequests.worksiteId, wsIds) : sql`false`)
  // DAT-16: una OC eliminada (soft-delete, deletedAt poblado) no debe seguir
  // sumando en los agregados del dashboard de reportes.
  const orderWsFilter = and(
    isNull(purchaseOrders.deletedAt),
    isGlobal ? undefined : (wsIds.length > 0 ? inArray(purchaseOrders.worksiteId, wsIds) : sql`false`),
  )
  // Un usuario scoped solo ve recepciones de sus faenas — nunca las de worksiteId NULL (B-6).
  const receiptWsFilter = isGlobal
    ? undefined
    : (wsIds.length > 0
        ? inArray(receipts.worksiteId, wsIds)
        : sql`false`)

  const activeWorksites = await db
    .select({ id: worksites.id, name: worksites.name })
    .from(worksites)
    .where(eq(worksites.isActive, true))
    .orderBy(asc(worksites.name))

  const [
    requestSummary,
    orderSummary,
    receiptSummary,
    requestStatusRows,
    itemStatusRows,
    orderStatusRows,
    itemsSinOcByWorksite,
    ocPendingByWorksite,
  ] = await Promise.all([
    db
      .select({
        total: count(),
        inReview: sql<number>`count(*) filter (where ${purchaseRequests.status} in ('submitted', 'in_review'))`,
      })
      .from(purchaseRequests)
      .where(requestWsFilter),

    db
      .select({
        total: count(),
        totalAmount: sql<number>`coalesce(${sum(purchaseOrders.totalAmount)}, 0)`,
        pendingReceipt: sql<number>`count(*) filter (where ${purchaseOrders.status} in ('sent', 'partially_office_received', 'office_received', 'partially_received'))`,
      })
      .from(purchaseOrders)
      .where(orderWsFilter),

    db
      .select({
        total: count(),
      })
      .from(receipts)
      .where(receiptWsFilter),

    db
      .select({ status: purchaseRequests.status, total: count() })
      .from(purchaseRequests)
      .where(requestWsFilter)
      .groupBy(purchaseRequests.status),

    db
      .select({ status: purchaseRequestItems.status, total: count() })
      .from(purchaseRequestItems)
      .innerJoin(purchaseRequests, eqRequestItemRequest())
      .where(requestWsFilter)
      .groupBy(purchaseRequestItems.status),

    db
      .select({ status: purchaseOrders.status, total: count() })
      .from(purchaseOrders)
      .where(orderWsFilter)
      .groupBy(purchaseOrders.status),

    db
      .select({ worksiteId: purchaseRequests.worksiteId, total: count() })
      .from(purchaseRequestItems)
      .innerJoin(purchaseRequests, eqRequestItemRequest())
      .where(and(requestWsFilter, inArray(purchaseRequestItems.status, ["approved", "pending_purchase"])))
      .groupBy(purchaseRequests.worksiteId),

    db
      .select({ worksiteId: purchaseOrders.worksiteId, total: count() })
      .from(purchaseOrders)
      .where(and(orderWsFilter, inArray(purchaseOrders.status, ["sent", "partially_office_received", "office_received", "partially_received"])))
      .groupBy(purchaseOrders.worksiteId),
  ])

  const requestTotals = requestSummary[0]
  const orderTotals = orderSummary[0]
  const receiptTotals = receiptSummary[0]
  const pendingReceiptCount = Number(orderTotals?.pendingReceipt ?? 0)
  const metrics: ReportMetric[] = [
    {
      label: "Solicitudes",
      value: Number(requestTotals?.total ?? 0),
      detail: `${Number(requestTotals?.inReview ?? 0)} en revisión`,
      href: "/solicitudes",
    },
    {
      label: "Órdenes de compra",
      value: Number(orderTotals?.total ?? 0),
      detail: `${formatCLP(Number(orderTotals?.totalAmount ?? 0))} acumulado`,
      href: "/compras",
    },
    {
      label: "Recepciones",
      value: Number(receiptTotals?.total ?? 0),
      detail: `${pendingReceiptCount} OC pendientes de recepción`,
      href: "/recepcion",
    },
    {
      label: "OC pendientes",
      value: pendingReceiptCount,
      detail: "Órdenes enviadas pendientes de oficina o bodega/faena",
      href: "/recepcion",
    },
  ]

  const wsNameMap = Object.fromEntries(activeWorksites.map((w) => [w.id, w.name]))
  const toBreakdown = (rows: { worksiteId: string; total: number }[]) =>
    rows
      .map((row) => ({ label: wsNameMap[row.worksiteId] ?? row.worksiteId, value: Number(row.total) }))
      .sort((a, b) => b.value - a.value)

  const itemsSinOcRows = toBreakdown(itemsSinOcByWorksite)
  const ocPendingRows = toBreakdown(ocPendingByWorksite)
  const itemsSinOcTotal = itemsSinOcRows.reduce((sum, row) => sum + row.value, 0)
  const ocPendingTotal = ocPendingRows.reduce((sum, row) => sum + row.value, 0)

  return (
    <PageContainer>
      <PageHeader
        title="Reportes"
        description="Resumen operativo desde datos persistidos."
        breadcrumb={
          <Breadcrumbs items={[
            { label: "Inicio", href: "/dashboard" },
            { label: "Reportes" },
          ]} />
        }
        actions={<ReportsExportMenu worksites={activeWorksites} />}
      />

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
        {metrics.map((metric) => (
          <Link key={metric.label} href={metric.href} className="rounded-[var(--radius-2xl)] bg-[var(--color-surface)] p-5 shadow-[var(--shadow-card)] transition-colors hover:bg-[var(--color-surface-2)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-primary)]">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <ChartBar size={16} className="text-[var(--color-text-subtle)]" />
                <h2 className="text-sm font-medium text-[var(--color-text)]">{metric.label}</h2>
              </div>
              <Badge variant="outline">{metric.value}</Badge>
            </div>
            <p className="mt-3 text-sm text-[var(--color-text-muted)]">{metric.detail}</p>
          </Link>
        ))}
      </div>

      <section className="mt-6 rounded-[var(--radius-2xl)] bg-[var(--color-surface)] shadow-[var(--shadow-card)] p-5">
        <h2 className="text-h2">Estados principales</h2>
        <div className="mt-4 grid gap-4 md:grid-cols-3">
          <StatusGroup title="Solicitudes" entity="request" rows={statusRows(requestStatusRows)} />
          <StatusGroup title="Ítems" entity="item" rows={statusRows(itemStatusRows)} />
          <StatusGroup title="OC" entity="oc" rows={statusRows(orderStatusRows)} />
        </div>
      </section>

      <div className="mt-6 grid gap-4 md:grid-cols-2">
        <BreakdownPanel
          title="Ítems sin OC por faena"
          subtitle="Ítems aprobados o pendientes de compra que aún no tienen orden."
          icon={<ShoppingCart size={16} />}
          total={itemsSinOcTotal}
          rows={itemsSinOcRows}
          tone="signal"
          cta={{ label: "Generar orden de compra", href: "/compras/nueva" }}
          emptyLabel="No hay ítems pendientes de compra."
        />
        <BreakdownPanel
          title="OC pendientes por faena"
          subtitle="Órdenes enviadas pendientes de recepción en oficina o faena."
          icon={<Truck size={16} />}
          total={ocPendingTotal}
          rows={ocPendingRows}
          cta={{ label: "Ir a recepción", href: "/recepcion" }}
          emptyLabel="No hay órdenes pendientes de recepción."
        />
      </div>
    </PageContainer>
  )
}

function eqRequestItemRequest() {
  return eq(purchaseRequestItems.requestId, purchaseRequests.id)
}
