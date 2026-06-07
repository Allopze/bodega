import type { Metadata } from "next"
import { redirect, notFound } from "next/navigation"
import { db }                 from "@/db"
import {
  purchaseOrders, warehouses,
} from "@/db/schema"
import { eq, asc } from "drizzle-orm"
import { requirePermission } from "@/lib/auth/can"
import { canAccessWorksite }  from "@/lib/auth/can"
import { PageHeader, Breadcrumbs } from "@/components/ui/page-header"
import { ReceiptForm } from "../receipt-form"
import type { ReceiptOcItem, WarehouseOption } from "../receipt-form"

export const dynamic = "force-dynamic"
export const metadata: Metadata = { title: "Registrar recepción" }

export default async function NuevaRecepcionPage({
  searchParams,
}: {
  searchParams: Promise<{ oc?: string }>
}) {
  let session
  try { session = await requirePermission("receiving:register") }
  catch { redirect("/recepcion") }

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
  if (!["sent", "partially_received"].includes(order.status)) {
    redirect("/recepcion")
  }

  const productIds = order.items
    .map((i) => i.productId)
    .filter((id): id is string => id !== null)

  const [productRows, allWarehouses] = await Promise.all([
    productIds.length > 0
      ? db.query.products.findMany({
          where: (p, { inArray }) => inArray(p.id, productIds),
          columns: { id: true, sku: true, name: true },
        })
      : Promise.resolve([]),

    db
      .select({ id: warehouses.id, name: warehouses.name })
      .from(warehouses)
      .where(eq(warehouses.isActive, true))
      .orderBy(asc(warehouses.name)),

  ])

  const productMap = Object.fromEntries(productRows.map((p) => [p.id, p]))

  const items: ReceiptOcItem[] = order.items.map((item) => {
    const product = item.productId ? productMap[item.productId] : null
    return {
      id:               item.id,
      requestItemId:    item.requestItemId,
      productName:      product?.name ?? item.productNameFree ?? "(sin nombre)",
      productSku:       product?.sku ?? null,
      quantity:         item.quantity,
      quantityReceived: item.quantityReceived ?? 0,
      unitOfMeasure:    item.unitOfMeasure,
      notes:            item.notes,
    }
  })

  const warehouseOptions: WarehouseOption[] = allWarehouses.map((w) => ({ id: w.id, name: w.name }))

  return (
    <>
      <PageHeader
        title={`Recepción OC ${order.code}`}
        description="Registra las cantidades recibidas y el destino de los ítems."
        breadcrumb={
          <Breadcrumbs items={[
            { label: "Dashboard",  href: "/dashboard" },
            { label: "Recepción",  href: "/recepcion" },
            { label: "Registrar"                       },
          ]} />
        }
      />
      <div className="max-w-3xl">
        <ReceiptForm
          purchaseOrderId={order.id}
          orderCode={order.code}
          orderWorksiteName={order.worksite?.name ?? "faena de la OC"}
          items={items}
          warehouses={warehouseOptions}
        />
      </div>
    </>
  )
}
