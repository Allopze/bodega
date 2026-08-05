import type { Metadata } from "next"
import { redirect }       from "next/navigation"
import { db }             from "@/db"
import {
  purchaseRequests, purchaseRequestItems, requestItemAttributes,
  worksites, users as usersTable, products, suppliers,
} from "@/db/schema"
import { eq, and, inArray, asc, sql, count } from "drizzle-orm"
import { requirePermission } from "@/lib/auth/can"
import { approvalQueueFilter } from "@/lib/approvals-queue"
import { isGlobalRole, visibleWorksiteIds } from "@/lib/auth/scope"
import { PageHeader, Breadcrumbs } from "@/components/ui/page-header"
import { PageContainer } from "@/components/ui/page-container"
import { ServerPagination } from "@/components/ui/server-pagination"
import { buildPaginationHref, resolvePagination } from "@/lib/pagination"
import { parseListParams, textSearchSql, eqFilter, worksiteEqSql } from "@/lib/adquisiciones/list-query"
import type { FilterOption } from "@/components/adquisiciones/list-filters"
import { ApprovalPanel } from "./approval-panel"
import { canApproveEpp, canSetDispatch } from "./roles"
import type { ApprovalItem, ApprovalRequest } from "./types"
import { getOperationalAssignmentRecords } from "@/lib/services/operational-assignments"
import { buildOperationalWorkItem, operationalAssignmentKey } from "@/lib/services/operational-work-queue"

export const metadata: Metadata = { title: "Aprobaciones" }

import { APPROVAL_REQUESTS_PAGE_SIZE } from "@/lib/constants"

