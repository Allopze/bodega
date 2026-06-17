import type { Metadata } from "next"
import { notFound, redirect } from "next/navigation"
import { db } from "@/db"
import {
  purchaseRequests, repuestoQuotations, serviceQuotations,
  worksites, products, productAttributes,
  statusHistory, users, suppliers, productSuppliers,
} from "@/db/schema"
import { and, asc, desc, eq, inArray } from "drizzle-orm"
import { can, requirePermission } from "@/lib/auth/can"
import { canAccessWorksite } from "@/lib/auth/can"
import { PageHeader, Breadcrumbs } from "@/components/ui/page-header"
import { PageContainer } from "@/components/ui/page-container"
import { StateBadge } from "@/components/states/state-badge"
import { RequestForm } from "../request-form"
import { DuplicateButton } from "./duplicate-button"
import { EntityTimeline } from "@/components/states/entity-timeline"
import { RequestProgressPanel } from "@/components/states/request-progress-panel"
import { buildRequestProgress } from "@/lib/work-queue"
import { QUOTATION_TYPES } from "@/lib/request-types"
import { QuotationPanel } from "@/components/requests/quotation-panel"
import {
  uploadQuotationUnifiedAction,
  deleteQuotationUnifiedAction,
} from "../actions"

export const metadata: Metadata = { title: "Solicitud de compra" }

