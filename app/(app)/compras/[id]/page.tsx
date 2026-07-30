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
import { RequestProgressPanel } from "@/components/states/request-progress-panel"
import { buildOcProgress } from "@/lib/work-queue"
import { OcActions } from "./oc-actions"
import { InvoicesSection } from "./invoices-section"
import { OcDetailTabs } from "./oc-detail-tabs"
import { OcProgressTable } from "./oc-progress-table"
import { formatCLP, formatDate } from "@/lib/utils"
import { EntityTimeline } from "@/components/states/entity-timeline"
import { Button } from "@/components/ui/button"
import { OcReceptionCta } from "./oc-reception-cta"
import { OcDetailItems } from "./oc-detail-items"
import { DetailLine, AmountLine } from "./oc-detail-page.helpers"
import { getOcReconciliation } from "@/lib/services/oc-reconciliation"


export const metadata: Metadata = { title: "Orden de compra" }

export default async function OcDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ tab?: string }>
}) {
  let session
  try { session = await requirePermission("purchasing:view") }
  catch { redirect("/forbidden") }

  const [{ id }, { tab }] = await Promise.all([params, searchParams])

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

  // Cantidad facturada por ítem de OC (reutilizado por close-warnings y tabla de avance)
  const invoicedByItem = new Map<string, number>()
  for (const item of invoiceItemRows) {
    if (item.purchaseOrderItemId) {
      invoicedByItem.set(item.purchaseOrderItemId, (invoicedByItem.get(item.purchaseOrderItemId) ?? 0) + item.quantity)
    }
  }

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
  const { receivedByItem } = await getOcReconciliation(order.id, orderItemIds)

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
      for (const ocItem of order.items) {
        const invoicedQty = invoicedByItem.get(ocItem.id) ?? 0
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

  // Stepper de ciclo (reutiliza el panel de solicitudes)
  const progress = buildOcProgress(
    order.status,
    order.items.map((i) => ({
      id:               i.id,
      productName:      i.productNameFree ?? (i.productId ? productMap[i.productId]?.name : null) ?? "Ítem",
      quantity:         i.quantity,
      unitOfMeasure:    i.unitOfMeasure,
      quantityReceived: receivedByItem.get(i.id) ?? i.quantityReceived ?? 0,
    })),
  )

  // Filas de la tabla de avance (pedido / recibido / facturado por ítem)
  const progressRows = order.items.map((i) => ({
    id:            i.id,
    productName:   i.productNameFree ?? (i.productId ? productMap[i.productId]?.name : null) ?? "Ítem",
    unitOfMeasure: i.unitOfMeasure,
    ordered:       i.quantity,
    received:      receivedByItem.get(i.id) ?? i.quantityReceived ?? 0,
    invoiced:      invoicedByItem.get(i.id) ?? 0,
  }))

  const showInvoicing = !["draft", "cancelled"].includes(order.status)

  // Pestaña inicial desde ?tab= (validada contra las disponibles) para deep-link
  const availableTabs = ["items", ...(showInvoicing ? ["facturacion", "avance"] : []), "historial"]
  const initialTab = tab && availableTabs.includes(tab) ? tab : "items"

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

      {progress && (
        <div className="mb-6">
          <RequestProgressPanel progress={progress} />
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px] lg:items-start">
        <div className="min-w-0">
          <OcDetailTabs
            defaultTab={initialTab}
            itemsCount={order.items.length}
            invoicesCount={orderInvoices.length}
            historyCount={timelineEvents.length}
            items={
              <div className="flex flex-col gap-6">
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
                {order.notes && (
                  <div className="p-4 rounded-(--radius-xl) bg-(--color-surface-2)">
                    <p className="text-xs text-text-subtle mb-1">Notas</p>
                    <p className="text-sm text-(--color-text-muted)">{order.notes}</p>
                  </div>
                )}
              </div>
            }
            facturacion={showInvoicing ? (
              <InvoicesSection
                purchaseOrderId={order.id}
                invoices={invoicesWithItems as unknown as React.ComponentProps<typeof InvoicesSection>["invoices"]}
                ocItems={order.items.map((i) => ({
                  id: i.id,
                  productName: i.productNameFree ?? (i.productId ? productMap[i.productId]?.name : null) ?? i.id,
                  productCode: i.productId ? productMap[i.productId]?.sku ?? null : null,
                  unitOfMeasure: i.unitOfMeasure,
                  quantity: i.quantity,
                  unitPrice: i.unitPrice,
                  subtotal: i.subtotal,
                }))}
                totalAmount={order.totalAmount}
                canManage={canInvoice}
              />
            ) : undefined}
            avance={showInvoicing ? <OcProgressTable rows={progressRows} /> : undefined}
            historial={<EntityTimeline entityType="oc" events={timelineEvents} />}
          />
        </div>

        <aside className="space-y-6 lg:sticky lg:top-6">
          <section className="rounded-(--radius-2xl) bg-(--color-surface) shadow-(--shadow-card) p-4">
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

            <dl className="mt-4 divide-y divide-(--color-border)">
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

          <section className="rounded-(--radius-2xl) bg-(--color-surface) shadow-(--shadow-card) p-4">
            <h2 className="text-sm font-semibold text-(--color-text)">Totales</h2>
            <dl className="mt-3 space-y-2 text-sm">
              <AmountLine label="Neto" value={formatCLP(order.netAmount)} />
              <AmountLine label="IVA (19%)" value={formatCLP(order.taxAmount)} muted />
              <div className="flex items-center justify-between gap-3 border-t border-(--color-border) pt-3">
                <dt className="font-semibold text-(--color-text)">Total</dt>
                <dd className="font-mono font-bold tabular-nums text-(--color-text)">{formatCLP(order.totalAmount)}</dd>
              </div>
            </dl>
          </section>

          {canShowOrderActions && (
            <section className="rounded-(--radius-2xl) bg-(--color-surface) shadow-(--shadow-card) p-4">
              <h2 className="mb-3 text-sm font-semibold text-(--color-text)">Acciones</h2>
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
        </aside>
      </div>
    </PageContainer>
  )
}