export default async function AprobacionesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  let session
  try { session = await requirePermission("approvals:approve") }
  catch { redirect("/forbidden") }
  const canAssignWork = session.user.permissions.includes("operations:assign_work")
  const sp = await searchParams
  const listParams = parseListParams(sp)
  const selectedRequestId = typeof sp.solicitud === "string" ? sp.solicitud : ""
  const visibleWsIds = visibleWorksiteIds(session)
  const requestFilter = and(
    // Predicado base compartido con el badge del rail (lib/approvals-queue.ts).
    approvalQueueFilter({ isGlobal: isGlobalRole(session), worksiteIds: visibleWsIds }),
    selectedRequestId ? eq(purchaseRequests.id, selectedRequestId) : undefined,
    // URL-synced filters
    textSearchSql(listParams.q, [purchaseRequests.code]),
    worksiteEqSql(purchaseRequests.worksiteId, listParams.faena),
    eqFilter(purchaseRequests.urgency, listParams.urgencia),
  )

  const [totalRequestsRow] = await db
    .select({ total: count() })
    .from(purchaseRequests)
    .where(requestFilter)
  const pagination = resolvePagination({
    pageParam: sp.page,
    totalItems: totalRequestsRow?.total ?? 0,
    pageSize: APPROVAL_REQUESTS_PAGE_SIZE,
  })
  const pageHref = (page: number) => buildPaginationHref("/aprobaciones", sp, page)

  // Worksite options for the faena filter (active, scoped)
  const worksiteOptionRows = await db
    .select({ id: worksites.id, name: worksites.name })
    .from(worksites)
    .where(and(
      eq(worksites.isActive, true),
      isGlobalRole(session)
        ? undefined
        : visibleWsIds.length > 0 ? inArray(worksites.id, visibleWsIds) : sql`false`,
    ))
    .orderBy(worksites.name)
  const worksiteOptions: FilterOption[] = worksiteOptionRows.map((w) => ({ value: w.id, label: w.name }))

  // Load only submitted/in-review requests in the approver's worksite scope.
  const visible = await db
    .select({
      id:           purchaseRequests.id,
      code:         purchaseRequests.code,
      worksiteId:   purchaseRequests.worksiteId,
      urgency:      purchaseRequests.urgency,
      requestType:  purchaseRequests.requestType,
      status:       purchaseRequests.status,
      requesterId:  purchaseRequests.requesterId,
      submittedAt:  purchaseRequests.submittedAt,
      deliveryMode: purchaseRequests.deliveryMode,
    })
    .from(purchaseRequests)
    .where(requestFilter)
    .orderBy(asc(purchaseRequests.submittedAt))
    .limit(pagination.limit)
    .offset(pagination.offset)

  if (visible.length === 0) {
    return (
      <PageContainer>
        <PageHeader
          title="Aprobaciones"
          description="Revisión y aprobación de ítems solicitados por faena."
          breadcrumb={
            <Breadcrumbs items={[
              { label: "Inicio", href: "/dashboard" },
              { label: "Aprobaciones" },
            ]} />
          }
        />
        <ApprovalPanel requests={[]} canApproveEpp={false} canSetDispatch={false} canAssignWork={canAssignWork} worksiteOptions={worksiteOptions} />
        <ServerPagination pagination={pagination} hrefForPage={pageHref} />
      </PageContainer>
    )
  }

  const requestIds   = visible.map((r) => r.id)
  const wsIds        = [...new Set(visible.map((r) => r.worksiteId))]
  const requesterIds = [...new Set(visible.map((r) => r.requesterId))]

  // Load pending items first so we can load their attributes in one shot
  const pendingItems = await db
    .select({
      id:                  purchaseRequestItems.id,
      requestId:           purchaseRequestItems.requestId,
      productId:           purchaseRequestItems.productId,
      productNameFree:     purchaseRequestItems.productNameFree,
      quantity:            purchaseRequestItems.quantity,
      unitOfMeasure:       purchaseRequestItems.unitOfMeasure,
      urgency:             purchaseRequestItems.urgency,
      requiredDate:        purchaseRequestItems.requiredDate,
      notes:               purchaseRequestItems.notes,
      status:              purchaseRequestItems.status,
      createdAt:           purchaseRequestItems.createdAt,
      sortOrder:           purchaseRequestItems.sortOrder,
      suggestedSupplierId: purchaseRequestItems.suggestedSupplierId,
      supplierHint:        purchaseRequestItems.supplierHint,
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
  const productIds = [...new Set(pendingItems.flatMap((i) => i.productId ? [i.productId] : []))]
  const supplierIds = [...new Set(pendingItems.flatMap((i) => i.suggestedSupplierId ? [i.suggestedSupplierId] : []))]

  // Batch load everything else in parallel
  const worksiteByRequestId = new Map(visible.map((request) => [request.id, request.worksiteId]))
  const [allAttrs, wsRows, requesterRows, productRows, supplierRows, assignmentRecords] = await Promise.all([
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

    requesterIds.length > 0
      ? db
          .select({ id: usersTable.id, name: usersTable.name })
          .from(usersTable)
          .where(inArray(usersTable.id, requesterIds))
      : Promise.resolve([]),

    productIds.length > 0
      ? db
          .select({ id: products.id, sku: products.sku, name: products.name })
          .from(products)
          .where(inArray(products.id, productIds))
      : Promise.resolve([]),

    supplierIds.length > 0
      ? db
          .select({ id: suppliers.id, name: suppliers.name })
          .from(suppliers)
          .where(inArray(suppliers.id, supplierIds))
      : Promise.resolve([]),

    canAssignWork
      ? getOperationalAssignmentRecords(
          pendingItems.flatMap((item) => {
            const worksiteId = worksiteByRequestId.get(item.requestId)
            return worksiteId ? [{
              sourceType: "purchase_request_item" as const,
              sourceId: item.id,
              actionKey: "approve" as const,
              worksiteId,
            }] : []
          }),
          session,
        )
      : Promise.resolve(new Map()),
  ])

  // Build lookup maps
  const wsMap       = Object.fromEntries(wsRows.map((w) => [w.id, w.name]))
  const userMap     = Object.fromEntries(requesterRows.map((u) => [u.id, u.name]))
  const productMap  = Object.fromEntries(productRows.map((p) => [p.id, p]))
  const supplierMap = Object.fromEntries(supplierRows.map((s) => [s.id, s.name]))
  const attrsMap: Record<string, { attributeName: string; value: string }[]> = {}
  for (const a of allAttrs) {
    ;(attrsMap[a.requestItemId] ??= []).push({ attributeName: a.attributeName, value: a.value })
  }

  // Group items by request
  const itemsByRequest: Record<string, typeof pendingItems> = {}
  for (const item of pendingItems) {
    ;(itemsByRequest[item.requestId] ??= []).push(item)
  }

  // Build typed request rows — only requests with at least one pending item
  const rows: ApprovalRequest[] = visible.reduce<ApprovalRequest[]>((result, r) => {
      const items = itemsByRequest[r.id] ?? []
      if (items.length === 0) return result
      const mappedItems: ApprovalItem[] = items.map((item): ApprovalItem => {
        const product = item.productId ? productMap[item.productId] : null
        return {
          id:                    item.id,
          productName:           product?.name ?? item.productNameFree ?? "(sin nombre)",
          productSku:            product?.sku ?? null,
          quantity:              item.quantity,
          unitOfMeasure:         item.unitOfMeasure,
          urgency:               item.urgency ?? "normal",
          requiredDate:          item.requiredDate,
          notes:                 item.notes,
          status:                item.status,
          attributes:            attrsMap[item.id] ?? [],
          suggestedSupplierName: item.suggestedSupplierId ? supplierMap[item.suggestedSupplierId] : null,
          supplierHint:          item.supplierHint,
          operationalItem: canAssignWork
            ? buildOperationalWorkItem({
                sourceType: "purchase_request_item",
                sourceId: item.id,
                actionKey: "approve",
                module: "aprobaciones",
                code: r.code,
                title: `Aprobar ${product?.name ?? item.productNameFree ?? "ítem solicitado"}`,
                subtitle: `${r.code} · ${wsMap[r.worksiteId] ?? r.worksiteId}`,
                worksiteId: r.worksiteId,
                worksiteName: wsMap[r.worksiteId] ?? r.worksiteId,
                status: item.status,
                statusLabel: "Necesita aprobación",
                priority: item.urgency === "critical" ? "critical" : item.urgency === "high" ? "high" : "normal",
                blocked: false,
                createdAt: item.createdAt,
                sourceDueAt: item.requiredDate,
                href: `/aprobaciones?solicitud=${r.id}`,
                ctaLabel: "Aprobar o devolver",
                assignable: true,
              }, assignmentRecords.get(operationalAssignmentKey("purchase_request_item", item.id, "approve")))
            : undefined,
        }
      })
      result.push({
        id:             r.id,
        code:           r.code,
        requestType:    r.requestType,
        worksiteId:     r.worksiteId,
        worksiteName:   wsMap[r.worksiteId]   ?? r.worksiteId,
        requesterName:  userMap[r.requesterId] ?? r.requesterId,
        requestUrgency: r.urgency,
        submittedAt:    r.submittedAt,
        deliveryMode:   r.deliveryMode as "via_oficina" | "directo_faena",
        pendingItems:   mappedItems,
        pendingCount:   mappedItems.length,
      })
      return result
    }, [])

  const displayedRows = rows
  const totalPending = displayedRows.reduce((n, r) => n + r.pendingCount, 0)
  const uniqueFaenas = new Set(displayedRows.map((r) => r.worksiteName)).size

  function buildDescription() {
    if (displayedRows.length === 0) return "Revisión y aprobación de ítems solicitados por faena."
    const items = `${totalPending} ítem${totalPending !== 1 ? "s" : ""}`
    const reqs  = `${displayedRows.length} solicitud${displayedRows.length !== 1 ? "es" : ""}`
    const faenas = uniqueFaenas > 1 ? ` de ${uniqueFaenas} faenas` : ""
    return `${items} en ${reqs}${faenas}`
  }

  return (
    <PageContainer>
      <PageHeader
        title="Aprobaciones"
        description={buildDescription()}
        breadcrumb={
          <Breadcrumbs items={[
            { label: "Inicio",    href: "/dashboard" },
            { label: "Aprobaciones" },
          ]} />
        }
      />
      <ApprovalPanel
        requests={displayedRows}
        // Fuente única de verdad compartida con el backend (./roles) — evita H-1.
        canApproveEpp={canApproveEpp(session.user.roles)}
        canSetDispatch={canSetDispatch(session.user.roles)}
        canAssignWork={canAssignWork}
        worksiteOptions={worksiteOptions}
      />
      <ServerPagination pagination={pagination} hrefForPage={pageHref} />
    </PageContainer>
  )
}
