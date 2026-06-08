import type { Metadata } from "next"
import { notFound, redirect } from "next/navigation"
import { db } from "@/db"
import {
  invoiceAttachments, purchaseRequests,
  worksites, products, productAttributes,
  statusHistory, users, suppliers, workers,
} from "@/db/schema"
import { and, asc, desc, eq } from "drizzle-orm"
import { can, requirePermission } from "@/lib/auth/can"
import { canAccessWorksite } from "@/lib/auth/can"
import { canViewInvoiceAttachments } from "@/lib/auth/invoice-attachments"
import { PageHeader, Breadcrumbs } from "@/components/ui/page-header"
import { StateBadge } from "@/components/states/state-badge"
import { InvoiceAttachmentsPanel } from "@/components/invoices/invoice-attachments-panel"
import { getPdfMaxSizeMb } from "@/lib/services/system-settings"
import { RequestForm } from "../request-form"
import { DuplicateButton } from "./duplicate-button"
import { EntityTimeline } from "@/components/states/entity-timeline"
import { RequestProgressPanel } from "@/components/states/request-progress-panel"
import { buildRequestProgress } from "@/lib/work-queue"

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
  const canViewInvoices = canViewInvoiceAttachments(session)

  const [allWorksites, allProducts, allAttrs, invoiceRows, timelineEvents, maxPdfSizeMb, allSuppliers, allWorkers] = await Promise.all([
    db.select().from(worksites).where(eq(worksites.isActive, true)).orderBy(asc(worksites.name)),
    db.select().from(products).where(eq(products.isActive, true)).orderBy(asc(products.name)),
    db.select().from(productAttributes).orderBy(asc(productAttributes.sortOrder)),
    canViewInvoices
      ? db.query.invoiceAttachments.findMany({
          where: and(
            eq(invoiceAttachments.targetType, "purchase_request"),
            eq(invoiceAttachments.targetId, request.id),
          ),
          with: { uploader: true },
          orderBy: (ia) => [desc(ia.uploadedAt)],
        })
      : Promise.resolve([]),
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
    getPdfMaxSizeMb(),
    db.select().from(suppliers).where(eq(suppliers.isActive, true)).orderBy(asc(suppliers.name)),
    db.select().from(workers).where(eq(workers.isActive, true)).orderBy(asc(workers.firstName)),
  ])

  const worksiteOptions = allWorksites
    .filter((w) => canAccessWorksite(session, w.id))
    .map((w) => ({
      id:          w.id,
      name:        w.name,
    }))

  const productOptions = allProducts.map((p) => ({
    id:             p.id,
    sku:            p.sku,
    name:           p.name,
    isEpp:          p.isEpp,
    unitOfMeasure:  p.unitOfMeasure,
    categoryName:   p.categoryId,
    referencePrice: p.referencePrice,
    attributes:     allAttrs
      .filter((a) => a.productId === p.id)
      .map((a) => ({ id: a.id, name: a.name, type: a.type, isRequired: a.isRequired, options: a.options })),
  }))

  const supplierOptions = allSuppliers.map((s) => ({
    id:   s.id,
    name: s.name,
  }))

  const workerOptions = allWorkers.map((w) => ({
    id:         w.id,
    worksiteId: w.worksiteId,
    firstName:  w.firstName,
    lastName:   w.lastName,
    position:   w.position,
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
    status:       request.status,
    notes:        request.notes,
    items: request.items.map((item) => ({
      id:                  item.id,
      productId:           item.productId,
      productNameFree:     item.productNameFree,
      quantity:            item.quantity,
      unitOfMeasure:       item.unitOfMeasure,
      urgency:             item.urgency ?? "normal",
      requiredDate:        item.requiredDate,
      workerId:            item.workerId,
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
    <>
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
      <div className="max-w-3xl space-y-6">
        <RequestProgressPanel progress={progress} />
        <RequestForm
          worksites={worksiteOptions}
          products={productOptions}
          suppliers={supplierOptions}
          workers={workerOptions}
          editRequest={editRequest}
        />
        {canViewInvoices && (
          <InvoiceAttachmentsPanel
            targetType="purchase_request"
            targetId={request.id}
            targetLabel={`la solicitud ${request.code}`}
            canManage={can(session, "invoice_attachments:manage")}
            maxPdfSizeMb={maxPdfSizeMb}
            attachments={invoiceRows.map((invoice) => ({
              id:                  invoice.id,
              invoiceNumber:       invoice.invoiceNumber,
              invoiceDate:         invoice.invoiceDate,
              amount:              invoice.amount,
              fileName:            invoice.fileName,
              fileSize:            invoice.fileSize,
              mimeType:            invoice.mimeType,
              notes:               invoice.notes,
              uploadedAt:          invoice.uploadedAt,
              uploaderName:        invoice.uploader?.name ?? null,
              status:              (invoice.status as "registered" | "observed" | "reconciled") ?? "registered",
              reconciliationNotes: invoice.reconciliationNotes ?? null,
            }))}
          />
        )}
        <EntityTimeline entityType="request" events={timelineEvents} />
      </div>
    </>
  )
}
