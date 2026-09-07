import { getProductAttributesByIds, getRequestItemAttributesByIds } from "@/lib/services/product-sizes"
import { formatVariantProductName } from "@/lib/products/variant-grouping"
import type { Metadata } from "next"
import { redirect, notFound } from "next/navigation"
import { db }                 from "@/db"
import {
  purchaseOrders,
  purchaseRequestItems,
  preventionEmergencyResources,
} from "@/db/schema"
import { eq, inArray } from "drizzle-orm"
import { requireAuth, can, canAny, canAccessWorksite } from "@/lib/auth/can"
import { PageHeader, Breadcrumbs } from "@/components/ui/page-header"
import { PageContainer } from "@/components/ui/page-container"
import { ReceiptForm } from "../receipt-form"
import type { ReceiptOcItem } from "../receipt-form"
import { officeWorksiteLabel } from "@/lib/services/dispatch-guides"
import {
  RECEIVABLE_ORDER_STATUSES,
} from "@/lib/work-queue"

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
  if (!RECEIVABLE_ORDER_STATUSES.includes(order.status)) {
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
        columns: { id: true, sku: true, name: true, serviceSubjectKind: true },
      })
    : []

  const attributesById = await getProductAttributesByIds(productIds)
  const productMap = Object.fromEntries(productRows.map((p) => [p.id, { ...p, name: formatVariantProductName(p.name, attributesById.get(p.id)) }]))
  const requestItemIds = order.items.flatMap((item) => item.requestItemId ? [item.requestItemId] : [])
  const emergencySubjectRows = requestItemIds.length > 0
    ? await db.select({
      requestItemId: purchaseRequestItems.id,
      assetCode: preventionEmergencyResources.assetCode,
      name: preventionEmergencyResources.name,
    }).from(purchaseRequestItems)
      .innerJoin(preventionEmergencyResources, eq(purchaseRequestItems.emergencyResourceId, preventionEmergencyResources.id))
      .where(inArray(purchaseRequestItems.id, requestItemIds))
    : []
  const emergencySubjectMap = new Map(emergencySubjectRows.map((row) => [
    row.requestItemId,
    row.assetCode ? `${row.assetCode} · ${row.name}` : row.name,
  ]))
  const recordedById = await getRequestItemAttributesByIds(requestItemIds)
  const officeName = await officeWorksiteLabel()

  const items: ReceiptOcItem[] = order.items.map((item) => {
    const product = item.productId ? productMap[item.productId] : null
    return {
      id:               item.id,
      requestItemId:    item.requestItemId,
      productName:      formatVariantProductName(productRows.find((p) => p.id === item.productId)?.name ?? item.productNameFree ?? "(sin nombre)", item.productId ? attributesById.get(item.productId) : [], item.requestItemId ? recordedById.get(item.requestItemId) : []),
      productSku:       product?.sku ?? null,
      quantity:         item.quantity,
      quantityOfficeReceived: item.quantityOfficeReceived ?? 0,
      quantityReceived: item.quantityReceived ?? 0,
      unitOfMeasure:    item.unitOfMeasure,
      notes:            item.notes,
      isEmergencyService: product?.serviceSubjectKind === "emergency_resource",
      emergencyResourceLabel: item.requestItemId ? (emergencySubjectMap.get(item.requestItemId) ?? null) : null,
    }
  })

  return (
    <PageContainer width="workbench">
      <PageHeader
        title={`Recepción ${order.code}`}
        description={order.deliveryMode === "directo_faena"
          ? "Los productos se reciben directamente en faena; no requieren paso por oficina."
          : `Registra primero la llegada a ${officeName} y luego la recepción en faena.`}
        breadcrumb={
          <Breadcrumbs items={[
            { label: "Inicio",  href: "/dashboard" },
            { label: "Recepción",  href: "/recepcion" },
            { label: "Registrar"                       },
          ]} />
        }
      />
      <ReceiptForm
        purchaseOrderId={order.id}
        orderCode={order.code}
        orderWorksiteName={order.worksite?.name ?? "faena de la OC"}
        officeName={officeName}
        items={items}
        canOffice={canOfficeForOrder}
        canFaena={canFaena}
        deliveryMode={order.deliveryMode as "via_oficina" | "directo_faena"}
      />
    </PageContainer>
  )
}
