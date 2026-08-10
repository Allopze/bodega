import type { Metadata } from "next"
import Link from "next/link"
import { redirect } from "next/navigation"
import { db }       from "@/db"
import {
  purchaseOrders, purchaseOrderItems, purchaseOrderInvoices,
  worksites, suppliers,
  purchaseRequests,
} from "@/db/schema"
import { and, or, ilike, inArray, count, desc, eq, sql } from "drizzle-orm"
import { requirePermission } from "@/lib/auth/can"
import { can } from "@/lib/auth/can"
import { isGlobalRole, visibleWorksiteIds } from "@/lib/auth/scope"
import { PageHeader, Breadcrumbs } from "@/components/ui/page-header"
import { PageContainer } from "@/components/ui/page-container"
import { HeaderSignals, type HeaderSignal } from "@/components/ui/header-signals"
import { ServerPagination } from "@/components/ui/server-pagination"
import { buildPaginationHref, resolvePagination } from "@/lib/pagination"
import { parseListParams, periodSql, statusSql, eqFilter, worksiteEqSql } from "@/lib/adquisiciones/list-query"
import { INVOICE_DUE_ORDER_STATUSES } from "@/lib/work-queue"
import { orderHasNoInvoice } from "@/lib/services/operational-work-queue"
import type { StageTab } from "@/components/adquisiciones/stage-tabs"
import { comprasInboxSql } from "./list-scope"
import { ComprasActions } from "./compras-actions"
import { OcList } from "./oc-list"
import type { OcRow } from "./oc-list"
import { PendingPurchaseList } from "./pending-purchase-list"
import {
  countPendingPurchaseItems, countPendingPurchaseRequests, listPendingPurchaseRequests,
} from "@/lib/services/purchasing"

export const metadata: Metadata = { title: "Compras" }

import { ORDERS_PAGE_SIZE, PENDING_PURCHASE_PAGE_SIZE } from "@/lib/constants"

/**
 * Etapas visibles del ciclo de una OC (A5: el estado se representa una sola vez,
 * aquí). Compras tiene tres: antes de emitir, después de emitir, y anulada.
 *
 * Las etapas de recepción se agrupan bajo "Emitidas" en vez de tener una tab
 * cada una: eran las mismas etiquetas que las tabs de /recepcion —"Pendiente de
 * recepción" era literalmente el mismo string— con los mismos conteos, así que
 * Compras se leía como una segunda bandeja de recepción. Lo que le queda a
 * Compras sobre una OC emitida no es recibirla: es anularla mientras aún no
 * llegue nada, y perseguir su factura. La etapa exacta sigue visible en la
 * columna Estado, que es donde el usuario la busca fila por fila.
 *
 * `received` entra en el grupo por el filtro de factura pendiente, el único
 * modo en que una OC ya recibida vuelve a esta bandeja (ver `comprasInboxSql`);
 * fuera de ese modo el scope la excluye y no altera ningún conteo.
 */
const STAGE_GROUPS = [
  { value: "draft", label: "Borrador" },
  {
    value: "sent,partially_office_received,office_received,partially_received,received",
    label: "Emitidas",
  },
  { value: "cancelled", label: "Anuladas" },
] as const

