import type { Metadata } from "next"
import { redirect }       from "next/navigation"
import { db }             from "@/db"
import {
  purchaseRequests, purchaseRequestItems, requestItemAttributes,
  worksites, costCenters, users as usersTable, products,
} from "@/db/schema"
import { eq, and, inArray, asc } from "drizzle-orm"
import { requirePermission } from "@/lib/auth/can"
import { canAccessWorksite }  from "@/lib/auth/can"
import { PageHeader, Breadcrumbs } from "@/components/ui/page-header"
import { ApprovalPanel } from "./approval-panel"
import type { ApprovalItem, ApprovalRequest } from "./approval-panel"

export const metadata: Metadata = { title: "Aprobaciones" }

export default async function AprobacionesPage() {
  let session
  try { session = await requirePermission("approvals:approve_faena") }
  catch { redirect("/dashboard") }

  // Load all submitted/in-review requests
  const allRequests = await db
    .select({
      id:           purchaseRequests.id,
      code:         purchaseRequests.code,
      worksiteId:   purchaseRequests.worksiteId,
      costCenterId: purchaseRequests.costCenterId,
      urgency:      purchaseRequests.urgency,
      status:       purchaseRequests.status,
      requesterId:  purchaseRequests.requesterId,
      submittedAt:  purchaseRequests.submittedAt,
    })
    .from(purchaseRequests)
    .where(inArray(purchaseRequests.status, ["submitted", "in_review", "partially_approved"]))
    .orderBy(asc(purchaseRequests.submittedAt))

  // Scope to worksites this approver can access
  const visible = allRequests.filter((r) => canAccessWorksite(session, r.worksiteId))

  if (visible.length === 0) {
    return (
      <>
        <PageHeader
          title="Aprobaciones"
          description="Revisión y aprobación de ítems solicitados por faena."
          breadcrumb={
            <Breadcrumbs items={[
              { label: "Dashboard", href: "/dashboard" },
              { label: "Aprobaciones" },
            ]} />
          }
        />
        <ApprovalPanel requests={[]} />
      </>
    )
  }

  const requestIds   = visible.map((r) => r.id)
  const wsIds        = [...new Set(visible.map((r) => r.worksiteId))]
  const ccIds        = [...new Set(visible.map((r) => r.costCenterId).filter(Boolean))] as string[]
  const requesterIds = [...new Set(visible.map((r) => r.requesterId))]

  // Load pending items first so we can load their attributes in one shot
  const pendingItems = await db
    .select({
      id:              purchaseRequestItems.id,
      requestId:       purchaseRequestItems.requestId,
      productId:       purchaseRequestItems.productId,
      productNameFree: purchaseRequestItems.productNameFree,
      quantity:        purchaseRequestItems.quantity,
      unitOfMeasure:   purchaseRequestItems.unitOfMeasure,
      urgency:         purchaseRequestItems.urgency,
      requiredDate:    purchaseRequestItems.requiredDate,
      notes:           purchaseRequestItems.notes,
      status:          purchaseRequestItems.status,
      sortOrder:       purchaseRequestItems.sortOrder,
    })
    .from(purchaseRequestItems)
    .where(
      and(
        inArray(purchaseRequestItems.requestId, requestIds),
        eq(purchaseRequestItems.status, "requested"),
      ),
    )
    .orderBy(asc(purchaseRequestItems.sortOrder))

  const pendingItemIds = pendingItems.map((i) => i.id)

  // Batch load everything else in parallel
  const [allAttrs, wsRows, ccRows, requesterRows, productRows] = await Promise.all([
    pendingItemIds.length > 0
      ? db
          .select({
            requestItemId: requestItemAttributes.requestItemId,
            attributeName: requestItemAttributes.attributeName,
            value:         requestItemAttributes.value,
          })
          .from(requestItemAttributes)
          .where(inArray(requestItemAttributes.requestItemId, pendingItemIds))
      : Promise.resolve([]),

    db
      .select({ id: worksites.id, name: worksites.name })
      .from(worksites)
      .where(inArray(worksites.id, wsIds)),

    ccIds.length > 0
      ? db
          .select({ id: costCenters.id, name: costCenters.name })
          .from(costCenters)
          .where(inArray(costCenters.id, ccIds))
      : Promise.resolve([]),

    requesterIds.length > 0
      ? db
          .select({ id: usersTable.id, name: usersTable.name })
          .from(usersTable)
          .where(inArray(usersTable.id, requesterIds))
      : Promise.resolve([]),

    db
      .select({ id: products.id, sku: products.sku, name: products.name })
      .from(products),
  ])

  // Build lookup maps
  const wsMap      = Object.fromEntries(wsRows.map((w) => [w.id, w.name]))
  const ccMap      = Object.fromEntries(ccRows.map((c) => [c.id, c.name]))
  const userMap    = Object.fromEntries(requesterRows.map((u) => [u.id, u.name]))
  const productMap = Object.fromEntries(productRows.map((p) => [p.id, p]))
  const attrsMap: Record<string, { attributeName: string; value: string }[]> = {}
  for (const a of allAttrs) {
    if (!attrsMap[a.requestItemId]) attrsMap[a.requestItemId] = []
    attrsMap[a.requestItemId].push({ attributeName: a.attributeName, value: a.value })
  }

  // Group items by request
  const itemsByRequest: Record<string, typeof pendingItems> = {}
  for (const item of pendingItems) {
    if (!itemsByRequest[item.requestId]) itemsByRequest[item.requestId] = []
    itemsByRequest[item.requestId].push(item)
  }

  // Build typed request rows — only requests with at least one pending item
  const rows: ApprovalRequest[] = visible
    .filter((r) => (itemsByRequest[r.id]?.length ?? 0) > 0)
    .map((r): ApprovalRequest => {
      const items = itemsByRequest[r.id] ?? []
      const mappedItems: ApprovalItem[] = items.map((item): ApprovalItem => {
        const product = item.productId ? productMap[item.productId] : null
        return {
          id:            item.id,
          productName:   product?.name ?? item.productNameFree ?? "(sin nombre)",
          productSku:    product?.sku ?? null,
          quantity:      item.quantity,
          unitOfMeasure: item.unitOfMeasure,
          urgency:       item.urgency ?? "normal",
          requiredDate:  item.requiredDate,
          notes:         item.notes,
          status:        item.status,
          attributes:    attrsMap[item.id] ?? [],
        }
      })
      return {
        id:             r.id,
        code:           r.code,
        worksiteName:   wsMap[r.worksiteId]   ?? r.worksiteId,
        costCenterName: r.costCenterId ? (ccMap[r.costCenterId] ?? null) : null,
        requesterName:  userMap[r.requesterId] ?? r.requesterId,
        requestUrgency: r.urgency,
        submittedAt:    r.submittedAt,
        pendingItems:   mappedItems,
        pendingCount:   mappedItems.length,
      }
    })

  const totalPending = rows.reduce((n, r) => n + r.pendingCount, 0)

  return (
    <>
      <PageHeader
        title="Aprobaciones"
        description={
          rows.length > 0
            ? `${totalPending} ítem${totalPending !== 1 ? "s" : ""} pendiente${totalPending !== 1 ? "s" : ""} de revisión`
            : "Revisión y aprobación de ítems solicitados por faena."
        }
        breadcrumb={
          <Breadcrumbs items={[
            { label: "Dashboard",    href: "/dashboard" },
            { label: "Aprobaciones" },
          ]} />
        }
      />
      <ApprovalPanel requests={rows} />
    </>
  )
}
