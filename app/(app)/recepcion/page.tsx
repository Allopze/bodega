import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { db } from "@/db"
import {
  purchaseOrders, purchaseOrderItems, worksites, suppliers,
} from "@/db/schema"
import { and, eq, inArray, desc, count } from "drizzle-orm"
import { requirePermission, canAny } from "@/lib/auth/can"
import { worksiteScopeSql } from "@/lib/auth/scope"
import { PageHeader, Breadcrumbs } from "@/components/ui/page-header"
import { PageContainer } from "@/components/ui/page-container"
import { HeaderSignals, type HeaderSignal } from "@/components/ui/header-signals"
import { ServerPagination } from "@/components/ui/server-pagination"
import { buildPaginationHref, resolvePagination } from "@/lib/pagination"
import { parseListParams, buildListWhere } from "@/lib/operaciones/list-query"
import { RecepcionTable } from "./recepcion-table"

export const metadata: Metadata = { title: "Recepción" }

import { RECEPCION_PAGE_SIZE } from "@/lib/constants"

export default async function RecepcionPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  let session
  try { session = await requirePermission("receiving:view") }
  catch { redirect("/forbidden") }

  const sp = await searchParams
  const scopeFilter = and(
    inArray(purchaseOrders.status, ["sent", "partially_office_received", "office_received", "partially_received"]),
    worksiteScopeSql(session, purchaseOrders.worksiteId),
  )

  // URL-synced search & filters (server-side, so search finds records on any page)
  const listParams = parseListParams(sp)
  const where = buildListWhere({
    base:           scopeFilter,
    textColumns:    [purchaseOrders.code],
    query:          listParams.q,
    estados:        [],
    worksiteColumn: purchaseOrders.worksiteId,
    faena:          listParams.faena,
    supplierColumn: purchaseOrders.supplierId,
    proveedor:      listParams.proveedor,
  })

  const [totalRow] = await db
    .select({ total: count() })
    .from(purchaseOrders)
    .where(where)

  const pagination = resolvePagination({
    pageParam: sp.page,
    totalItems: totalRow?.total ?? 0,
    pageSize: RECEPCION_PAGE_SIZE,
  })

  const visible = await db
    .select({
      id:          purchaseOrders.id,
      code:        purchaseOrders.code,
      worksiteId:  purchaseOrders.worksiteId,
      supplierId:  purchaseOrders.supplierId,
      status:      purchaseOrders.status,
      sentAt:      purchaseOrders.sentAt,
      createdAt:   purchaseOrders.createdAt,
    })
    .from(purchaseOrders)
    .where(where)
    .orderBy(desc(purchaseOrders.sentAt))
    .limit(pagination.limit)
    .offset(pagination.offset)

  const pageHref = (page: number) => buildPaginationHref("/recepcion", sp, page)

  // Worksite options for the faena filter (scoped + active)
  const worksiteOptionRows = await db
    .select({ id: worksites.id, name: worksites.name })
    .from(worksites)
    .where(and(eq(worksites.isActive, true), worksiteScopeSql(session, worksites.id)))
  const worksiteOptions = worksiteOptionRows.map((w) => ({ value: w.id, label: w.name }))

  // Supplier options for the proveedor filter (active suppliers)
  const supplierOptionRows = await db
    .select({ id: suppliers.id, name: suppliers.name })
    .from(suppliers)
    .where(eq(suppliers.isActive, true))
    .orderBy(suppliers.name)
  const supplierOptions = supplierOptionRows.map((s) => ({ value: s.id, label: s.name }))

  const wsIds       = [...new Set(visible.map((o) => o.worksiteId))]
  const supplierIds = [...new Set(visible.map((o) => o.supplierId))]
  const orderIds    = visible.map((o) => o.id)

  const [wsRows, supplierRows, itemRows] = await Promise.all([
    wsIds.length > 0
      ? db.select({ id: worksites.id, name: worksites.name }).from(worksites).where(inArray(worksites.id, wsIds))
      : Promise.resolve([]),
    supplierIds.length > 0
      ? db.select({ id: suppliers.id, name: suppliers.name }).from(suppliers).where(inArray(suppliers.id, supplierIds))
      : Promise.resolve([]),
    orderIds.length > 0
      ? db.select({
          purchaseOrderId:        purchaseOrderItems.purchaseOrderId,
          quantityOfficeReceived: purchaseOrderItems.quantityOfficeReceived,
          quantityReceived:       purchaseOrderItems.quantityReceived,
        }).from(purchaseOrderItems).where(inArray(purchaseOrderItems.purchaseOrderId, orderIds))
      : Promise.resolve([]),
  ])

  const wsMap  = Object.fromEntries(wsRows.map((w) => [w.id, w.name]))
  const supMap = Object.fromEntries(supplierRows.map((s) => [s.id, s.name]))

  // Transit gap: how many items arrived at office but are still pending dispatch to faena.
  const gapMap: Record<string, number> = {}
  for (const it of itemRows) {
    if ((it.quantityOfficeReceived ?? 0) - (it.quantityReceived ?? 0) > 0) {
      gapMap[it.purchaseOrderId] = (gapMap[it.purchaseOrderId] ?? 0) + 1
    }
  }

  const canRegister = canAny(session, "receiving:register_office", "receiving:register_faena")

  const headerSignals: HeaderSignal[] = [
    { key: "to-receive", label: "Por recibir", value: totalRow?.total ?? 0 },
  ]

  return (
    <PageContainer>
      <PageHeader
        title="Recepción"
        description="Registra llegada a oficina Chome y posterior recepción en faena."
        breadcrumb={
          <Breadcrumbs items={[
            { label: "Dashboard", href: "/dashboard" },
            { label: "Recepción" },
          ]} />
        }
        headerActions={<HeaderSignals signals={headerSignals} />}
      />

      <RecepcionTable
        orders={visible}
        wsMap={wsMap}
        supMap={supMap}
        gapMap={gapMap}
        canRegister={canRegister}
        worksiteOptions={worksiteOptions}
        supplierOptions={supplierOptions}
      />
      <ServerPagination pagination={pagination} hrefForPage={pageHref} />
    </PageContainer>
  )
}
