import type { Metadata } from "next"
import { notFound, redirect } from "next/navigation"
import { db } from "@/db"
import {
  purchaseRequests,
  worksites, costCenters, products, productAttributes,
} from "@/db/schema"
import { eq, asc } from "drizzle-orm"
import { requirePermission } from "@/lib/auth/can"
import { canAccessWorksite } from "@/lib/auth/can"
import { PageHeader, Breadcrumbs } from "@/components/ui/page-header"
import { StateBadge } from "@/components/states/state-badge"
import { RequestForm } from "../request-form"

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
      costCenter: true,
      requester:  true,
    },
  })

  if (!request) notFound()

  // Scope check: solicitantes see own; jefe/compras see their worksites; admin sees all
  const isOwner    = request.requesterId === session.user.id
  const hasViewAll = session.user.permissions.includes("requests:view_all")
  const hasAccess  = isOwner || hasViewAll || canAccessWorksite(session, request.worksiteId)
  if (!hasAccess) notFound()

  const [allWorksites, allProducts, allAttrs, allCcs] = await Promise.all([
    db.select().from(worksites).where(eq(worksites.isActive, true)).orderBy(asc(worksites.name)),
    db.select().from(products).where(eq(products.isActive, true)).orderBy(asc(products.name)),
    db.select().from(productAttributes).orderBy(asc(productAttributes.sortOrder)),
    db.select().from(costCenters).where(eq(costCenters.isActive, true)).orderBy(asc(costCenters.name)),
  ])

  const worksiteOptions = allWorksites
    .filter((w) => canAccessWorksite(session, w.id))
    .map((w) => ({
      id:          w.id,
      name:        w.name,
      costCenters: allCcs.filter((cc) => cc.worksiteId === w.id).map((cc) => ({ id: cc.id, name: cc.name })),
    }))

  const productOptions = allProducts.map((p) => ({
    id:             p.id,
    sku:            p.sku,
    name:           p.name,
    unitOfMeasure:  p.unitOfMeasure,
    categoryName:   p.categoryId,
    referencePrice: p.referencePrice,
    attributes:     allAttrs
      .filter((a) => a.productId === p.id)
      .map((a) => ({ id: a.id, name: a.name, type: a.type, isRequired: a.isRequired, options: a.options })),
  }))

  const editRequest = {
    id:           request.id,
    code:         request.code,
    worksiteId:   request.worksiteId,
    costCenterId: request.costCenterId,
    urgency:      request.urgency,
    status:       request.status,
    notes:        request.notes,
    items: request.items.map((item) => ({
      id:              item.id,
      productId:       item.productId,
      productNameFree: item.productNameFree,
      quantity:        item.quantity,
      unitOfMeasure:   item.unitOfMeasure,
      urgency:         item.urgency ?? "normal",
      requiredDate:    item.requiredDate,
      notes:           item.notes,
      attributes:      item.attributes.map((a) => ({
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
        actions={<StateBadge state={request.status} entity="request" />}
        breadcrumb={
          <Breadcrumbs items={[
            { label: "Dashboard",   href: "/dashboard"   },
            { label: "Solicitudes", href: "/solicitudes" },
            { label: request.code                        },
          ]} />
        }
      />
      <div className="max-w-3xl">
        <RequestForm
          worksites={worksiteOptions}
          products={productOptions}
          editRequest={editRequest}
        />
      </div>
    </>
  )
}
