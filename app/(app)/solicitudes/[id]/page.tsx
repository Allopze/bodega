import type { Metadata } from "next"
import { notFound, redirect } from "next/navigation"
import { db } from "@/db"
import {
  purchaseRequests,
  worksites, products, productAttributes,
  statusHistory, users, suppliers, productSuppliers,
  approvalDecisions, purchaseRequestItems,
  repuestoQuotations, serviceQuotations,
} from "@/db/schema"
import { and, asc, desc, eq, inArray, or, sql } from "drizzle-orm"
import { can, requireAuth } from "@/lib/auth/can"
import { canAccessWorksite } from "@/lib/auth/can"
import { QUOTATION_TYPES } from "@/lib/request-types"
import { getPdfMaxSizeMb } from "@/lib/services/system-settings"
import { PageHeader, Breadcrumbs } from "@/components/ui/page-header"
import { PageContainer } from "@/components/ui/page-container"
import { StateBadge } from "@/components/states/state-badge"
import { RequestForm } from "../request-form"
import { QuotationPanel } from "../../repuestos/quotation-panel"
import { ServiceQuotationPanel } from "../../servicios/quotation-panel"
import { DuplicateButton } from "./duplicate-button"
import { EntityTimeline } from "@/components/states/entity-timeline"
import { RequestProgressPanel } from "@/components/states/request-progress-panel"
import { buildRequestProgress } from "@/lib/work-queue"
import { RequestPeoplePanel } from "../request-people-panel"


export const metadata: Metadata = { title: "Solicitud de compra" }

