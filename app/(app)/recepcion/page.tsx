import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { db } from "@/db"
import {
  purchaseOrders, purchaseOrderItems, worksites, suppliers,
} from "@/db/schema"
import { and, or, ilike, eq, inArray, desc, count, sql } from "drizzle-orm"
import { requirePermission, can } from "@/lib/auth/can"
import { worksiteScopeSql } from "@/lib/auth/scope"
import { PageHeader, Breadcrumbs } from "@/components/ui/page-header"
import { ExportExcelButton } from "@/components/adquisiciones/export-excel-button"
import { PageContainer } from "@/components/ui/page-container"
import { HeaderSignals, type HeaderSignal } from "@/components/ui/header-signals"
import { ServerPagination } from "@/components/ui/server-pagination"
import { buildPaginationHref, resolvePagination } from "@/lib/pagination"
import { parseListParams, eqFilter, statusSql, worksiteEqSql } from "@/lib/adquisiciones/list-query"
import type { StageTab } from "@/components/adquisiciones/stage-tabs"
import { RECEIVABLE_ORDER_STATUSES } from "@/lib/work-queue"
import { RecepcionTable } from "./recepcion-table"

export const metadata: Metadata = { title: "Recepción" }

import { RECEPCION_PAGE_SIZE } from "@/lib/constants"

/** Las tres etapas de recepción; los parciales acompañan a la suya. */
const STAGE_GROUPS = [
  { value: "sent",                                      label: "Pendiente de recepción" },
  { value: "partially_office_received,office_received", label: "Recibido en oficina" },
  { value: "partially_received",                        label: "Recibido en faena (parcial)" },
] as const

function escapeLikeLocal(value: string) {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`)
}

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
    inArray(purchaseOrders.status, RECEIVABLE_ORDER_STATUSES),
    worksiteScopeSql(session, purchaseOrders.worksiteId),
  )

  // URL-synced search & filters (server-side, so search finds records on any page)
  const listParams = parseListParams(sp)

  // Extended text search: match OC code OR supplier name via EXISTS subquery.
  const q = listParams.q.trim()
  const likePattern = q ? `%${escapeLikeLocal(q)}%` : null
  const textCondition = likePattern
    ? or(
        ilike(purchaseOrders.code, likePattern),
        sql`EXISTS (SELECT 1 FROM suppliers s WHERE s.id = ${purchaseOrders.supplierId} AND s.name ILIKE ${likePattern})`,
      )
    : undefined

  const scopeWhere = and(
    scopeFilter,
    textCondition,
    worksiteEqSql(purchaseOrders.worksiteId, listParams.faena),
    eqFilter(purchaseOrders.supplierId, listParams.proveedor),
  )
  // La lista ya está acotada a los estados recibibles; las tabs eligen dentro
  // de ellos, así que un `estado` fuera de ese conjunto no entrega nada.
  const where = and(scopeWhere, statusSql(purchaseOrders.status, listParams.estados))

  const [[totalRow], stageCountRows] = await Promise.all([
    db.select({ total: count() }).from(purchaseOrders).where(where),
    db.select({ status: purchaseOrders.status, total: count() }).from(purchaseOrders).where(scopeWhere).groupBy(purchaseOrders.status),
  ])
  const countByStatus = Object.fromEntries(stageCountRows.map((row) => [row.status, row.total]))
  const stageTabs: StageTab[] = [
    { value: "", label: "Todas", count: stageCountRows.reduce((sum, row) => sum + row.total, 0) },
    ...STAGE_GROUPS.map((group) => ({
      value: group.value,
      label: group.label,
      count: group.value.split(",").reduce((sum, status) => sum + (countByStatus[status] ?? 0), 0),
    })),
  ]

  const pagination = resolvePagination({
    pageParam: sp.page,
    totalItems: totalRow?.total ?? 0,
    pageSize: RECEPCION_PAGE_SIZE,
  })

  // ARQ-10: las 3 sólo cuelgan del scope/filtro y de `pagination` (ya
  // resuelta arriba) — ninguna depende del resultado de otra.
  const [visible, worksiteOptionRows, supplierOptionRows] = await Promise.all([
    db
      .select({
        id:          purchaseOrders.id,
        code:        purchaseOrders.code,
        worksiteId:  purchaseOrders.worksiteId,
        supplierId:  purchaseOrders.supplierId,
        status:      purchaseOrders.status,
        deliveryMode: purchaseOrders.deliveryMode,
        sentAt:      purchaseOrders.sentAt,
        createdAt:   purchaseOrders.createdAt,
      })
      .from(purchaseOrders)
      .where(where)
      .orderBy(desc(purchaseOrders.sentAt))
      .limit(pagination.limit)
      .offset(pagination.offset),
    // Worksite options for the faena filter (scoped + active)
    db
      .select({ id: worksites.id, name: worksites.name })
      .from(worksites)
      .where(and(eq(worksites.isActive, true), worksiteScopeSql(session, worksites.id))),
    // Supplier options for the proveedor filter (active suppliers)
    db
      .select({ id: suppliers.id, name: suppliers.name })
      .from(suppliers)
      .where(eq(suppliers.isActive, true))
      .orderBy(suppliers.name),
  ])

  const pageHref = (page: number) => buildPaginationHref("/recepcion", sp, page)
  const worksiteOptions = worksiteOptionRows.map((w) => ({ value: w.id, label: w.name }))
  const supplierOptions = supplierOptionRows.map((s) => ({ value: s.id, label: s.name }))
  const worksiteScopeLabel = worksiteOptions.find((worksite) => worksite.value === listParams.faena)?.label
    ?? "todas las faenas permitidas"

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

  const canOffice = can(session, "receiving:register_office")
  const canFaena = can(session, "receiving:register_faena")

  const headerSignals: HeaderSignal[] = [
    { key: "to-receive", label: "Por recibir", value: stageCountRows.reduce((sum, row) => sum + row.total, 0) },
  ]

  return (
    <PageContainer>
      <PageHeader
        title="Recepción"
        description="Registra llegada a oficina Chome y posterior recepción en faena."
        breadcrumb={
          <Breadcrumbs items={[
            { label: "Inicio", href: "/dashboard" },
            { label: "Recepción" },
          ]} />
        }
        headerActions={<HeaderSignals signals={headerSignals} />}
        // A-18: la exportación va en el top bar, igual que en compras y solicitudes.
        actions={<ExportExcelButton tipo="recepcion" />}
      />
      <p className="mb-3 text-xs text-(--color-text-subtle)" aria-live="polite">
        Alcance de faena: <span className="font-medium text-(--color-text-muted)">{worksiteScopeLabel}</span>
      </p>

      <RecepcionTable
        orders={visible}
        wsMap={wsMap}
        supMap={supMap}
        gapMap={gapMap}
        canOffice={canOffice}
        canFaena={canFaena}
        worksiteOptions={worksiteOptions}
        supplierOptions={supplierOptions}
        stageTabs={stageTabs}
      />
      <ServerPagination pagination={pagination} hrefForPage={pageHref} />
    </PageContainer>
  )
}
