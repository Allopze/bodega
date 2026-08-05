import type { Metadata } from "next"
import { notFound, redirect } from "next/navigation"
import Link from "next/link"
import { requirePermission } from "@/lib/auth/can"
import { getItemDetail } from "@/lib/services/trazabilidad-item"
import { PageHeader, Breadcrumbs } from "@/components/ui/page-header"
import { PageContainer } from "@/components/ui/page-container"
import { StateBadge } from "@/components/states/state-badge"
import { EntityTimeline } from "@/components/states/entity-timeline"
import { formatQty } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { ArrowSquareOut } from "@phosphor-icons/react/dist/ssr"
import { ItemSummaryCard } from "./trazabilidad-item-summary-card"
import {
  ApprovalsTable,
  OcItemsTable,
  ReceiptsTable,
  DeliveriesTable,
  InventoryMovementsTable,
} from "./trazabilidad-item-tables"

export const metadata: Metadata = { title: "Detalle de ítem — Trazabilidad" }

export default async function TrazabilidadItemPage({
  params,
}: {
  params: Promise<{ itemId: string }>
}) {
  let session
  try { session = await requirePermission("traceability:view") }
  catch { redirect(`/forbidden?desde=${encodeURIComponent("/trazabilidad")}`) }

  const { itemId } = await params
  const detail = await getItemDetail(session, itemId)
  if (!detail) notFound()

  const { item, approvals, ocItems, receipts, deliveries, timeline, inventoryMovements } = detail
  const totalReceivedAtFaena = ocItems.reduce((sum, oi) => sum + oi.receivedAtFaena, 0)
  const totalOrdered = ocItems.reduce((sum, oi) => sum + oi.quantity, 0)
  const totalDelivered = deliveries.reduce((sum, d) => sum + d.quantity, 0)
  const totalReturned = deliveries.reduce((sum, d) => sum + (d.returnQuantity ?? 0), 0)

  return (
    <PageContainer width="workbench">
      <PageHeader
        title={item.productName}
        description={
          item.productSku
            ? `SKU ${item.productSku} · ${item.worksiteName}`
            : item.worksiteName
        }
        actions={
          <div className="flex items-center gap-2">
            <StateBadge state={item.status} entity="item" />
            <Link href={`/solicitudes/${item.requestId}`}>
              <Button variant="secondary" size="sm">
                <ArrowSquareOut size={14} className="mr-1" />
                Ver solicitud
              </Button>
            </Link>
          </div>
        }
        breadcrumb={
          <Breadcrumbs items={[
            { label: "Inicio", href: "/dashboard" },
            { label: "Trazabilidad", href: "/trazabilidad" },
            { label: item.productName },
          ]} />
        }
      />

      <div className="space-y-6">
        {/* ── Item summary card ──────────────────────────────────── */}
        <ItemSummaryCard
          item={item}
          totalOrdered={totalOrdered}
          totalReceivedAtFaena={totalReceivedAtFaena}
          totalDelivered={totalDelivered}
          totalReturned={totalReturned}
        />

        {/* ── Quantity flow visualization ───────────────────────── */}
        <section className="rounded-[var(--radius-2xl)] bg-[var(--color-surface)] shadow-[var(--shadow-card)] border border-[var(--color-border)] p-6">
          <h2 className="text-h2 text-[var(--color-text)] mb-4">Flujo de cantidades</h2>
          <div className="flex items-center gap-3 text-sm">
            {[
              { label: "Solicitado", value: item.quantity },
              { label: "En OC", value: totalOrdered },
              { label: "Recibido", value: totalReceivedAtFaena },
              { label: "Entregado", value: totalDelivered },
            ].map((step, i) => (
              <div key={step.label} className="flex items-center gap-3">
                {i > 0 && <span className="text-[var(--color-border-strong)]" aria-hidden>→</span>}
                <div className="text-center">
                  <p className="font-mono text-lg font-semibold tabular-nums text-[var(--color-text)]">
                    {formatQty(step.value, item.unitOfMeasure)}
                  </p>
                  <p className="text-xs text-[var(--color-text-subtle)]">{step.label}</p>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* ── Approval decisions ────────────────────────────────── */}
        <ApprovalsTable approvals={approvals} item={item} />

        {/* ── Purchase orders ───────────────────────────────────── */}
        <OcItemsTable ocItems={ocItems} item={item} />

        {/* ── Receipts ──────────────────────────────────────────── */}
        <ReceiptsTable receipts={receipts} item={item} />

        {/* ── Deliveries ────────────────────────────────────────── */}
        <DeliveriesTable deliveries={deliveries} item={item} />

        {/* ── Inventory Movements ───────────────────────────────── */}
        <InventoryMovementsTable movements={inventoryMovements} item={item} />

        {/* ── Status history timeline ───────────────────────────── */}
        <EntityTimeline entityType="item" events={timeline} />
      </div>
    </PageContainer>
  )
}
