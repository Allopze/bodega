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
  if (!["sent", "partially_office_received", "office_received", "partially_received"].includes(order.status)) {
    redirect("/recepcion")
  }

  const productIds = order.items
    .map((i) => i.productId)
    .filter((id): id is string => id !== null)

  const productRows = productIds.length > 0
    ? await db.query.products.findMany({
        where: (p, { inArray }) => inArray(p.id, productIds),
        columns: { id: true, sku: true, name: true },
      })
    : []

  const productMap = Object.fromEntries(productRows.map((p) => [p.id, p]))

  const items: ReceiptOcItem[] = order.items.map((item) => {
    const product = item.productId ? productMap[item.productId] : null
    return {
      id:               item.id,
      requestItemId:    item.requestItemId,
      productName:      product?.name ?? item.productNameFree ?? "(sin nombre)",
      productSku:       product?.sku ?? null,
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
        description="Registra primero la llegada a oficina Chome y luego la recepción en faena."
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
        canOffice={canOffice}
        canFaena={canFaena}
      />
    </PageContainer>
  )
}