export default async function ComprasPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  let session
  try { session = await requirePermission("purchasing:view") }
  catch { redirect("/forbidden") }
  const sp = await searchParams
  const createdCountRaw = typeof sp.creadas === "string" ? Number(sp.creadas) : 0
  const createdCount = Number.isFinite(createdCountRaw) && createdCountRaw > 1 ? createdCountRaw : 0
  const noPendingItems = sp.sin_pendientes === "1"
  const visibleWsIds = visibleWorksiteIds(session)
  const worksiteScope = isGlobalRole(session)
    ? undefined
    : visibleWsIds.length > 0
      ? inArray(purchaseOrders.worksiteId, visibleWsIds)
      : sql`false`
  const requestWorksiteScope = isGlobalRole(session)
    ? undefined
    : visibleWsIds.length > 0
      ? inArray(purchaseRequests.worksiteId, visibleWsIds)
      : sql`false`

  // URL-synced search & filters (server-side, so search finds records on any page)
  const listParams = parseListParams(sp)

  // Export URL respects the active filters (estado→status, q/faena/proveedor passthrough).
  const exportParams = new URLSearchParams({ tipo: "compras" })
  if (listParams.q) exportParams.set("q", listParams.q)
  // `estados` es un arreglo: siempre truthy, así que el href llevaba `status=`
  // vacío incluso sin filtro de estado.
  if (listParams.estados.length > 0) exportParams.set("status", listParams.estados.join(","))
  if (listParams.faena) exportParams.set("faena", listParams.faena)
  if (listParams.proveedor) exportParams.set("proveedor", listParams.proveedor)
  if (listParams.factura === "pendiente") exportParams.set("factura", "pendiente")
  if (listParams.desde) exportParams.set("desde", listParams.desde)
  if (listParams.hasta) exportParams.set("hasta", listParams.hasta)
  const exportHref = `/api/reportes/export?${exportParams.toString()}`

  // Extended text search: match OC code OR supplier name via EXISTS subquery.
  function escapeLikeLocal(v: string) { return v.replace(/[\\%_]/g, (c) => `\\${c}`) }
  const q = listParams.q.trim()
  const likePattern = q ? `%${escapeLikeLocal(q)}%` : null
  const textCondition = likePattern
    ? or(
        ilike(purchaseOrders.code, likePattern),
        sql`EXISTS (SELECT 1 FROM suppliers s WHERE s.id = ${purchaseOrders.supplierId} AND s.name ILIKE ${likePattern})`,
      )
    : undefined

  // Se aplica en SQL antes de contar y paginar, como el resto de los filtros:
  // filtrar la página ya traída dejaría el clásico "sin resultados" con la OC
  // buscada viviendo en otra página.
  const invoicePendingOnly = listParams.factura === "pendiente"
  const invoicePendingCondition = and(
    inArray(purchaseOrders.status, INVOICE_DUE_ORDER_STATUSES),
    orderHasNoInvoice,
  )

  // Los contadores de las tabs se cuentan sin el filtro de estado: cada tab
  // anuncia lo que entregaría al pulsarla, no lo que ya está en pantalla.
  const scopeWhere = and(
    worksiteScope,
    comprasInboxSql({ invoicePendingOnly }),
    textCondition,
    worksiteEqSql(purchaseOrders.worksiteId, listParams.faena),
    eqFilter(purchaseOrders.supplierId, listParams.proveedor),
    invoicePendingOnly ? invoicePendingCondition : undefined,
    // El KPI "Inversión" del dashboard cuenta OC emitidas en su ventana; este
    // filtro es el destino equivalente: reproduce esa ventana en la lista.
    periodSql(purchaseOrders.issuedAt, listParams.desde, listParams.hasta),
  )
  const ordersWhere = and(scopeWhere, statusSql(purchaseOrders.status, listParams.estados))

  // La cola de Compras: solicitudes aprobadas que todavía necesitan OC. El
  // contador y la tabla salen del MISMO predicado compartido
  // (`pendingPurchaseWhere`), así que el resumen no puede anunciar 8 con 5
  // filas debajo. Los filtros de OC (estado de la orden, factura, período) no
  // se le aplican: son propiedades de la orden, y esta cola es de solicitudes
  // que todavía no tienen ninguna.
  const pendingFilters = { q: listParams.q, worksiteId: listParams.faena, supplierId: listParams.proveedor }

  // ARQ-10: ninguna de estas consultas depende del resultado de otra —
  // todas cuelgan sólo de los filtros/scope ya resueltos arriba — así que van
  // en un solo Promise.all en vez de round-trips secuenciales.
  const [pendingCount, pendingRequestCount, [totalOrdersRow], [invoicePendingRow], stageCountRows, worksiteOptionRows, supplierOptionRows] = await Promise.all([
    countPendingPurchaseItems(requestWorksiteScope, pendingFilters),
    countPendingPurchaseRequests(requestWorksiteScope, pendingFilters),
    db.select({ total: count() }).from(purchaseOrders).where(ordersWhere),
    // La señal anuncia el atraso completo de la faena visible, no el de la vista
    // filtrada: si dependiera de los filtros, se apagaría justo al filtrar. Va
    // con el scope en modo factura —igual que el destino de su enlace— porque
    // antes descontaba las OC ya recibidas: anunciaba menos atraso del que hay,
    // y del que reporta la cola operacional con el mismo predicado.
    db.select({ total: count() }).from(purchaseOrders).where(and(
      worksiteScope,
      comprasInboxSql({ invoicePendingOnly: true }),
      invoicePendingCondition,
    )),
    db.select({ status: purchaseOrders.status, total: count() }).from(purchaseOrders).where(scopeWhere).groupBy(purchaseOrders.status),
    // Worksite options for the faena filter (scoped + active)
    db
      .select({ id: worksites.id, name: worksites.name })
      .from(worksites)
      .where(isGlobalRole(session)
        ? eq(worksites.isActive, true)
        : visibleWsIds.length > 0
          ? and(eq(worksites.isActive, true), inArray(worksites.id, visibleWsIds))
          : sql`false`),
    // Supplier options for the proveedor filter (active suppliers)
    db
      .select({ id: suppliers.id, name: suppliers.name })
      .from(suppliers)
      .where(eq(suppliers.isActive, true))
      .orderBy(suppliers.name),
  ])
  const invoicePendingCount = invoicePendingRow?.total ?? 0
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
    totalItems: totalOrdersRow?.total ?? 0,
    pageSize: ORDERS_PAGE_SIZE,
  })
  // La cola de pendientes pagina con su propio parámetro: con `page` compartido,
  // avanzar en el registro de OC reiniciaba la cola y al revés.
  const pendingPagination = resolvePagination({
    pageParam: sp.pendientes,
    totalItems: pendingRequestCount,
    pageSize: PENDING_PURCHASE_PAGE_SIZE,
  })
  const pendingRequests = pendingRequestCount > 0
    ? await listPendingPurchaseRequests(requestWorksiteScope, pendingFilters, {
        limit: pendingPagination.limit,
        offset: pendingPagination.offset,
      })
    : []
  const pendingPageHref = (page: number) => buildPaginationHref("/compras", sp, page, "pendientes")
  const worksiteOptions = worksiteOptionRows.map((w) => ({ value: w.id, label: w.name }))
  const supplierOptions = supplierOptionRows.map((s) => ({ value: s.id, label: s.name }))
  const worksiteScopeLabel = worksiteOptions.find((worksite) => worksite.value === listParams.faena)?.label
    ?? "todas las faenas permitidas"

  // ── Purchase orders ──────────────────────────────────────────────────────────
  const visibleOrders = await db
    .select({
      id:          purchaseOrders.id,
      code:        purchaseOrders.code,
      worksiteId:  purchaseOrders.worksiteId,
      supplierId:  purchaseOrders.supplierId,
      status:      purchaseOrders.status,
      totalAmount: purchaseOrders.totalAmount,
      issuedAt:    purchaseOrders.issuedAt,
      sentAt:      purchaseOrders.sentAt,
      createdAt:   purchaseOrders.createdAt,
    })
    .from(purchaseOrders)
    .where(ordersWhere)
    // El código desempata, y no por estética: las OC creadas en un mismo lote
    // comparten `createdAt` al milisegundo, así que el orden entre ellas lo
    // decidía el plan de la consulta. En pantalla se veía como 0011 delante de
    // 0012; en el paginador es peor, porque un orden inestable puede repetir
    // una fila en una página y saltársela en la otra. `code` es UNIQUE: basta
    // él para que el orden total sea determinista.
    .orderBy(desc(purchaseOrders.createdAt), desc(purchaseOrders.code))
    .limit(pagination.limit)
    .offset(pagination.offset)
  const pageHref = (page: number) => buildPaginationHref("/compras", sp, page)

  const canCreateOrder = can(session, "purchasing:create_order")
  const canDeleteOrder = can(session, "purchasing:delete_order")
  const canSendOrder = can(session, "purchasing:send_order")
  const headerSignals: HeaderSignal[] = []
  // Una OC con mercadería recibida y sin factura no se veía desde ninguna parte:
  // la columna "Facturas" mostraba el mismo "—" que en una recién emitida. La
  // señal va sólo para quien puede adjuntarla —el mismo permiso que exige
  // `addInvoiceAction`—; a los demás les queda la columna, que es informativa y
  // vive junto a su OC en vez de pedir una acción que no pueden ejecutar.
  if (can(session, "purchasing:send_order")) {
    headerSignals.push({
      key: "sin-factura",
      label: "Sin factura",
      value: invoicePendingCount,
      tone: "signal",
      href: "/compras?factura=pendiente",
    })
  }

  const orderIds    = visibleOrders.map((o) => o.id)
  const wsIds       = [...new Set(visibleOrders.map((o) => o.worksiteId))]
  const supplierIds = [...new Set(visibleOrders.map((o) => o.supplierId))]

  const [wsRows, supplierRows, itemCounts, invoiceCounts] = await Promise.all([
    wsIds.length > 0
      ? db
          .select({ id: worksites.id, name: worksites.name })
          .from(worksites)
          .where(inArray(worksites.id, wsIds))
      : Promise.resolve([]),

    supplierIds.length > 0
      ? db
          .select({ id: suppliers.id, name: suppliers.name })
          .from(suppliers)
          .where(inArray(suppliers.id, supplierIds))
      : Promise.resolve([]),

    orderIds.length > 0
      ? db
          .select({
            purchaseOrderId: purchaseOrderItems.purchaseOrderId,
            total: count(),
            // Las líneas con costo pendiente no suman al total de la OC; sin
            // este conteo la lista mostraría un monto que parece completo.
            pendingCost: sql<number>`count(*) filter (where ${purchaseOrderItems.unitPrice} is null)`,
          })
          .from(purchaseOrderItems)
          .where(inArray(purchaseOrderItems.purchaseOrderId, orderIds))
          .groupBy(purchaseOrderItems.purchaseOrderId)
      : Promise.resolve([]),

    orderIds.length > 0
      ? db
          .select({ purchaseOrderId: purchaseOrderInvoices.purchaseOrderId, total: count() })
          .from(purchaseOrderInvoices)
          .where(inArray(purchaseOrderInvoices.purchaseOrderId, orderIds))
          .groupBy(purchaseOrderInvoices.purchaseOrderId)
      : Promise.resolve([]),

  ])

  const wsMap  = Object.fromEntries(wsRows.map((w) => [w.id, w.name]))
  const supMap = Object.fromEntries(supplierRows.map((s) => [s.id, s.name]))
  const cntMap = Object.fromEntries(itemCounts.map((c) => [c.purchaseOrderId, c.total]))
  const pendingCostMap = Object.fromEntries(itemCounts.map((c) => [c.purchaseOrderId, Number(c.pendingCost)]))
  const invMap = Object.fromEntries(invoiceCounts.map((c) => [c.purchaseOrderId, c.total]))

  const rows: OcRow[] = visibleOrders.map((o) => ({
    id:           o.id,
    code:         o.code,
    worksiteName: wsMap[o.worksiteId]  ?? o.worksiteId,
    supplierName: supMap[o.supplierId] ?? o.supplierId,
    status:       o.status,
    itemCount:    cntMap[o.id] ?? 0,
    totalAmount:  o.totalAmount,
    pendingCostLines: pendingCostMap[o.id] ?? 0,
    invoiceCount: invMap[o.id] ?? 0,
    issuedAt:     o.issuedAt,
    sentAt:       o.sentAt,
    createdAt:    o.createdAt,
  }))

  return (
    <PageContainer>
      <PageHeader
        newShortcutHref="/compras/nueva"
        title="Compras"
        description="Solicitudes aprobadas que esperan orden de compra, y el registro de las OC generadas."
        breadcrumb={
          <Breadcrumbs items={[
            { label: "Inicio", href: "/dashboard" },
            { label: "Compras" },
          ]} />
        }
        headerActions={<HeaderSignals signals={headerSignals} />}
        actions={<ComprasActions canCreate={canCreateOrder} exportHref={exportHref} />}
      />
      <p className="mb-3 text-xs text-(--color-text-subtle)" aria-live="polite">
        Alcance de faena: <span className="font-medium text-(--color-text-muted)">{worksiteScopeLabel}</span>
      </p>

      {/* El trabajo activo del módulo va primero: qué solicitudes aprobadas
          siguen esperando una OC. El registro de OC queda debajo, para el
          seguimiento (emitir un borrador, perseguir su factura, anularla). */}
      <PendingPurchaseList
        requests={pendingRequests}
        pendingItemCount={pendingCount}
        requestCount={pendingRequestCount}
        canCreate={canCreateOrder}
        createdCount={createdCount}
        noPendingItems={noPendingItems}
        hasActiveFilters={Boolean(listParams.q || listParams.faena || listParams.proveedor)}
      />
      <ServerPagination pagination={pendingPagination} hrefForPage={pendingPageHref} />

      <div className="mt-8 flex flex-col gap-3">
        <div>
          <h2 className="text-h2">Órdenes de compra generadas</h2>
          <p className="mt-1 text-sm text-(--color-text-muted)">
            Registro y seguimiento. Una OC emitida se recibe en{" "}
            <Link href="/recepcion" className="underline underline-offset-2">Recepción</Link>;
            acá queda para emitir su borrador, adjuntar la factura o anularla.
          </p>
        </div>
        <OcList
          orders={rows}
          stageTabs={stageTabs}
          canDelete={canDeleteOrder}
          canSend={canSendOrder}
          worksiteOptions={worksiteOptions}
          supplierOptions={supplierOptions}
        />
        <ServerPagination pagination={pagination} hrefForPage={pageHref} />
      </div>
    </PageContainer>
  )
}
