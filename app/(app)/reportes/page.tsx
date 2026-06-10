import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { db } from "@/db"
import {
  purchaseRequests, purchaseRequestItems, purchaseOrders,
  receipts,
} from "@/db/schema"
import { requirePermission } from "@/lib/auth/can"
import { isGlobalRole, visibleWorksiteIds } from "@/lib/auth/can"
import { PageHeader, Breadcrumbs } from "@/components/ui/page-header"
import { Badge } from "@/components/ui/badge"
import { formatCLP } from "@/lib/utils"
import { eq, inArray, sql } from "drizzle-orm"
import { ChartBar } from "@phosphor-icons/react/dist/ssr"

export const metadata: Metadata = { title: "Reportes" }

type ReportMetric = {
  label: string
  value: string | number
  detail: string
}

export default async function Page() {
  let session
  try { session = await requirePermission("reports:view") }
  catch { redirect("/dashboard") }

  const isGlobal = isGlobalRole(session)
  const wsIds = visibleWorksiteIds(session)
  const requestWsFilter = isGlobal ? undefined : (wsIds.length > 0 ? inArray(purchaseRequests.worksiteId, wsIds) : sql`1 = 0`)
  const orderWsFilter = isGlobal ? undefined : (wsIds.length > 0 ? inArray(purchaseOrders.worksiteId, wsIds) : sql`1 = 0`)
  const receiptWsFilter = isGlobal
    ? undefined
    : (wsIds.length > 0
        ? sql`(${receipts.worksiteId} IS NULL OR ${inArray(receipts.worksiteId, wsIds)})`
        : sql`${receipts.worksiteId} IS NULL AND 1 = 0`)

  const [
    requestRows,
    itemRows,
    orderRows,
    receiptRows,
  ] = await Promise.all([
    db
      .select({
        id: purchaseRequests.id,
        status: purchaseRequests.status,
        worksiteId: purchaseRequests.worksiteId,
      })
      .from(purchaseRequests)
      .where(requestWsFilter),

    db
      .select({
        id: purchaseRequestItems.id,
        status: purchaseRequestItems.status,
        worksiteId: purchaseRequests.worksiteId,
      })
      .from(purchaseRequestItems)
      .innerJoin(purchaseRequests, eqRequestItemRequest())
      .where(requestWsFilter),

    db
      .select({
        id: purchaseOrders.id,
        status: purchaseOrders.status,
        worksiteId: purchaseOrders.worksiteId,
        totalAmount: purchaseOrders.totalAmount,
      })
      .from(purchaseOrders)
      .where(orderWsFilter),

    db
      .select({
        id: receipts.id,
        status: receipts.status,
        worksiteId: receipts.worksiteId,
      })
      .from(receipts)
      .where(receiptWsFilter),
  ])

  const requests = requestRows
  const items = itemRows
  const orders = orderRows
  const receiptsVisible = receiptRows
  const metrics: ReportMetric[] = [
    {
      label: "Solicitudes",
      value: requests.length,
      detail: `${countWhere(requests, "status", "submitted", "in_review")} en revisión`,
    },
    {
      label: "Ítems solicitados",
      value: items.length,
      detail: `${items.filter((i) => i.status === "requested").length} pendientes de aprobación`,
    },
    {
      label: "Órdenes de compra",
      value: orders.length,
      detail: `${formatCLP(orders.reduce((sum, order) => sum + order.totalAmount, 0))} acumulado`,
    },
    {
      label: "Recepciones",
      value: receiptsVisible.length,
      detail: `${orders.filter((o) => ["sent", "partially_received"].includes(o.status)).length} OC pendientes de recepción`,
    },
    {
      label: "OC pendientes",
      value: orders.filter((o) => ["sent", "partially_received"].includes(o.status)).length,
      detail: "Compras enviadas aún no marcadas como recibidas",
    },
  ]

  return (
    <>
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
            <ExportLinks tipo="items_sin_oc" label="Ítems sin OC" tone="signal" />
            <ExportLinks tipo="gasto_faena" label="Gasto por faena" />
            <ExportLinks tipo="oc_por_estado" label="OC por estado" />
          </div>
        }
      />

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
        {metrics.map((metric) => (
          <section key={metric.label} className="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
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

      <section className="mt-6 rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
        <h2 className="text-h2">Estados principales</h2>
        <div className="mt-4 grid gap-4 md:grid-cols-3">
          <StatusGroup title="Solicitudes" rows={statusRows(requests)} />
          <StatusGroup title="Ítems" rows={statusRows(items)} />
          <StatusGroup title="OC" rows={statusRows(orders)} />
        </div>
      </section>
    </>
  )
}

function ExportLinks({
  tipo,
  label,
  tone = "neutral",
}: {
  tipo: string
  label: string
  tone?: "neutral" | "signal"
}) {
  const baseClass = tone === "signal"
    ? "border-[var(--color-signal-100)] bg-[var(--color-signal-50)] text-[var(--color-signal-600)] hover:opacity-80"
    : "border-[var(--color-border)] bg-[var(--color-surface-2)] text-[var(--color-text-muted)] hover:bg-[var(--color-surface)]"

  return (
    <a
      href={`/api/reportes/export?tipo=${tipo}`}
      aria-label={`Exportar Excel: ${label}`}
      className={`inline-flex h-8 w-full items-center justify-center gap-1.5 whitespace-nowrap rounded-[var(--radius)] border px-3 text-xs font-medium transition-colors ${baseClass}`}
    >
      Exportar {label}
    </a>
  )
}

function eqRequestItemRequest() {
  return eq(purchaseRequestItems.requestId, purchaseRequests.id)
}

function countWhere<T extends Record<K, string>, K extends keyof T>(rows: T[], key: K, ...values: string[]) {
  return rows.filter((row) => values.includes(row[key])).length
}

function statusRows(rows: { status: string }[]) {
  const counts = new Map<string, number>()
  for (const row of rows) counts.set(row.status, (counts.get(row.status) ?? 0) + 1)
  return [...counts.entries()].sort((a, b) => b[1] - a[1])
}

function StatusGroup({ title, rows }: { title: string; rows: [string, number][] }) {
  return (
    <div>
      <p className="text-xs font-medium uppercase tracking-[0.08em] text-[var(--color-text-subtle)]">{title}</p>
      <div className="mt-2 divide-y divide-[var(--color-border)]">
        {rows.length === 0 ? (
          <p className="py-2 text-sm text-[var(--color-text-muted)]">Sin datos</p>
        ) : rows.map(([status, count]) => (
          <div key={status} className="flex items-center justify-between gap-3 py-2">
            <span className="text-sm text-[var(--color-text-muted)]">{status}</span>
            <span className="font-mono text-sm text-[var(--color-text)]">{count}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
