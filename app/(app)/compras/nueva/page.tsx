import type { Metadata } from "next"
import { redirect }      from "next/navigation"
import { db }            from "@/db"
import {
  purchaseRequestItems, purchaseRequests,
  worksites, suppliers, products, productSuppliers, purchaseOrders, purchaseOrderItems,
} from "@/db/schema"
import { eq, inArray, asc } from "drizzle-orm"
import { pendingPurchaseWhere } from "@/lib/adquisiciones/pending-purchase"
import { requirePermission } from "@/lib/auth/can"
import { canAccessWorksite }  from "@/lib/auth/can"
import { worksiteScopeSql } from "@/lib/auth/scope"
import { PageHeader, Breadcrumbs } from "@/components/ui/page-header"
import { PageContainer } from "@/components/ui/page-container"
import { OcForm } from "../oc-form"
import type { PendingItemOption, SupplierOption, WorksiteOption } from "../oc-form"
import Link from "next/link"
import { getPurchasableCoverage } from "@/lib/services/purchasing-module/purchasable-coverage"
import { getProductAttributesByIds, getRequestItemAttributesByIds } from "@/lib/services/product-sizes"
import { formatVariantProductName } from "@/lib/products/variant-grouping"

/** Tope del selector de ítems; +1 en la consulta para detectar que hay más. */
const PICKER_ITEM_LIMIT = 500

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
  // El CTA "Crear orden de compra" de /pendientes trae el ítem que originó la tarea.
  const requestedItemId = typeof sp.item === "string" ? sp.item : ""
  // "Generar OC" de la cola de Compras trae la solicitud completa: se
  // preseleccionan todos sus ítems aprobados sin OC, que es exactamente lo que
  // la fila anunciaba tener pendiente.
  const requestedRequestId = typeof sp.solicitud === "string" ? sp.solicitud : ""

  const scopeFilter = worksiteScopeSql(session, purchaseRequests.worksiteId)

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
      suggestedSupplierId: purchaseRequestItems.suggestedSupplierId,
      supplierHint:        purchaseRequestItems.supplierHint,
      // COT-001: la referencia de la adjudicación viaja desde la línea.
      awardedQuotationId:    purchaseRequestItems.awardedQuotationId,
      awardedQuotationTotal: purchaseRequestItems.awardedQuotationTotal,
    })
    .from(purchaseRequestItems)
    .innerJoin(purchaseRequests, eq(purchaseRequestItems.requestId, purchaseRequests.id))
    // El mismo predicado canónico que el contador y la tabla de /compras: el
    // selector ya filtraba la cobertura activa por su cuenta (más abajo, con
    // `getPurchasableCoverage`) y ése era justamente el criterio que la bandeja
    // no aplicaba — el contador decía 8 y acá aparecían 7.
    .where(pendingPurchaseWhere(scopeFilter))
    .orderBy(asc(purchaseRequestItems.requestId))
    .limit(PICKER_ITEM_LIMIT + 1)

  // UX-7: "Nueva OC" con la cola vacía rebotaba a /compras en silencio — el
  // botón parecía no haber hecho nada. El parámetro deja que la lista
  // explique por qué.
  if (rawItems.length === 0) {
    redirect("/compras?sin_pendientes=1")
  }

  // El +1 de la consulta es el centinela de "hay más": antes existía como 501
  // pero nadie lo miraba, así que
  // con la cola muy larga, los ítems sobrantes simplemente no aparecían en el
  // selector y nada lo decía. Se avisa en pantalla en vez de truncar en silencio.
  const truncatedItems = rawItems.length > PICKER_ITEM_LIMIT
  if (truncatedItems) rawItems.length = PICKER_ITEM_LIMIT

  const requestIds = [...new Set(rawItems.map((i) => i.requestId))]
  const requestItemIds = rawItems.map((item) => item.id)
  const productIds = [...new Set(rawItems.flatMap((i) => i.productId ? [i.productId] : []))]

  const [requestRows, productRows, supplierPriceRows, allSuppliers, allWorksites, coverageLines] = await Promise.all([
    db
      .select({
        id: purchaseRequests.id, code: purchaseRequests.code, worksiteId: purchaseRequests.worksiteId,
        deliveryMode: purchaseRequests.deliveryMode,
      })
      .from(purchaseRequests)
      .where(inArray(purchaseRequests.id, requestIds)),

    productIds.length > 0
      ? db
          .select({ id: products.id, sku: products.sku, name: products.name, isService: products.isService })
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

    requestItemIds.length > 0
      ? db
          .select({
            requestItemId: purchaseOrderItems.requestItemId,
            quantity: purchaseOrderItems.quantity,
            orderStatus: purchaseOrders.status,
            orderItemStatus: purchaseOrderItems.status,
            deletedAt: purchaseOrders.deletedAt,
          })
          .from(purchaseOrderItems)
          .innerJoin(purchaseOrders, eq(purchaseOrderItems.purchaseOrderId, purchaseOrders.id))
          .where(inArray(purchaseOrderItems.requestItemId, requestItemIds))
      : Promise.resolve([]),
  ])

  const reqMap     = Object.fromEntries(requestRows.map((r) => [r.id, r]))
  const productMap = Object.fromEntries(productRows.map((p) => [p.id, p]))
  // El comprador tiene que saber qué talla pedirle al proveedor sin volver a
  // abrir la solicitud.
  const [attributesById, recordedById] = await Promise.all([
    getProductAttributesByIds(productIds), getRequestItemAttributesByIds(requestItemIds),
  ])
  const wsMap      = Object.fromEntries(allWorksites.map((w) => [w.id, w.name]))
  const supplierPriceMap = supplierPriceRows.reduce<Record<string, Record<string, number>>>((acc, row) => {
    if (row.unitPrice === null) return acc
    ;(acc[row.productId] ??= {})[row.supplierId] = row.unitPrice
    return acc
  }, {})

  // Scope worksites
  const scopedWs = allWorksites.filter((w) => canAccessWorksite(session, w.id))

  const coverageByItemId = new Map(
    getPurchasableCoverage(rawItems, coverageLines).map((coverage) => [coverage.requestItemId, coverage]),
  )

  /*
   * COT-001: cuántas líneas comparten cada adjudicación. Con una sola, el total
   * de la oferta es el de esa línea y se puede prefijar; con varias sólo se
   * muestra como contraste. Repartirlo sería inventar un dato con apariencia de
   * hecho, y la propia ficha del hallazgo lo excluye.
   */
  const awardedLineCounts = new Map<string, number>()
  for (const item of rawItems) {
    if (!item.awardedQuotationId) continue
    awardedLineCounts.set(item.awardedQuotationId, (awardedLineCounts.get(item.awardedQuotationId) ?? 0) + 1)
  }

  const pendingItems: PendingItemOption[] = rawItems
    .flatMap((item): PendingItemOption[] => {
      const req     = reqMap[item.requestId]
      const product = item.productId ? productMap[item.productId] : null
      if (!req) return []
      // Only show items from worksites this user can access
      if (!canAccessWorksite(session, req.worksiteId)) return []
      if (!coverageByItemId.get(item.id)?.isPurchasable) return []
      return [{
        id:              item.id,
        requestId:       item.requestId,
        requestCode:     req.code,
        worksiteId:      req.worksiteId,
        worksiteName:    wsMap[req.worksiteId] ?? req.worksiteId,
        productName:     product
          ? formatVariantProductName(product.name, attributesById.get(product.id), recordedById.get(item.id))
          : item.productNameFree ?? "(sin nombre)",
        productSku:      product?.sku ?? null,
        productId:       item.productId,
        // Un servicio entra a la OC sin precio si todavía no se conoce.
        isService:       product?.isService ?? false,
        productNameFree: item.productNameFree,
        quantity:        item.quantity,
        unitOfMeasure:   item.unitOfMeasure,
        urgency:         item.urgency ?? "normal",
        notes:           item.notes,
        supplierPrices:  item.productId ? (supplierPriceMap[item.productId] ?? {}) : {},
        suggestedSupplierId: item.suggestedSupplierId,
        supplierHint:        item.supplierHint,
        // COT-001: la adjudicación viaja hasta el formulario.
        awardedQuotationId:    item.awardedQuotationId,
        awardedQuotationTotal: item.awardedQuotationTotal,
        awardedLineCount:      item.awardedQuotationId ? (awardedLineCounts.get(item.awardedQuotationId) ?? 1) : 0,
        deliveryMode:    req.deliveryMode as "via_oficina" | "directo_faena",
      }]
    })

  if (pendingItems.length === 0) {
    redirect("/compras?sin_pendientes=1")
  }

  const supplierOptions: SupplierOption[] = allSuppliers.map((s) => ({
    id:           s.id,
    name:         s.name,
    paymentTerms: s.paymentTerms,
  }))

  const worksiteOptions: WorksiteOption[] = scopedWs.map((w) => ({
    id:   w.id,
    name: w.name,
  }))
  const firstPendingWorksiteId = pendingItems[0]?.worksiteId
  const initialWorksiteId = requestedWorksiteId && worksiteOptions.some((w) => w.id === requestedWorksiteId)
    ? requestedWorksiteId
    : firstPendingWorksiteId ?? worksiteOptions[0]?.id

  // `?item=` (una tarea de /pendientes) y `?solicitud=` (una fila de la cola de
  // Compras) son la misma preselección con distinta granularidad.
  const initialItemIds = requestedRequestId
    ? pendingItems.filter((item) => item.requestId === requestedRequestId).map((item) => item.id)
    : requestedItemId
      ? [requestedItemId]
      : []

  return (
    <PageContainer width="workbench">
      <PageHeader
        title="Nueva orden de compra"
        description="Selecciona ítems aprobados, elige el proveedor y fija los precios."
        breadcrumb={
          <Breadcrumbs items={[
            { label: "Inicio", href: "/dashboard" },
            { label: "Compras", href: "/compras" },
            { label: "Nueva OC"                       },
          ]} />
        }
      />
      {truncatedItems && (
        <div role="status" className="rounded-(--radius) border border-warning-line bg-warning-tint px-4 py-3 text-sm text-warning-ink">
          Hay más de {PICKER_ITEM_LIMIT} ítems aprobados esperando compra. Se muestran los {PICKER_ITEM_LIMIT} más antiguos;
          filtra por faena desde <Link href="/compras" className="underline">Órdenes de compra</Link> para ver el resto.
        </div>
      )}
      <OcForm
        suppliers={supplierOptions}
        worksites={worksiteOptions}
        pendingItems={pendingItems}
        initialWorksiteId={initialWorksiteId}
        initialItemIds={initialItemIds}
      />
    </PageContainer>
  )
}
