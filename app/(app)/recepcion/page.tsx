import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { db } from "@/db"
import {
  purchaseOrders, purchaseOrderItems, worksites, suppliers, dispatchGuides, dispatchGuideItems,
} from "@/db/schema"
import { and, or, ilike, eq, inArray, desc, count, ne, sql } from "drizzle-orm"
import { requirePermission, can } from "@/lib/auth/can"
import { worksiteScopeSql } from "@/lib/auth/scope"
import { PageHeader, Breadcrumbs } from "@/components/ui/page-header"
import { ExportExcelButton } from "@/components/ui/export-excel-button"
import { PageContainer } from "@/components/ui/page-container"
import { ServerPagination } from "@/components/ui/server-pagination"
import { buildPaginationHref, resolvePagination } from "@/lib/pagination"
import { parseListParams, eqFilter, statusSql, worksiteEqSql } from "@/lib/adquisiciones/list-query"
import type { StageTab } from "@/components/ui/stage-tabs"
import {
  buildOcProgress, COMPLETED_RECEIPT_ORDER_STATUSES, RECEIVABLE_ORDER_STATUSES,
  type RequestProgress,
} from "@/lib/work-queue"
import type { OcActiveGuideStatus } from "@/lib/work-queue-builders"
import { officeWorksiteLabel } from "@/lib/services/dispatch-guides"
import { RecepcionTable, type ReceiptGuideRow } from "./recepcion-table"

export const metadata: Metadata = { title: "Recepción" }

import { RECEPCION_PAGE_SIZE } from "@/lib/constants"

/**
 * Las tres etapas de recepción; los parciales acompañan a la suya. La tab sin
 * valor agrupa toda la cola abierta y es la de por defecto: Recepción es una
 * cola de trabajo, y con "Todas" por defecto las OC ya completadas diluían lo
 * que sí falta recibir. El historial no se esconde — vive en "Completadas" y en
 * "Todas", que siguen siendo un clic.
 *
 * ADQ-10: antes la tab por defecto se llamaba "Por recibir" y la de al lado
 * "Pendiente de recepción": dos sinónimos a un clic de distancia, y la segunda
 * era un subconjunto de la primera. Ahora cada rótulo dice una cosa distinta y
 * los de etapa son los mismos nombres que lleva el badge de la fila (ver el
 * vocabulario canónico en `components/states/state-badge.tsx`).
 */