export default async function SolicitudPage({ params }: { params: Promise<{ id: string }> }) {
  let session
  try { session = await requirePermission("requests:view_own") }
  catch { redirect("/dashboard") }

  const { id } = await params

  const request = await db.query.purchaseRequests.findFirst({
    where: eq(purchaseRequests.id, id),
    with:  {
      items: {
        orderBy: (i, { asc }) => [asc(i.sortOrder)],
        with: { attributes: true },
      },
      worksite:   true,
      requester:  true,
    },
  })

  if (!request) notFound()

  const isOwner    = request.requesterId === session.user.id
  const hasViewAll = session.user.permissions.includes("requests:view_all")
  const hasAccess  = hasViewAll || (isOwner && canAccessWorksite(session, request.worksiteId))
  if (!hasAccess) notFound()

  // Load quotations for repuestos/servicios
  const isQuotationType = QUOTATION_TYPES.has(request.requestType)
  let quotations: Array<{
    id: string
    supplierId: string | null
    supplierNameFree: string | null
    supplierName: string | null
    fileName: string
    totalAmount: number
    status: "pending" | "selected" | "rejected"
    notes: string | null
    createdAt: string
  }> = []

  if (isQuotationType) {
    const quotationTable = request.requestType === "repuestos" ? repuestoQuotations : serviceQuotations
    const rawRows = await db
      .select()
      .from(quotationTable)
      .where(eq(quotationTable.requestId, id))
      .orderBy(asc(quotationTable.createdAt))
    // Resolve supplier names for catalog suppliers
    const supplierIds = rawRows.map((r) => r.supplierId).filter((s): s is string => s != null)
    let supplierMap: Record<string, string> = {}
    if (supplierIds.length > 0) {
      const supplierRows = await db
        .select({ id: suppliers.id, name: suppliers.name })
        .from(suppliers)
        .where(inArray(suppliers.id, supplierIds))
      supplierMap = Object.fromEntries(supplierRows.map((s) => [s.id, s.name]))
    }
    quotations = rawRows.map((r) => ({
      id: r.id,
      supplierId: r.supplierId,
      supplierNameFree: r.supplierNameFree,
      supplierName: r.supplierId ? (supplierMap[r.supplierId] ?? null) : null,
      fileName: r.fileName,
      totalAmount: Number(r.totalAmount),
      status: r.status as "pending" | "selected" | "rejected",
      notes: r.notes,
      createdAt: r.createdAt,
    }))
  }

  const [allWorksites, allProducts, allAttrs, timelineEvents, allSuppliers] = await Promise.all([
    db.select().from(worksites).where(eq(worksites.isActive, true)).orderBy(asc(worksites.name)),
    db.select().from(products).where(eq(products.isActive, true)).orderBy(asc(products.name)),
    db.select().from(productAttributes).orderBy(asc(productAttributes.sortOrder)),
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
          eq(statusHistory.entityType, "purchase_request"),
          eq(statusHistory.entityId, request.id),
        ),
      )
      .orderBy(desc(statusHistory.changedAt)),
    db.select().from(suppliers).where(eq(suppliers.isActive, true)).orderBy(asc(suppliers.name)),
  ])

  const allSupplierRows = allProducts.length > 0
    ? await db.select({
        productId:   productSuppliers.productId,
        supplierId:  productSuppliers.supplierId,
        isPreferred: productSuppliers.isPreferred,
      }).from(productSuppliers)
        .where(inArray(productSuppliers.productId, allProducts.map((p) => p.id)))
    : []

  const worksiteOptions = allWorksites
    .filter((w) => canAccessWorksite(session, w.id))
    .map((w) => ({
      id:          w.id,
      name:        w.name,
    }))

  const productOptions = allProducts.map((p) => {
    const suppRows = allSupplierRows.filter((r) => r.productId === p.id)
    let preferredSupplierId: string | null = null
    const preferred = suppRows.find((r) => r.isPreferred)
    if (preferred) {
      preferredSupplierId = preferred.supplierId
    } else if (suppRows.length === 1) {
      preferredSupplierId = suppRows[0].supplierId
    }
    return {
      id:                  p.id,
      sku:                 p.sku,
      name:                p.name,
      isEpp:               p.isEpp,
      unitOfMeasure:       p.unitOfMeasure,
      categoryName:        p.categoryId,
      referencePrice:      p.referencePrice,
      preferredSupplierId,
      attributes:          allAttrs
        .filter((a) => a.productId === p.id)
        .map((a) => ({ id: a.id, name: a.name, type: a.type, isRequired: a.isRequired, options: a.options })),
    }
  })

  const supplierOptions = allSuppliers.map((s) => ({
    id:   s.id,
    name: s.name,
  }))

  const productNameById = new Map(allProducts.map((product) => [product.id, product.name]))
  const progress = buildRequestProgress(
    request.status,
    request.items.map((item) => ({
      id:            item.id,
      productName:   item.productId ? (productNameById.get(item.productId) ?? item.productNameFree ?? "Ítem solicitado") : (item.productNameFree ?? "Ítem solicitado"),
      status:        item.status,
      quantity:      item.quantity,
      unitOfMeasure: item.unitOfMeasure,
    })),
  )

  const editRequest = {
    id:           request.id,
    code:         request.code,
    worksiteId:   request.worksiteId,
    requestType:  request.requestType,
    urgency:      request.urgency,
    requiredDate: request.requiredDate ?? request.items.find((item) => item.requiredDate)?.requiredDate ?? null,
    status:       request.status,
    notes:        request.notes,
    items: request.items.map((item) => ({
      id:                  item.id,
      productId:           item.productId,
      productNameFree:     item.productNameFree,
      quantity:            item.quantity,
      unitOfMeasure:       item.unitOfMeasure,
      urgency:             item.urgency ?? "normal",
      suggestedSupplierId: item.suggestedSupplierId,
      supplierHint:        item.supplierHint,
      notes:               item.notes,
      attributes:          item.attributes.map((a) => ({
        attributeId:   a.attributeId,
        attributeName: a.attributeName,
        value:         a.value,
      })),
    })),
  }

  return (
    <PageContainer width="form">
      <PageHeader
        title={request.code}
        description={`Solicitado por ${request.requester?.name ?? "—"} · ${request.worksite?.name ?? "—"}`}
        actions={
          <div className="flex items-center gap-2">
            <StateBadge state={request.status} entity="request" />
            {can(session, "requests:create") && (
              <DuplicateButton requestId={request.id} />
            )}
          </div>
        }
        breadcrumb={
          <Breadcrumbs items={[
            { label: "Dashboard",   href: "/dashboard"   },
            { label: "Solicitudes", href: "/solicitudes" },
            { label: request.code                        },
          ]} />
        }
      />
      <div className="space-y-6">
        <RequestProgressPanel progress={progress} />
        {isQuotationType && (
          <QuotationPanel
            requestId={request.id}
            requestStatus={request.status}
            requestType={request.requestType}
            quotations={quotations}
            canUpload={isOwner && ["draft", "returned"].includes(request.status)}
            canApprove={false}
            downloadBase={request.requestType === "repuestos" ? "/api/repuestos/quotaciones" : "/api/servicios/cotizaciones"}
            uploadAction={uploadQuotationUnifiedAction}
            deleteAction={deleteQuotationUnifiedAction}
          />
        )}
        <RequestForm
          worksites={worksiteOptions}
          products={productOptions}
          suppliers={supplierOptions}
          editRequest={editRequest}
        />
        <EntityTimeline entityType="request" events={timelineEvents} />
      </div>
    </PageContainer>
  )
}
