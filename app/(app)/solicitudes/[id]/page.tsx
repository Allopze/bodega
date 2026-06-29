import type { Metadata } from "next"
import { notFound, redirect } from "next/navigation"
import { db } from "@/db"
import {
  purchaseRequests,
  worksites, products, productAttributes,
  statusHistory, users, suppliers, productSuppliers,
} from "@/db/schema"
import { and, asc, desc, eq } from "drizzle-orm"
import { can, requireAuth } from "@/lib/auth/can"
import { canAccessWorksite } from "@/lib/auth/can"
import { RepuestoDetailView } from "../../repuestos/detail-view"
import { ServiceDetailView } from "../../servicios/detail-view"
import { getPdfMaxSizeMb } from "@/lib/services/system-settings"
import { PageHeader, Breadcrumbs } from "@/components/ui/page-header"
import { PageContainer } from "@/components/ui/page-container"
import { StateBadge } from "@/components/states/state-badge"
import { RequestForm } from "../request-form"
import { DuplicateButton } from "./duplicate-button"
import { EntityTimeline } from "@/components/states/entity-timeline"
import { RequestProgressPanel } from "@/components/states/request-progress-panel"
import { buildRequestProgress } from "@/lib/work-queue"

export const metadata: Metadata = { title: "Solicitud de compra" }

export default async function SolicitudPage({ params }: { params: Promise<{ id: string }> }) {
  let session
  try { session = await requireAuth() }
  catch { redirect("/forbidden") }

  const { id } = await params

  // Quotation-based types (repuestos/servicios) render their specialized
  // detail view inline; each enforces its own view permission.
  const { requestType } = await db.query.purchaseRequests.findFirst({
    where: eq(purchaseRequests.id, id),
    columns: { requestType: true },
  }) ?? {}
  if (!requestType) notFound()
  if (requestType === "repuestos") return <RepuestoDetailView id={id} />
  if (requestType === "servicios") return <ServiceDetailView id={id} />

  // Catalogue-based types (epp/otro) use the per-item approval flow below.
  if (!can(session, "requests:view_own")) redirect("/forbidden")

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

  const [allWorksites, allProducts, allAttrs, productSupplierRows, timelineEvents, allSuppliers, maxFileSizeMb] = await Promise.all([
    db.select().from(worksites).where(eq(worksites.isActive, true)).orderBy(asc(worksites.name)),
    db.select().from(products).where(eq(products.isActive, true)).orderBy(asc(products.name)),
    db.select().from(productAttributes).orderBy(asc(productAttributes.sortOrder)),
    db
      .select({
        productId:  productSuppliers.productId,
        supplierId: productSuppliers.supplierId,
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
  for (const row of productSupplierRows) {
    if (activeSupplierIds.has(row.supplierId) && !preferredSupplierByProduct.has(row.productId)) {
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