const ALL_STAGE_VALUE = [...RECEIVABLE_ORDER_STATUSES, ...COMPLETED_RECEIPT_ORDER_STATUSES].join(",")
const STAGE_GROUPS = [
  /** La tab sin valor: el defecto de la pantalla, y es la cola activa. */
  { value: "",                                          label: "Por atender" },
  { value: "sent",                                      label: "Pendiente de recepción" },
  { value: "partially_office_received,office_received", label: "En oficina o en traslado" },
  { value: "partially_received",                        label: "Llegó parcial a faena" },
  { value: COMPLETED_RECEIPT_ORDER_STATUSES.join(","),  label: "Completadas" },
  { value: ALL_STAGE_VALUE,                             label: "Todas" },
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
    inArray(purchaseOrders.status, [
      ...RECEIVABLE_ORDER_STATUSES,
      ...COMPLETED_RECEIPT_ORDER_STATUSES,
    ]),
    worksiteScopeSql(session, purchaseOrders.worksiteId),
  )

  // URL-synced search & filters (server-side, so search finds records on any page)
  const listParams = parseListParams(sp)
  // Sin `estado` en la URL, la lista es la cola activa: lo que todavía falta
  // recibir. Una OC completamente recibida sale de ahí y se consulta en
  // "Completadas" o "Todas" (`?estado=` vacío explícito no existe; la tab
  // "Todas" pasa `estado` con el conjunto completo).
  const estados = listParams.estados.length > 0 ? listParams.estados : [...RECEIVABLE_ORDER_STATUSES]

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
  // La lista reúne la bandeja activa y el historial terminado de Recepción;
  // las tabs eligen dentro de ambos conjuntos de estados. Sin tab elegida el
  // recorte es la cola activa (`estados`, resuelto arriba).
  const where = and(scopeWhere, statusSql(purchaseOrders.status, estados))

  const [[totalRow], stageCountRows] = await Promise.all([
    db.select({ total: count() }).from(purchaseOrders).where(where),
    db.select({ status: purchaseOrders.status, total: count() }).from(purchaseOrders).where(scopeWhere).groupBy(purchaseOrders.status),
  ])
  const countByStatus = Object.fromEntries(stageCountRows.map((row) => [row.status, row.total]))
  // La tab sin valor ("Por atender") cuenta la cola activa, no el total: es el
  // defecto de la pantalla, y anunciar el total ahí prometía filas que su propio
  // recorte no entrega.
  const countFor = (value: string) => (value || ALL_STAGE_VALUE)
    .split(",")
    .reduce((sum, status) => sum + (countByStatus[status] ?? 0), 0)
  const stageTabs: StageTab[] = STAGE_GROUPS.map((group) => ({
    value: group.value,
    label: group.label,
    count: group.value === "" ? countFor(RECEIVABLE_ORDER_STATUSES.join(",")) : countFor(group.value),
  }))

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

  const [wsRows, supplierRows, itemRows, guideRows, officeName] = await Promise.all([
    wsIds.length > 0
      ? db.select({ id: worksites.id, name: worksites.name }).from(worksites).where(inArray(worksites.id, wsIds))
      : Promise.resolve([]),
    supplierIds.length > 0
      ? db.select({ id: suppliers.id, name: suppliers.name }).from(suppliers).where(inArray(suppliers.id, supplierIds))
      : Promise.resolve([]),
    orderIds.length > 0
      ? db.select({
          id:               purchaseOrderItems.id,
          purchaseOrderId:  purchaseOrderItems.purchaseOrderId,
          quantity:         purchaseOrderItems.quantity,
          quantityReceived: purchaseOrderItems.quantityReceived,
        }).from(purchaseOrderItems).where(inArray(purchaseOrderItems.purchaseOrderId, orderIds))
      : Promise.resolve([]),
    orderIds.length > 0
      ? db.select({
          purchaseOrderId: dispatchGuides.purchaseOrderId,
          id: dispatchGuides.id,
          code: dispatchGuides.code,
          status: dispatchGuides.status,
          totalQuantity: sql<number>`coalesce(sum(${dispatchGuideItems.quantity}), 0)`,
          receivedQuantity: sql<number>`coalesce(sum(${dispatchGuideItems.quantityReceived}), 0)`,
        })
          .from(dispatchGuides)
          .leftJoin(dispatchGuideItems, eq(dispatchGuideItems.guideId, dispatchGuides.id))
          .where(and(
            inArray(dispatchGuides.purchaseOrderId, orderIds),
            ne(dispatchGuides.status, "cancelled"),
          ))
          .groupBy(dispatchGuides.id, dispatchGuides.purchaseOrderId, dispatchGuides.code, dispatchGuides.status)
      : Promise.resolve([]),
    officeWorksiteLabel(),
  ])

  const wsMap  = Object.fromEntries(wsRows.map((w) => [w.id, w.name]))
  const supMap = Object.fromEntries(supplierRows.map((s) => [s.id, s.name]))

  const guideMap: Record<string, ReceiptGuideRow[]> = {}
  for (const guide of guideRows) {
    if (!guide.purchaseOrderId) continue
    const summary: ReceiptGuideRow = {
      id: guide.id,
      code: guide.code,
      status: guide.status,
      totalQuantity: Number(guide.totalQuantity),
      receivedQuantity: Number(guide.receivedQuantity),
    }
    guideMap[guide.purchaseOrderId] = [...(guideMap[guide.purchaseOrderId] ?? []), summary]
  }

  // Etapa y «qué falta» de cada OC de la página: una sola consulta de ítems
  // para todas (arriba), sin N+1. El texto es impersonal a propósito: nombra el
  // paso pendiente, no a quién le toca.
  const itemsByOrder: Record<string, { id: string; productName: string; quantity: number; unitOfMeasure: string; quantityReceived: number }[]> = {}
  for (const it of itemRows) {
    ;(itemsByOrder[it.purchaseOrderId] ??= []).push({
      id: it.id,
      productName: "",
      quantity: Number(it.quantity ?? 0),
      unitOfMeasure: "",
      quantityReceived: Number(it.quantityReceived ?? 0),
    })
  }
  const progressMap: Record<string, RequestProgress | null> = {}
  for (const order of visible) {
    const liveGuide = (guideMap[order.id] ?? []).find((guide) =>
      ["draft", "dispatched", "partially_received"].includes(guide.status),
    )
    progressMap[order.id] = buildOcProgress(order.status, itemsByOrder[order.id] ?? [], "recepcion", {
      activeGuideStatus: (liveGuide?.status as OcActiveGuideStatus | undefined) ?? null,
    })
  }

  const canOffice = can(session, "receiving:register_office")
  const canFaena = can(session, "receiving:register_faena")

  return (
    <PageContainer>
      <PageHeader
        title="Recepción"
        description="Órdenes de compra emitidas con mercadería por recibir. Las completadas salen de la cola y se consultan en su tab."
        breadcrumb={
          <Breadcrumbs items={[
            { label: "Inicio", href: "/dashboard" },
            { label: "Recepción" },
          ]} />
        }
        // ADQ-10 / A5: el chip «N Por recibir» repetía el contador de la tab «Por
        // atender» (misma cifra, dos controles). El número vive sólo en la tab.
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
        progressMap={progressMap}
        guideMap={guideMap}
        canOffice={canOffice}
        canFaena={canFaena}
        officeName={officeName}
        worksiteOptions={worksiteOptions}
        supplierOptions={supplierOptions}
        stageTabs={stageTabs}
      />
      <ServerPagination pagination={pagination} hrefForPage={pageHref} />
    </PageContainer>
  )
}
