import type { Metadata } from "next"
import { notFound, redirect } from "next/navigation"
import { db } from "@/db"
import {
  purchaseRequests, _purchaseRequestItems, _requestItemAttributes,
  serviceQuotations, statusHistory, users, worksites, suppliers,
} from "@/db/schema"
import { and, asc, desc, eq } from "drizzle-orm"
import { can, requirePermission, canAccessWorksite } from "@/lib/auth/can"
import { PageHeader, Breadcrumbs } from "@/components/ui/page-header"
import { PageContainer } from "@/components/ui/page-container"
import { StateBadge } from "@/components/states/state-badge"
import { EntityTimeline } from "@/components/states/entity-timeline"
import { RequestProgressPanel } from "@/components/states/request-progress-panel"
import { buildRequestProgress } from "@/lib/work-queue"
import { ServiceForm } from "../request-form"
import { ServiceQuotationPanel } from "./quotation-panel"
import { SERVICE_ATTRIBUTE_NAMES } from "@/lib/validation/servicios"

export const metadata: Metadata = { title: "Solicitud de servicios" }

export default async function ServicioPage({ params }: { params: Promise<{ id: string }> }) {
  let session
  try { session = await requirePermission("servicios:view_own") }
  catch { redirect("/dashboard") }

  const { id } = await params

  const request = await db.query.purchaseRequests.findFirst({
    where: and(
      eq(purchaseRequests.id, id),
      eq(purchaseRequests.requestType, "servicios"),
    ),
    with: {
      items: {
        orderBy: (i, { asc }) => [asc(i.sortOrder)],
        with: { attributes: true },
      },
      worksite:  true,
      requester: true,
    },
  })

  if (!request) notFound()

  const isOwner    = request.requesterId === session.user.id
  const hasViewAll = can(session, "servicios:view_all")
  const hasAccess  = hasViewAll || (isOwner && canAccessWorksite(session, request.worksiteId))
  if (!hasAccess) notFound()

  const [allWorksites, timelineEvents, quotationsRaw, _allSuppliers] = await Promise.all([
    db.select({ id: worksites.id, name: worksites.name })
      .from(worksites)
      .where(eq(worksites.isActive, true))
      .orderBy(asc(worksites.name)),

    db.select({
      id:         statusHistory.id,
      fromStatus: statusHistory.fromStatus,
      toStatus:   statusHistory.toStatus,
      changedBy:  statusHistory.changedBy,
      changedAt:  statusHistory.changedAt,
      reason:     statusHistory.reason,
      userName:   users.name,
      userEmail:  users.email,
    })
    .from(statusHistory)
    .leftJoin(users, eq(statusHistory.changedBy, users.id))
    .where(and(
      eq(statusHistory.entityType, "purchase_request"),
      eq(statusHistory.entityId, request.id),
    ))
    .orderBy(desc(statusHistory.changedAt)),

    db.query.serviceQuotations.findMany({
      where: eq(serviceQuotations.requestId, request.id),
      with: {
        supplier:      { columns: { id: true, name: true } },
        decidedByUser: { columns: { id: true, name: true } },
      },
      orderBy: (q, { asc }) => asc(q.createdAt),
    }),

    db.select({ id: suppliers.id, name: suppliers.name })
      .from(suppliers)
      .where(eq(suppliers.isActive, true))
      .orderBy(asc(suppliers.name)),
  ])

  const scopedWorksites = allWorksites.filter((w) => canAccessWorksite(session, w.id))
  const worksiteOptions = scopedWorksites.map((w) => ({ id: w.id, name: w.name }))

  // Build progress bar data (reuse shared component)
  const progress = buildRequestProgress(
    request.status,
    request.items.map((item) => ({
      id:            item.id,
      productName:   item.productNameFree ?? "Servicio solicitado",
      status:        item.status,
      quantity:      item.quantity,
      unitOfMeasure: item.unitOfMeasure,
    })),
  )

  // Map attributes back to item form fields
  const editItems = request.items.map((item) => {
    const attrMap = Object.fromEntries(
      item.attributes.map((a) => [a.attributeName, a.value])
    )
    return {
      id:            item.id,
      description:   item.productNameFree ?? "",
      location:      attrMap[SERVICE_ATTRIBUTE_NAMES.location]      ?? "",
      quantity:      item.quantity,
      unitOfMeasure: item.unitOfMeasure,
      sortOrder:     item.sortOrder,
      notes:         item.notes ?? "",
      equipmentName: attrMap[SERVICE_ATTRIBUTE_NAMES.equipmentName] ?? "",
      patent:        attrMap[SERVICE_ATTRIBUTE_NAMES.patent]        ?? "",
      brand:         attrMap[SERVICE_ATTRIBUTE_NAMES.brand]         ?? "",
      model:         attrMap[SERVICE_ATTRIBUTE_NAMES.model]         ?? "",
    }
  })

  const isEditable  = ["draft", "returned"].includes(request.status)
  const canEdit     = isOwner && isEditable
  const canUploadQ  = isOwner && isEditable
  const canApproveQ = can(session, "servicios:approve")

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

  return (
    <PageContainer width="form">
      <PageHeader
        title={`Solicitud ${request.code}`}
        description={`${request.worksite?.name ?? ""} · Servicios externos`}
        actions={<StateBadge state={request.status} entity="request" />}
        breadcrumb={
          <Breadcrumbs items={[
            { label: "Dashboard", href: "/dashboard" },
            { label: "Servicios", href: "/servicios" },
            { label: request.code },
          ]} />
        }
      />

      {/* Progress */}
      <RequestProgressPanel progress={progress} />

      {/* Quotation panel */}
      <ServiceQuotationPanel
        requestId={request.id}
        requestStatus={request.status}
        quotations={quotations}
        canUpload={canUploadQ}
        canApprove={canApproveQ}
      />

      {/* Items (editable if draft/returned and is owner; read-only otherwise) */}
      {canEdit ? (
        <ServiceForm
          worksites={worksiteOptions}
          editRequest={{
            id:            request.id,
            worksiteId:    request.worksiteId,
            urgency:       request.urgency,
            requiredDate:  request.requiredDate ?? "",
            justification: request.notes,
            items:         editItems,
          }}
        />
      ) : (
        <section className="rounded-[var(--radius-2xl)] bg-[var(--color-surface)] shadow-[var(--shadow-card)] p-6 space-y-4">
          <h2 className="text-sm font-semibold text-[var(--color-text)]">Servicios solicitados</h2>
          <ul className="space-y-3">
            {request.items.map((item, idx) => {
              const attrMap = Object.fromEntries(item.attributes.map((a) => [a.attributeName, a.value]))
              return (
                <li key={item.id} className="border border-[var(--color-border)] rounded-[var(--radius-xl)] p-4 space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-sm font-medium text-[var(--color-text)]">
                      {idx + 1}. {item.productNameFree ?? "Servicio"}
                    </span>
                    <span className="text-xs text-[var(--color-text-subtle)] tabular-nums shrink-0">
                      {item.quantity} {item.unitOfMeasure}
                    </span>
                  </div>
                  <dl className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-1 text-xs">
                    {attrMap[SERVICE_ATTRIBUTE_NAMES.location] && (
                      <div>
                        <dt className="text-[var(--color-text-subtle)]">Ubicación</dt>
                        <dd className="text-[var(--color-text-muted)]">{attrMap[SERVICE_ATTRIBUTE_NAMES.location]}</dd>
                      </div>
                    )}
                    {attrMap[SERVICE_ATTRIBUTE_NAMES.equipmentName] && (
                      <div>
                        <dt className="text-[var(--color-text-subtle)]">Equipo</dt>
                        <dd className="text-[var(--color-text-muted)]">{attrMap[SERVICE_ATTRIBUTE_NAMES.equipmentName]}</dd>
                      </div>
                    )}
                    {attrMap[SERVICE_ATTRIBUTE_NAMES.patent] && (
                      <div>
                        <dt className="text-[var(--color-text-subtle)]">Patente/Código</dt>
                        <dd className="text-[var(--color-text-muted)]">{attrMap[SERVICE_ATTRIBUTE_NAMES.patent]}</dd>
                      </div>
                    )}
                    {attrMap[SERVICE_ATTRIBUTE_NAMES.brand] && (
                      <div>
                        <dt className="text-[var(--color-text-subtle)]">Marca</dt>
                        <dd className="text-[var(--color-text-muted)]">{attrMap[SERVICE_ATTRIBUTE_NAMES.brand]}</dd>
                      </div>
                    )}
                    {attrMap[SERVICE_ATTRIBUTE_NAMES.model] && (
                      <div>
                        <dt className="text-[var(--color-text-subtle)]">Modelo</dt>
                        <dd className="text-[var(--color-text-muted)]">{attrMap[SERVICE_ATTRIBUTE_NAMES.model]}</dd>
                      </div>
                    )}
                    {item.notes && (
                      <div className="col-span-full">
                        <dt className="text-[var(--color-text-subtle)]">Observaciones</dt>
                        <dd className="text-[var(--color-text-muted)]">{item.notes}</dd>
                      </div>
                    )}
                  </dl>
                </li>
              )
            })}
          </ul>
        </section>
      )}

      {/* Timeline */}
      <EntityTimeline events={timelineEvents} entityType="request" />
    </PageContainer>
  )
}
