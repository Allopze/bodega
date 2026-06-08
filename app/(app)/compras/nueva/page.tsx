import type { Metadata } from "next"
import { redirect }      from "next/navigation"
import { db }            from "@/db"
import {
  purchaseRequestItems, purchaseRequests,
  worksites, suppliers, products, productSuppliers,
} from "@/db/schema"
import { eq, inArray, asc } from "drizzle-orm"
import { requirePermission } from "@/lib/auth/can"
import { canAccessWorksite }  from "@/lib/auth/can"
import { PageHeader, Breadcrumbs } from "@/components/ui/page-header"
import { OcForm } from "../oc-form"
import type { PendingItemOption, SupplierOption, WorksiteOption } from "../oc-form"

export const metadata: Metadata = { title: "Nueva orden de compra" }

export default async function NuevaOcPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  let session
  try { session = await requirePermission("purchasing:create_order") }
  catch { redirect("/compras") }
  const sp = await searchParams
  const requestedWorksiteId = typeof sp.faena === "string" ? sp.faena : ""

  // Load approved/pending_purchase items
  const rawItems = await db
    .select({
      id:              purchaseRequestItems.id,
      requestId:       purchaseRequestItems.requestId,
      productId:       purchaseRequestItems.productId,
      productNameFree: purchaseRequestItems.productNameFree,
      quantity:        purchaseRequestItems.quantity,
      unitOfMeasure:   purchaseRequestItems.unitOfMeasure,
      urgency:         purchaseRequestItems.urgency,
      notes:           purchaseRequestItems.notes,
      status:          purchaseRequestItems.status,
    })
    .from(purchaseRequestItems)
    .where(inArray(purchaseRequestItems.status, ["approved", "pending_purchase"]))
    .orderBy(asc(purchaseRequestItems.requestId))

  if (rawItems.length === 0) {
    redirect("/compras")
  }

  const requestIds = [...new Set(rawItems.map((i) => i.requestId))]
  const productIds = [...new Set(rawItems.map((i) => i.productId).filter(Boolean))] as string[]

  const [requestRows, productRows, supplierPriceRows, allSuppliers, allWorksites] = await Promise.all([
    db
      .select({ id: purchaseRequests.id, code: purchaseRequests.code, worksiteId: purchaseRequests.worksiteId })
      .from(purchaseRequests)
      .where(inArray(purchaseRequests.id, requestIds)),

    productIds.length > 0
      ? db
          .select({ id: products.id, sku: products.sku, name: products.name })
          .from(products)
          .where(inArray(products.id, productIds))
      : Promise.resolve([]),

    productIds.length > 0
      ? db
          .select({
            productId: productSuppliers.productId,
            supplierId: productSuppliers.supplierId,
            unitPrice: productSuppliers.unitPrice,
          })
          .from(productSuppliers)
          .where(inArray(productSuppliers.productId, productIds))
      : Promise.resolve([]),

    db
      .select({ id: suppliers.id, name: suppliers.name, paymentTerms: suppliers.paymentTerms })
      .from(suppliers)
      .where(eq(suppliers.isActive, true))
      .orderBy(asc(suppliers.name)),

    db
      .select({ id: worksites.id, name: worksites.name })
      .from(worksites)
      .where(eq(worksites.isActive, true))
      .orderBy(asc(worksites.name)),
  ])

  const reqMap     = Object.fromEntries(requestRows.map((r) => [r.id, r]))
  const productMap = Object.fromEntries(productRows.map((p) => [p.id, p]))
  const wsMap      = Object.fromEntries(allWorksites.map((w) => [w.id, w.name]))
  const supplierPriceMap = supplierPriceRows.reduce<Record<string, Record<string, number>>>((acc, row) => {
    if (row.unitPrice === null) return acc
    acc[row.productId] ??= {}
    acc[row.productId][row.supplierId] = row.unitPrice
    return acc
  }, {})

  // Scope worksites
  const scopedWs = allWorksites.filter((w) => canAccessWorksite(session, w.id))

  const pendingItems: PendingItemOption[] = rawItems
    .map((item) => {
      const req     = reqMap[item.requestId]
      const product = item.productId ? productMap[item.productId] : null
      if (!req) return null
      // Only show items from worksites this user can access
      if (!canAccessWorksite(session, req.worksiteId)) return null
      return {
        id:              item.id,
        requestId:       item.requestId,
        requestCode:     req.code,
        worksiteId:      req.worksiteId,
        worksiteName:    wsMap[req.worksiteId] ?? req.worksiteId,
        productName:     product?.name ?? item.productNameFree ?? "(sin nombre)",
        productSku:      product?.sku ?? null,
        productId:       item.productId,
        productNameFree: item.productNameFree,
        quantity:        item.quantity,
        unitOfMeasure:   item.unitOfMeasure,
        urgency:         item.urgency ?? "normal",
        notes:           item.notes,
        supplierPrices:  item.productId ? (supplierPriceMap[item.productId] ?? {}) : {},
      } satisfies PendingItemOption
    })
    .filter((i): i is PendingItemOption => i !== null)

  const supplierOptions: SupplierOption[] = allSuppliers.map((s) => ({
    id:           s.id,
    name:         s.name,
    paymentTerms: s.paymentTerms,
  }))

  const worksiteOptions: WorksiteOption[] = scopedWs.map((w) => ({
    id:   w.id,
    name: w.name,
  }))
  const initialWorksiteId = worksiteOptions.some((w) => w.id === requestedWorksiteId)
    ? requestedWorksiteId
    : undefined

  return (
    <>
      <PageHeader
        title="Nueva orden de compra"
        description="Selecciona ítems aprobados, elige el proveedor y fija los precios."
        breadcrumb={
          <Breadcrumbs items={[
            { label: "Dashboard", href: "/dashboard" },
            { label: "Compras",   href: "/compras"   },
            { label: "Nueva OC"                       },
          ]} />
        }
      />
      <div className="max-w-4xl">
        <OcForm
          suppliers={supplierOptions}
          worksites={worksiteOptions}
          pendingItems={pendingItems}
          initialWorksiteId={initialWorksiteId}
        />
      </div>
    </>
  )
}
