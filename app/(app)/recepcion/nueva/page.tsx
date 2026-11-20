import { getProductAttributesByIds, getRequestItemAttributesByIds } from "@/lib/services/product-sizes"
import { withCatalogPartNumber } from "@/lib/products/spare-part-display"
import { formatVariantProductName } from "@/lib/products/variant-grouping"
import type { Metadata } from "next"
import { redirect, notFound } from "next/navigation"
import { db }                 from "@/db"
import {
  dispatchGuides,
  purchaseOrders,
  purchaseRequestItems,
  preventionEmergencyResources,
  receipts,
  receiptItems,
} from "@/db/schema"
import { and, asc, eq, inArray, ne } from "drizzle-orm"
import { requireAuth, can, canAny, canAccessWorksite } from "@/lib/auth/can"
import { PageHeader, Breadcrumbs } from "@/components/ui/page-header"
import { PageContainer } from "@/components/ui/page-container"
import { ReceiptForm } from "../receipt-form"
import type { ReceiptOcItem } from "../receipt-form"
import { stageHasPending } from "../receipt-remaining"
import { faenaGuideNotice, pickFaenaGuide } from "../faena-guide"
import { EmptyState } from "@/components/ui/empty-state"
import { Button } from "@/components/ui/button"
import Link from "next/link"
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
        columns: { id: true, sku: true, name: true, serviceSubjectKind: true, isSparePart: true, partNumber: true },
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

  /*
   * REC-002: cuánto se dispuso ya en cada etapa —recibido + rechazado + dañado—,
   * que es contra lo que `registerReceipt` descuenta el saldo de la línea.
   */
  const disposedRows = order.items.length > 0
    ? await db
        .select({
          purchaseOrderItemId: receiptItems.purchaseOrderItemId,
          locationType: receipts.locationType,
          received: receiptItems.quantityReceived,
          rejected: receiptItems.quantityRejected,
          damaged:  receiptItems.quantityDamaged,
        })
        .from(receiptItems)
        .innerJoin(receipts, eq(receiptItems.receiptId, receipts.id))
        .where(inArray(receiptItems.purchaseOrderItemId, order.items.map((item) => item.id)))
    : []
  const disposedByItem = new Map<string, { office: number; faena: number }>()
  for (const row of disposedRows) {
    const entry = disposedByItem.get(row.purchaseOrderItemId) ?? { office: 0, faena: 0 }
    const total = row.received + row.rejected + row.damaged
    if (row.locationType === "office") entry.office += total
    else entry.faena += total
    disposedByItem.set(row.purchaseOrderItemId, entry)
  }

  // Un repuesto de catálogo dice su N° de parte una vez; el libre que queda en la
  // línea catalogada al armar la OC no se repite.
  const recordedForDisplay = (
    product: { isSparePart: boolean; partNumber: string | null } | null | undefined,
    recorded: Array<{ name: string; value: string }> | undefined,
  ) => withCatalogPartNumber(product, recorded?.map((attribute) => ({ attributeName: attribute.name, value: attribute.value })))
    .map((attribute) => ({ name: attribute.attributeName, value: attribute.value }))

  const items: ReceiptOcItem[] = order.items.map((item) => {
    const product = item.productId ? productMap[item.productId] : null
    return {
      id:               item.id,
      requestItemId:    item.requestItemId,
      productName:      formatVariantProductName(productRows.find((p) => p.id === item.productId)?.name ?? item.productNameFree ?? "(sin nombre)", item.productId ? attributesById.get(item.productId) : [], item.requestItemId ? recordedForDisplay(product, recordedById.get(item.requestItemId)) : []),
      productSku:       product?.sku ?? null,
      quantity:         item.quantity,
      quantityOfficeReceived: item.quantityOfficeReceived ?? 0,
      quantityReceived: item.quantityReceived ?? 0,
      // REC-002: lo dispuesto, no sólo lo recibido. Sin esto la pantalla ofrece
      // un saldo que el servidor rechaza en cuanto hubo un rechazo parcial.
      quantityOfficeDisposed: disposedByItem.get(item.id)?.office ?? 0,
      quantityFaenaDisposed:  disposedByItem.get(item.id)?.faena  ?? 0,
      unitOfMeasure:    item.unitOfMeasure,
      notes:            item.notes,
      isEmergencyService: product?.serviceSubjectKind === "emergency_resource",
      isDirectConsumption: product?.isSparePart === true,
      emergencyResourceLabel: item.requestItemId ? (emergencySubjectMap.get(item.requestItemId) ?? null) : null,
    }
  })

  const deliveryMode = order.deliveryMode as "via_oficina" | "directo_faena"
  const worksiteName = order.worksite?.name ?? "faena de la OC"

  /*
   * Con guía de despacho la faena no se recibe aquí: `registerReceipt` lo
   * rechaza (ver `faena-guide.ts`). Si además no queda nada que registrar en
   * oficina, la página entera es ese aviso; si queda, el formulario sólo ofrece
   * la etapa de oficina y el aviso va junto al selector de etapa.
   */
  const faenaGuide = deliveryMode === "directo_faena"
    ? null
    : pickFaenaGuide(await db
        .select({ id: dispatchGuides.id, code: dispatchGuides.code, status: dispatchGuides.status, receiptId: dispatchGuides.receiptId })
        .from(dispatchGuides)
        .where(and(eq(dispatchGuides.purchaseOrderId, order.id), ne(dispatchGuides.status, "cancelled")))
        .orderBy(asc(dispatchGuides.createdAt), asc(dispatchGuides.id)))
  const faenaNotice = faenaGuide
    ? faenaGuideNotice(faenaGuide, worksiteName, {
        viewGuides:    can(session, "warehouse:view_guides"),
        receiveGuide:  can(session, "warehouse:receive_guide"),
        dispatchGuide: can(session, "warehouse:dispatch_guide"),
        viewReceipts:  can(session, "receiving:view"),
      })
    : null
  const officePending = canOfficeForOrder && stageHasPending(items, "office", deliveryMode)

  const header = (
    <PageHeader
      title={`Recepción ${order.code}`}
      description={deliveryMode === "directo_faena"
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
  )

  if (faenaNotice && !officePending) {
    return (
      <PageContainer width="form">
        {header}
        <EmptyState
          align="start"
          title={faenaNotice.title}
          description={faenaNotice.description}
          action={faenaNotice.action && (
            <Button variant="primary" asChild>
              <Link href={faenaNotice.action.href}>{faenaNotice.action.label}</Link>
            </Button>
          )}
          secondaryAction={
            <Button variant="secondary" asChild>
              <Link href="/recepcion">Volver a Recepción</Link>
            </Button>
          }
        />
      </PageContainer>
    )
  }

  return (
    <PageContainer width="workbench">
      {header}
      <ReceiptForm
        purchaseOrderId={order.id}
        orderCode={order.code}
        orderWorksiteName={worksiteName}
        officeName={officeName}
        items={items}
        canOffice={canOfficeForOrder}
        canFaena={canFaena && !faenaNotice}
        faenaGuideNotice={faenaNotice}
        deliveryMode={deliveryMode}
      />
    </PageContainer>
  )
}
