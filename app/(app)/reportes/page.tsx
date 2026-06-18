import type { Metadata } from "next"
import type { ReactNode } from "react"
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
import { REQUEST_STATE_META, ITEM_STATE_META, OC_STATE_META } from "@/components/states/state-badge"
import { ExportDialog } from "@/components/export-dialog"
import { formatCLP } from "@/lib/utils"
import { and, count, eq, inArray, sql, sum, asc } from "drizzle-orm"
import { ChartBar, ShoppingCart, Truck, ArrowRight } from "@phosphor-icons/react/dist/ssr"
import Link from "next/link"

export const metadata: Metadata = { title: "Reportes" }

type ReportMetric = {
  label: string
  value: string | number
  detail: string
}

export default async function Page() {
  let session
  try { session = await requirePermission("reports:view") }
  catch { redirect("/forbidden") }

  const isGlobal = isGlobalRole(session)
  const wsIds = visibleWorksiteIds(session)
  const requestWsFilter = isGlobal ? undefined : (wsIds.length > 0 ? inArray(purchaseRequests.worksiteId, wsIds) : sql`false`)
  const orderWsFilter = isGlobal ? undefined : (wsIds.length > 0 ? inArray(purchaseOrders.worksiteId, wsIds) : sql`false`)
  const receiptWsFilter = isGlobal
    ? undefined
    : (wsIds.length > 0
        ? sql`(${receipts.worksiteId} IS NULL OR ${inArray(receipts.worksiteId, wsIds)})`
        : sql`${receipts.worksiteId} IS NULL AND 1 = 0`)

  const activeWorksites = await db
    .select({ id: worksites.id, name: worksites.name })
    .from(worksites)
    .where(eq(worksites.isActive, true))
    .orderBy(asc(worksites.name))

  const [
    requestSummary,
    itemSummary,
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
        pendingApproval: sql<number>`count(*) filter (where ${purchaseRequestItems.status} = 'requested')`,
      })
      .from(purchaseRequestItems)
      .innerJoin(purchaseRequests, eqRequestItemRequest())
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
  const itemTotals = itemSummary[0]
  const orderTotals = orderSummary[0]
  const receiptTotals = receiptSummary[0]
  const pendingReceiptCount = Number(orderTotals?.pendingReceipt ?? 0)
  const metrics: ReportMetric[] = [
    {
      label: "Solicitudes",
      value: Number(requestTotals?.total ?? 0),
      detail: `${Number(requestTotals?.inReview ?? 0)} en revisión`,
    },
    {
      label: "Ítems solicitados",
      value: Number(itemTotals?.total ?? 0),
      detail: `${Number(itemTotals?.pendingApproval ?? 0)} pendientes de aprobación`,
    },
    {
      label: "Órdenes de compra",
      value: Number(orderTotals?.total ?? 0),
      detail: `${formatCLP(Number(orderTotals?.totalAmount ?? 0))} acumulado`,
    },
    {
      label: "Recepciones",
      value: Number(receiptTotals?.total ?? 0),
      detail: `${pendingReceiptCount} OC pendientes de recepción`,
    },
    {
      label: "OC pendientes",
      value: pendingReceiptCount,
      detail: "Órdenes enviadas pendientes de oficina o bodega/faena",
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
            { label: "Dashboard", href: "/dashboard" },
            { label: "Reportes" },
          ]} />
        }
        actions={
          <div className="grid w-full grid-cols-1 gap-2 sm:w-auto sm:grid-cols-3">
            <ExportDialog
              tipo="items_sin_oc"
              label="Ítems sin OC"
              worksites={activeWorksites}
              statuses={[
                { value: "approved", label: "Aprobado" },
                { value: "pending_purchase", label: "Pendiente compra" },
              ]}
              tone="signal"
            />
            <ExportDialog
              tipo="gasto_faena"
              label="Gasto por faena"
              worksites={activeWorksites}
              statuses={[
                { value: "draft", label: "Borrador" },
                { value: "issued", label: "Emitida" },
                { value: "sent", label: "Enviada" },
                { value: "received", label: "Recibida" },
                { value: "cancelled", label: "Cancelada" },
              ]}
            />
            <ExportDialog
              tipo="oc_por_estado"
              label="OC por estado"
              worksites={activeWorksites}
              statuses={[
                { value: "draft", label: "Borrador" },
                { value: "issued", label: "Emitida" },
                { value: "sent", label: "Enviada" },
                { value: "supplier_confirmed", label: "Confirmada proveedor" },
                { value: "office_received", label: "Recibida oficina" },
                { value: "received", label: "Recibida" },
                { value: "cancelled", label: "Cancelada" },
              ]}
            />
          </div>
        }
      />

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
        {metrics.map((metric) => (
          <section key={metric.label} className="rounded-[var(--radius-2xl)] bg-[var(--color-surface)] shadow-[var(--shadow-card)] p-5">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <ChartBar size={16} className="text-[var(--color-text-subtle)]" />
                <h2 className="text-sm font-medium text-[var(--color-text)]">{metric.label}</h2>
              </div>
              <Badge variant="outline">{metric.value}</Badge>
            </div>
            <p className="mt-3 text-sm text-[var(--color-text-muted)]">{metric.detail}</p>
          </section>
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

function BreakdownPanel({
  title, subtitle, icon, total, rows, cta, emptyLabel, tone,
}: {
  title: string
  subtitle: string
  icon: ReactNode
  total: number
  rows: { label: string; value: number }[]
  cta: { label: string; href: string }
  emptyLabel: string
  tone?: "signal"
}) {
  const signalActive = tone === "signal" && total > 0
  return (
    <section className="flex flex-col rounded-[var(--radius-2xl)] bg-[var(--color-surface)] shadow-[var(--shadow-card)] p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className={signalActive ? "text-[var(--color-signal)]" : "text-[var(--color-text-subtle)]"}>{icon}</span>
          <div>
            <h2 className="text-sm font-medium text-[var(--color-text)]">{title}</h2>
            <p className="mt-0.5 text-xs text-[var(--color-text-subtle)]">{subtitle}</p>
          </div>
        </div>
        <span className={`font-mono text-2xl font-semibold leading-none tabular-nums ${signalActive ? "text-[var(--color-signal-ink)]" : "text-[var(--color-text)]"}`}>
          {total}
        </span>
      </div>

      <div className="mt-4 flex-1 divide-y divide-[var(--color-border)]">
        {rows.length === 0 ? (
          <p className="py-2 text-sm text-[var(--color-text-muted)]">{emptyLabel}</p>
        ) : rows.map((row) => (
          <div key={row.label} className="flex items-center justify-between gap-3 py-2">
            <span className="text-sm text-[var(--color-text-muted)] truncate">{row.label}</span>
            <span className="font-mono text-sm tabular-nums text-[var(--color-text)]">{row.value}</span>
          </div>
        ))}
      </div>

      {total > 0 && (
        <Link
          href={cta.href}
          className="mt-4 inline-flex items-center gap-1.5 self-start text-xs font-medium text-[var(--color-primary)] transition-transform duration-[var(--duration-fast)] active:scale-[0.98]"
        >
          {cta.label}
          <ArrowRight size={13} />
        </Link>
      )}
    </section>
  )
}

function eqRequestItemRequest() {
  return eq(purchaseRequestItems.requestId, purchaseRequests.id)
}

function statusRows(rows: { status: string; total: number }[]) {
  return rows.map((row) => [row.status, Number(row.total)] as [string, number]).sort((a, b) => b[1] - a[1])
}

/** Map a raw DB status to its Spanish label, falling back to the raw value. */
function stateLabel(entity: "request" | "item" | "oc", status: string): string {
  const map = entity === "request" ? REQUEST_STATE_META
    : entity === "oc" ? OC_STATE_META
    : ITEM_STATE_META
  return (map as Record<string, { label: string }>)[status]?.label ?? status
}

function StatusGroup({ title, entity, rows }: { title: string; entity: "request" | "item" | "oc"; rows: [string, number][] }) {
  return (
    <div>
      <p className="text-xs font-medium uppercase tracking-[0.08em] text-[var(--color-text-subtle)]">{title}</p>
      <div className="mt-2 divide-y divide-[var(--color-border)]">
        {rows.length === 0 ? (
          <p className="py-2 text-sm text-[var(--color-text-muted)]">Sin datos</p>
        ) : rows.map(([status, count]) => (
          <div key={status} className="flex items-center justify-between gap-3 py-2">
            <span className="text-sm text-[var(--color-text-muted)]">{stateLabel(entity, status)}</span>
            <span className="font-mono text-sm text-[var(--color-text)]">{count}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
