import type { Metadata } from "next"
import { notFound, redirect } from "next/navigation"
import { db }                  from "@/db"
import { purchaseOrderInvoices, purchaseOrders, statusHistory, users } from "@/db/schema"
import { and, desc, eq } from "drizzle-orm"
import { requirePermission, can } from "@/lib/auth/can"
import { canAccessWorksite }  from "@/lib/auth/can"
import { PageHeader, Breadcrumbs } from "@/components/ui/page-header"
import { PageContainer } from "@/components/ui/page-container"
import { StateBadge } from "@/components/states/state-badge"
import { OcActions } from "./oc-actions"
import { InvoicesSection } from "./invoices-section"
import { formatCLP, formatDate } from "@/lib/utils"
import { EntityTimeline } from "@/components/states/entity-timeline"
import { Button } from "@/components/ui/button"
import { OcReceptionCta } from "./oc-reception-cta"
import { OcDetailItems } from "./oc-detail-items"
import { DetailLine, AmountLine } from "./oc-detail-page.helpers"
import { getOcReconciliation } from "@/lib/services/oc-reconciliation"

export const metadata: Metadata = { title: "Orden de compra" }

export default async function OcDetailPage({ params }: { params: Promise<{ id: string }> }) {
  let session
  try { session = await requirePermission("purchasing:view") }
  catch { redirect("/forbidden") }

  const { id } = await params

  const order = await db.query.purchaseOrders.findFirst({
    where: eq(purchaseOrders.id, id),
    with: {
      items:    { orderBy: (i, { asc }) => [asc(i.sortOrder)] },
      worksite: true,
      supplier: true,
    },
  })

  if (!order) notFound()
  if (!canAccessWorksite(session, order.worksiteId)) notFound()

  // Load linked request items + request codes for traceability
  const requestItemIds = order.items
    .map((i) => i.requestItemId)
    .filter((id): id is string => id !== null)

  const productIds = order.items
    .map((i) => i.productId)
    .filter((id): id is string => id !== null)

  const [requestItemRows, productRows, timelineEvents, orderInvoices] = await Promise.all([
    requestItemIds.length > 0
      ? db.query.purchaseRequestItems.findMany({
          where: (ri, { inArray }) => inArray(ri.id, requestItemIds),
          with: { request: true },
        })
      : Promise.resolve([]),

    productIds.length > 0
      ? db.query.products.findMany({
          where: (p, { inArray }) => inArray(p.id, productIds),
          columns: { id: true, sku: true, name: true },
        })
      : Promise.resolve([]),

    db
      .select({
        id:          statusHistory.id,
        fromStatus:  statusHistory.fromStatus,
        toStatus:    statusHistory.toStatus,
        changedBy:   statusHistory.changedBy,
        changedAt:   statusHistory.changedAt,
        reason:      statusHistory.reason,
        userName:    users.name,
        userEmail:   users.email,
      })
      .from(statusHistory)
      .leftJoin(users, eq(statusHistory.changedBy, users.id))
      .where(
        and(
          eq(statusHistory.entityType, "purchase_order"),
          eq(statusHistory.entityId, order.id),
        ),
      )
      .orderBy(desc(statusHistory.changedAt)),

    db
      .select({
        id:            purchaseOrderInvoices.id,
        invoiceNumber: purchaseOrderInvoices.invoiceNumber,
        amount:        purchaseOrderInvoices.amount,
        issueDate:     purchaseOrderInvoices.issueDate,
        fileName:      purchaseOrderInvoices.fileName,
        mimeType:      purchaseOrderInvoices.mimeType,
        uploadedAt:    purchaseOrderInvoices.uploadedAt,
      })
      .from(purchaseOrderInvoices)
      .where(eq(purchaseOrderInvoices.purchaseOrderId, order.id))
      .orderBy(desc(purchaseOrderInvoices.uploadedAt)),
  ])

  // Load invoice items for reconciliation
  const invoiceIds = orderInvoices.map((inv) => inv.id)
  const invoiceItemRows = invoiceIds.length > 0
    ? await db.query.purchaseOrderInvoiceItems.findMany({
        where: (t, { inArray }) => inArray(t.invoiceId, invoiceIds),
      })
    : []

  // Attach items to invoices
  const invoicesWithItems = orderInvoices.map((inv) => ({
    ...inv,
    items: invoiceItemRows.filter((item) => item.invoiceId === inv.id),
  }))

  // Build maps
  const reqItemMap = Object.fromEntries(requestItemRows.map((ri) => [ri.id, ri]))
  const productMap = Object.fromEntries(productRows.map((p) => [p.id, p]))

  const canManage      = session.user.permissions.includes("purchasing:create_order")
  const canSend        = session.user.permissions.includes("purchasing:send_order")
  const canDeleteOrder = can(session, "purchasing:delete_order")
  const canInvoice     = canSend   // purchasing:send_order gate for invoice management
  const canRegisterFaenaReception = session.user.permissions.includes("receiving:register_faena")
  const pendingFaenaQuantity = order.items.reduce(
    (total, item) => total + Math.max(0, (item.quantityOfficeReceived ?? 0) - (item.quantityReceived ?? 0)),
    0,
  )
  const canShowOrderActions =
    (order.status === "draft" && (canManage || canDeleteOrder)) ||
    (order.status === "issued" && (canManage || canSend || canDeleteOrder)) ||
    (order.status === "sent" && (canManage || canDeleteOrder)) ||
    (order.status === "supplier_confirmed" && canManage) ||
    (order.status === "partially_received" && canManage) ||
    (order.status === "received" && canManage)

  const orderItemIds = order.items.map((i) => i.id)
  const { totalReceived } = await getOcReconciliation(order.id, orderItemIds)

  // Calculate invoice reconciliation warnings for the close form
  const hasLineItems = invoiceItemRows.length > 0
  const closeWarnings: string[] = []
  if (!["draft", "cancelled"].includes(order.status)) {
    if (orderInvoices.length === 0) {
      closeWarnings.push("No hay facturas adjuntadas a esta orden.")
    } else if (!hasLineItems) {
      closeWarnings.push("Las facturas no tienen ítems detallados.")
    } else {
      // Check per-item reconciliation
      const invoicedQtyMap = new Map<string, number>()
      for (const item of invoiceItemRows) {
        if (item.purchaseOrderItemId) {
          const current = invoicedQtyMap.get(item.purchaseOrderItemId) ?? 0
          invoicedQtyMap.set(item.purchaseOrderItemId, current + item.quantity)
        }
      }
      for (const ocItem of order.items) {
        const invoicedQty = invoicedQtyMap.get(ocItem.id) ?? 0
        if (invoicedQty === 0) {
          const name = ocItem.productNameFree ?? (ocItem.productId ? productMap[ocItem.productId]?.name : null) ?? "Ítem"
          closeWarnings.push(`"${name}" sin factura asociada.`)
        } else if (Math.abs(ocItem.quantity - invoicedQty) > 0.01) {
          const name = ocItem.productNameFree ?? (ocItem.productId ? productMap[ocItem.productId]?.name : null) ?? "Ítem"
          closeWarnings.push(`"${name}": cant. OC (${ocItem.quantity}) ≠ cant. facturada (${invoicedQty}).`)
        }
      }
      if (Math.abs(orderInvoices.reduce((s, i) => s + (i.amount ?? 0), 0) - order.totalAmount) > 1) {
        closeWarnings.push("Total facturado difiere del total OC.")
      }
    }
  }

  return (
    <PageContainer width="workbench">
      <PageHeader
        title={order.code}
        description={`${order.worksite?.name ?? "—"} · ${order.supplier?.name ?? "—"}`}
        breadcrumb={
          <Breadcrumbs items={[
            { label: "Dashboard", href: "/dashboard" },
            { label: "Órdenes de compra", href: "/compras" },
            { label: order.code                       },
          ]} />
        }
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px] lg:items-start">
        <div className="min-w-0 flex flex-col gap-6">
        <OcDetailItems
          order={{
            code: order.code,
            status: order.status,
            netAmount: order.netAmount,
            taxAmount: order.taxAmount,
            totalAmount: order.totalAmount,
            paymentTerms: order.paymentTerms,
            estimatedDelivery: order.estimatedDelivery,
            notes: order.notes,
            items: order.items.map((i) => ({
              id: i.id,
              requestItemId: i.requestItemId,
              productId: i.productId,
              productNameFree: i.productNameFree,
              quantity: i.quantity,
              unitOfMeasure: i.unitOfMeasure,
              unitPrice: i.unitPrice,
              subtotal: i.subtotal,
              notes: i.notes,
            })),
            worksite: order.worksite ? { name: order.worksite.name } : null,
            supplier: order.supplier ? { name: order.supplier.name } : null,
          }}
          reqItemMap={reqItemMap as unknown as Record<string, { request: { code: string } }>}
          productMap={productMap as unknown as Record<string, { name: string; sku: string | null }>}
        />

        {/* Notes */}
        {order.notes && (
          <div className="p-4 rounded-[var(--radius-xl)] bg-[var(--color-surface-2)]">
            <p className="text-xs text-[var(--color-text-subtle)] mb-1">Notas</p>
            <p className="text-sm text-[var(--color-text-muted)]">{order.notes}</p>
          </div>
        )}
        </div>

        <aside className="space-y-6 lg:sticky lg:top-6">
          <section className="rounded-[var(--radius-2xl)] bg-[var(--color-surface)] shadow-[var(--shadow-card)] p-4">
            <div className="flex items-center justify-between gap-3">
              <StateBadge state={order.status} entity="oc" />
              <Button asChild variant="secondary" size="sm">
                <a
                  href={`/compras/${order.id}/print`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Imprimir / PDF
                </a>
              </Button>
            </div>

            <dl className="mt-4 divide-y divide-[var(--color-border)]">
              <DetailLine label="Proveedor" value={order.supplier?.name ?? "—"} />
              <DetailLine label="Faena" value={order.worksite?.name ?? "—"} />
              <DetailLine label="Condición de pago" value={order.paymentTerms ?? "—"} />
              <DetailLine label="Entrega estimada" value={order.estimatedDelivery ? formatDate(order.estimatedDelivery) : "—"} />
            </dl>
            <OcReceptionCta
              orderId={order.id}
              pendingFaenaQuantity={pendingFaenaQuantity}
              worksiteName={order.worksite?.name ?? "la faena"}
              canRegisterFaena={canRegisterFaenaReception}
            />
          </section>

          <section className="rounded-[var(--radius-2xl)] bg-[var(--color-surface)] shadow-[var(--shadow-card)] p-4">
            <h2 className="text-sm font-semibold text-[var(--color-text)]">Totales</h2>
            <dl className="mt-3 space-y-2 text-sm">
              <AmountLine label="Neto" value={formatCLP(order.netAmount)} />
              <AmountLine label="IVA (19%)" value={formatCLP(order.taxAmount)} muted />
              <div className="flex items-center justify-between gap-3 border-t border-[var(--color-border)] pt-3">
                <dt className="font-semibold text-[var(--color-text)]">Total</dt>
                <dd className="font-mono font-bold tabular-nums text-[var(--color-text)]">{formatCLP(order.totalAmount)}</dd>
              </div>
            </dl>
          </section>

          {canShowOrderActions && (
            <section className="rounded-[var(--radius-2xl)] bg-[var(--color-surface)] shadow-[var(--shadow-card)] p-4">
              <h2 className="mb-3 text-sm font-semibold text-[var(--color-text)]">Acciones</h2>
              <OcActions
                orderId={order.id}
                orderCode={order.code}
                status={order.status}
                canManage={canManage}
                canSend={canSend}
                canDelete={canDeleteOrder}
                closeWarnings={closeWarnings}
              />
            </section>
          )}

          {!["draft", "cancelled"].includes(order.status) && (
            <InvoicesSection
              purchaseOrderId={order.id}
              invoices={invoicesWithItems as unknown as React.ComponentProps<typeof InvoicesSection>["invoices"]}
              ocItems={order.items.map((i) => ({
                id: i.id,
                productName: i.productNameFree ?? (i.productId ? productMap[i.productId]?.name : null) ?? i.id,
                quantity: i.quantity,
                unitPrice: i.unitPrice,
                subtotal: i.subtotal,
              }))}
              totalAmount={order.totalAmount}
              canManage={canInvoice}
            />
          )}

          {order.items.some((item) => (item.quantityOfficeReceived ?? 0) > 0 || (item.quantityReceived ?? 0) > 0) && (
            <section className="rounded-[var(--radius-2xl)] bg-[var(--color-surface)] shadow-[var(--shadow-card)] p-4">
              <h2 className="text-sm font-semibold text-[var(--color-text)] mb-2">Conciliación OC-factura-recepción</h2>
              <div className="rounded-[var(--radius-lg)] bg-[var(--color-surface-2)] px-3 py-2 text-xs text-[var(--color-text-muted)]">
                <div className="flex justify-between gap-2">
                  <span>Cantidad total pedida</span>
                  <span className="font-mono tabular-nums">{order.items.reduce((sum, i) => sum + i.quantity, 0)}</span>
                </div>
                <div className="flex justify-between gap-2 mt-1 pt-1 border-t border-[var(--color-border)]">
                  <span>Cantidad recibida en faena</span>
                  <span className="font-mono tabular-nums">{totalReceived}</span>
                </div>
                <div className="flex justify-between gap-2 mt-1 pt-1 border-t border-[var(--color-border)]">
                  <span>Facturas adjuntadas</span>
                  <span className="font-mono tabular-nums">{orderInvoices.length}</span>
                </div>
                <div className="flex justify-between gap-2 mt-1 pt-1 border-t border-[var(--color-border)]">
                  <span>Total facturado</span>
                  <span className="font-mono tabular-nums">{formatCLP(orderInvoices.reduce((sum, inv) => sum + (inv.amount ?? 0), 0))}</span>
                </div>
              </div>
            </section>
          )}

          <EntityTimeline entityType="oc" events={timelineEvents} />
        </aside>
      </div>
    </PageContainer>
  )
}

