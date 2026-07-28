import type { Metadata } from "next"
import { redirect, notFound } from "next/navigation"
import { db }                 from "@/db"
import {
  purchaseOrders,
} from "@/db/schema"
import { eq } from "drizzle-orm"
import { requireAuth, can, canAny, canAccessWorksite } from "@/lib/auth/can"
import { PageHeader, Breadcrumbs } from "@/components/ui/page-header"
import { PageContainer } from "@/components/ui/page-container"
import { ReceiptForm } from "../receipt-form"
import type { ReceiptOcItem } from "../receipt-form"
import { WorkAssignmentControl } from "../../pendientes/work-assignment-control"
import { getOperationalAssignmentRecords } from "@/lib/services/operational-assignments"
import { buildOperationalWorkItem, operationalAssignmentKey } from "@/lib/services/operational-work-queue"

export const dynamic = "force-dynamic"
export const metadata: Metadata = { title: "Registrar recepción" }

export default async function NuevaRecepcionPage({
  searchParams,
}: {
  searchParams: Promise<{ oc?: string }>
}) {
  let session
  try { session = await requireAuth() }
  catch { redirect("/recepcion") }
  if (!canAny(session, "receiving:register_office", "receiving:register_faena")) redirect("/recepcion")

  const canOffice = can(session, "receiving:register_office")
  const canFaena  = can(session, "receiving:register_faena")
  const canAssignWork = session.user.permissions.includes("operations:assign_work")

  const { oc: orderId } = await searchParams
  if (!orderId) redirect("/recepcion")

  const order = await db.query.purchaseOrders.findFirst({
    where: eq(purchaseOrders.id, orderId),
    with:  {
      items: { orderBy: (i, { asc }) => [asc(i.sortOrder)] },
      worksite: true,
    },
  })

  if (!order) notFound()
  if (!canAccessWorksite(session, order.worksiteId)) notFound()
  if (!["sent", "partially_office_received", "office_received", "partially_received"].includes(order.status)) {
    redirect("/recepcion")
  }
  // Si la OC es directo_faena, la etapa oficina se deshabilita; un receptor que
  // solo tiene register_office (p. ej. prevencionista) no podría hacer nada aquí.
  const canOfficeForOrder = canOffice && order.deliveryMode !== "directo_faena"
  if (!canOfficeForOrder && !canFaena) {
    redirect("/recepcion")
  }

  const productIds = order.items
    .map((i) => i.productId)
    .filter((id): id is string => id !== null)

  const productRows = productIds.length > 0
    ? await db.query.products.findMany({
        where: (p, { inArray }) => inArray(p.id, productIds),
        columns: { id: true, sku: true, name: true, isEpp: true },
      })
    : []

  const productMap = Object.fromEntries(productRows.map((p) => [p.id, p]))

  const assignableReceiptStages = [
    ...(canOfficeForOrder && ["sent", "partially_office_received"].includes(order.status)
      ? [{ actionKey: "receive_office" as const, title: `Registrar llegada de ${order.code}`, statusLabel: "Recepción en oficina" }]
      : []),
    ...(canFaena && (order.deliveryMode === "directo_faena"
      ? ["sent", "partially_received"]
      : ["partially_office_received", "office_received", "partially_received"]
    ).includes(order.status)
      ? [{ actionKey: "receive_worksite" as const, title: `Recibir ${order.code} en faena`, statusLabel: "Pendiente de faena" }]
      : []),
  ]
  const assignmentRecords = canAssignWork && assignableReceiptStages.length > 0
    ? await getOperationalAssignmentRecords(
        assignableReceiptStages.map((stage) => ({
          sourceType: "purchase_order" as const,
          sourceId: order.id,
          actionKey: stage.actionKey,
          worksiteId: order.worksiteId,
        })),
        session,
      )
    : new Map()
  const receiptAssignmentItems = canAssignWork
    ? assignableReceiptStages.map((stage) => buildOperationalWorkItem({
        sourceType: "purchase_order",
        sourceId: order.id,
        actionKey: stage.actionKey,
        module: "recepciones",
        code: order.code,
        title: stage.title,
        subtitle: order.worksite?.name ?? "Faena de la OC",
        worksiteId: order.worksiteId,
        worksiteName: order.worksite?.name ?? "Faena de la OC",
        status: order.status,
        statusLabel: stage.statusLabel,
        priority: "normal",
        blocked: false,
        createdAt: order.sentAt ?? order.createdAt,
        sourceDueAt: order.estimatedDelivery ?? null,
        href: `/recepcion/nueva?oc=${order.id}`,
        ctaLabel: stage.actionKey === "receive_office" ? "Registrar llegada" : "Registrar recepción",
        assignable: true,
      }, assignmentRecords.get(operationalAssignmentKey("purchase_order", order.id, stage.actionKey)))
    ) : []

  const items: ReceiptOcItem[] = order.items.map((item) => {
    const product = item.productId ? productMap[item.productId] : null
    return {
      id:               item.id,
      requestItemId:    item.requestItemId,
      productName:      product?.name ?? item.productNameFree ?? "(sin nombre)",
      productSku:       product?.sku ?? null,
      isEpp:            product?.isEpp ?? false,
      quantity:         item.quantity,
      quantityOfficeReceived: item.quantityOfficeReceived ?? 0,
      quantityReceived: item.quantityReceived ?? 0,
      unitOfMeasure:    item.unitOfMeasure,
      notes:            item.notes,
    }
  })

  return (
    <PageContainer width="workbench">
      <PageHeader
        title={`Recepción OC ${order.code}`}
        description={order.deliveryMode === "directo_faena"
          ? "Los productos se reciben directamente en faena; no requieren paso por oficina."
          : "Registra primero la llegada a oficina Chome y luego la recepción en faena."}
        breadcrumb={
          <Breadcrumbs items={[
            { label: "Dashboard",  href: "/dashboard" },
            { label: "Recepción",  href: "/recepcion" },
            { label: "Registrar"                       },
          ]} />
        }
      />
      <ReceiptForm
        purchaseOrderId={order.id}
        orderCode={order.code}
        orderWorksiteName={order.worksite?.name ?? "faena de la OC"}
        items={items}
        canOffice={canOfficeForOrder}
        canFaena={canFaena}
        deliveryMode={order.deliveryMode as "via_oficina" | "directo_faena"}
      />
      {receiptAssignmentItems.length > 0 && (
        <section className="mt-5 border-t border-[var(--color-border)] pt-4" aria-labelledby="receipt-assignment-title">
          <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 id="receipt-assignment-title" className="text-base font-semibold text-[var(--color-text)]">Responsables de la recepción</h2>
              <p className="text-sm text-[var(--color-text-muted)]">La asignación complementa la etapa seleccionada y no altera el estado de la orden.</p>
            </div>
          </div>
          <div className="mt-3 divide-y divide-[var(--color-border)] rounded-[var(--radius-lg)] border border-[var(--color-border)]">
            {receiptAssignmentItems.map((item) => (
              <div key={item.id} className="flex flex-col gap-2 px-3 py-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-[var(--color-text)]">{item.statusLabel}</p>
                  <p className="text-xs text-[var(--color-text-muted)]">{item.sourceDueAt ? `Fecha estimada de entrega: ${item.sourceDueAt.slice(0, 10)}` : "Sin fecha nativa de vencimiento"}</p>
                </div>
                <WorkAssignmentControl item={item} showAssignee />
              </div>
            ))}
          </div>
        </section>
      )}
    </PageContainer>
  )
}