export default async function SolicitudPage({ params }: { params: Promise<{ id: string }> }) {
  let session
  try { session = await requireAuth() }
  catch { redirect("/forbidden") }

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

  const isQuotation = QUOTATION_TYPES.has(request.requestType)



  // View permission is per request type: repuestos/servicios carry their own
  // namespaces, epp/otro use requests:*. All quotation-type viewers also hold
  // requests:view_own, so the unified list/detail remain reachable for them.
  const typeViewAll =
    request.requestType === "repuestos" ? can(session, "repuestos:view_all")
    : request.requestType === "servicios" ? can(session, "servicios:view_all")
    : false
  const isOwner    = request.requesterId === session.user.id
  const hasViewAll = can(session, "requests:view_all") || typeViewAll
  const hasAccess  = hasViewAll || (isOwner && canAccessWorksite(session, request.worksiteId))
  if (!hasAccess) notFound()

  // ── Quotation panel data (repuestos/servicios) ─────────────────────────────
  const isEditable = ["draft", "returned"].includes(request.status)
  const canUploadQuotation = isOwner && isEditable
  const canApproveQuotation =
    request.requestType === "repuestos" ? can(session, "repuestos:approve")
    : request.requestType === "servicios" ? can(session, "servicios:approve")
    : false

  const quotationsRaw = !isQuotation
    ? []
    : request.requestType === "repuestos"
      ? await db.query.repuestoQuotations.findMany({
          where: eq(repuestoQuotations.requestId, request.id),
          with: { supplier: { columns: { id: true, name: true } } },
          orderBy: (q, { asc }) => asc(q.createdAt),
        })
      : await db.query.serviceQuotations.findMany({
          where: eq(serviceQuotations.requestId, request.id),
          with: { supplier: { columns: { id: true, name: true } } },
          orderBy: (q, { asc }) => asc(q.createdAt),
        })

  const quotations = quotationsRaw.map((q) => ({
    id:               q.id,
    supplierId:       q.supplierId,
    supplierNameFree: q.supplierNameFree,
    supplierName:     q.supplier?.name ?? null,
    fileName:         q.fileName,
    totalAmount:      Number(q.totalAmount),
    status:           q.status as "pending" | "selected" | "rejected",
    notes:            q.notes,
    createdAt:        q.createdAt,
  }))

  // Collect productIds referenced by items so we can load them even if
  // they were deactivated (e.g. after a bulk EPP deactivation from admin).
  const referencedProductIds = request.items
    .map((i) => i.productId)
    .filter((id): id is string => id != null)

  const [allWorksites, allProducts, allAttrs, productSupplierRows, timelineEvents, approvalDecisionRows, allSuppliers, maxFileSizeMb] = await Promise.all([
    db.select().from(worksites).where(eq(worksites.isActive, true)).orderBy(asc(worksites.name)),
    db.select().from(products).where(
      referencedProductIds.length > 0
        ? or(eq(products.isActive, true), inArray(products.id, referencedProductIds))
        : eq(products.isActive, true)
    ).orderBy(asc(products.name)),
    db.select().from(productAttributes).orderBy(asc(productAttributes.sortOrder)),
    db
      .select({
        productId:  productSuppliers.productId,
        supplierId: productSuppliers.supplierId,
        isPreferred: productSuppliers.isPreferred,
      })
      .from(productSuppliers)
      .orderBy(desc(productSuppliers.isPreferred)),
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
    db
      .select({
        id:             approvalDecisions.id,
        type:           approvalDecisions.type,
        decidedAt:      approvalDecisions.decidedAt,
        reason:         approvalDecisions.reason,
        modifiedQty:    approvalDecisions.modifiedQty,
        roleContext:    approvalDecisions.roleContext,
        decidedByName:  users.name,
        decidedByEmail: users.email,
        itemName:       sql<string>`coalesce(${products.name}, ${purchaseRequestItems.productNameFree}, 'Ítem solicitado')`,
      })
      .from(approvalDecisions)
      .leftJoin(users, eq(approvalDecisions.decidedBy, users.id))
      .leftJoin(purchaseRequestItems, eq(approvalDecisions.requestItemId, purchaseRequestItems.id))
      .leftJoin(products, eq(purchaseRequestItems.productId, products.id))
      .where(eq(approvalDecisions.requestId, request.id))
      .orderBy(desc(approvalDecisions.decidedAt)),
    db.select().from(suppliers).where(eq(suppliers.isActive, true)).orderBy(asc(suppliers.name)),
    getPdfMaxSizeMb(),
  ])

  const worksiteOptions = allWorksites
    .filter((w) => canAccessWorksite(session, w.id))
    .map((w) => ({
      id:          w.id,
      name:        w.name,
    }))

  const activeSupplierIds = new Set(allSuppliers.map((supplier) => supplier.id))
  const preferredSupplierByProduct = new Map<string, string>()
  // First pass: prefer suppliers explicitly marked as isPreferred
  for (const row of productSupplierRows) {
    if (row.isPreferred && activeSupplierIds.has(row.supplierId) && !preferredSupplierByProduct.has(row.productId)) {
      preferredSupplierByProduct.set(row.productId, row.supplierId)
    }
  }
  // Second pass: fill gaps with any active non-preferred supplier
  for (const row of productSupplierRows) {
    if (!preferredSupplierByProduct.has(row.productId) && activeSupplierIds.has(row.supplierId)) {
      preferredSupplierByProduct.set(row.productId, row.supplierId)
    }
  }

  const productOptions = allProducts.map((p) => ({
    id:             p.id,
    sku:            p.sku,
    name:           p.name,
    isEpp:          p.isEpp,
    unitOfMeasure:  p.unitOfMeasure,
    categoryName:   p.categoryId,
    referencePrice: p.referencePrice,
    isInactive:     !p.isActive,
    familyId:       p.familyId,
    preferredSupplierId: preferredSupplierByProduct.get(p.id) ?? null,
    attributes:     allAttrs
      .filter((a) => a.productId === p.id)
      .map((a) => ({ id: a.id, name: a.name, type: a.type, isRequired: a.isRequired, options: a.options })),
  }))

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
      status:              item.status,
      attributes:          item.attributes.map((a) => ({
        attributeId:   a.attributeId,
        attributeName: a.attributeName,
        value:         a.value,
      })),
    })),
  }

  return (
    <PageContainer width="workbench">
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
        <RequestPeoplePanel
          requesterName={request.requester?.name}
          requesterEmail={request.requester?.email}
          createdAt={request.createdAt}
          submittedAt={request.submittedAt}
          decisions={approvalDecisionRows}
        />
        {isQuotation && request.requestType === "repuestos" && (
          <QuotationPanel
            requestId={request.id}
            requestStatus={request.status}
            quotations={quotations}
            canUpload={canUploadQuotation}
            canApprove={canApproveQuotation}
          />
        )}
        {isQuotation && request.requestType === "servicios" && (
          <ServiceQuotationPanel
            requestId={request.id}
            requestStatus={request.status}
            quotations={quotations}
            canUpload={canUploadQuotation}
            canApprove={canApproveQuotation}
          />
        )}
        <RequestForm
          worksites={worksiteOptions}
          products={productOptions}
          suppliers={supplierOptions}
          editRequest={editRequest}
          maxFileSizeMb={maxFileSizeMb}
          userRoles={session.user.roles}
          userPermissions={session.user.permissions}
        />
        <EntityTimeline entityType="request" events={timelineEvents} />
      </div>
    </PageContainer>
  )
}
