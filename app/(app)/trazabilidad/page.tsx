import type { Metadata } from "next"
import { redirect } from "next/navigation"
import Link from "next/link"
import { db } from "@/db"
import {
  purchaseRequests, purchaseRequestItems,
  purchaseOrderItems, receipts, receiptItems,
  approvalDecisions, products, worksites,
} from "@/db/schema"
import { and, asc, count, desc, eq, inArray, sql } from "drizzle-orm"
import { isGlobalRole, requirePermission, visibleWorksiteIds } from "@/lib/auth/can"
import { PageHeader, Breadcrumbs } from "@/components/ui/page-header"
import { PageContainer } from "@/components/ui/page-container"
import { StateBadge } from "@/components/states/state-badge"
import { EmptyState } from "@/components/ui/empty-state"
import { formatQty } from "@/lib/utils"
import {
  TableRoot, Table, TableHeader, TableBody,
  TableRow, TableHead, TableCell, TableCellNum, TableCaption,
} from "@/components/ui/table"
import { Button } from "@/components/ui/button"
import { Warning, ArrowSquareOut, Funnel, DownloadSimple } from "@phosphor-icons/react/dist/ssr"

export const metadata: Metadata = { title: "Trazabilidad de ítems" }

/** States that indicate an item has been approved (or past approval). */
const APPROVED_STATES = [
  "approved", "pending_purchase", "in_purchase_order", "purchased",
  "partially_received", "received",
] as const
const APPROVED_STATE_SET = new Set<string>(APPROVED_STATES)

const PAGE_SIZE = 50
const ALERT_SCAN_LIMIT = 1_000

export default async function TrazabilidadPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  let session
  try { session = await requirePermission("reports:view") }
  catch { redirect("/dashboard") }

  const sp = await searchParams
  const filterFaenaId = typeof sp.faena === "string" ? sp.faena : ""
  const filterEstado  = typeof sp.estado === "string" ? sp.estado : ""
  const currentPage   = Math.max(1, typeof sp.page === "string" ? parseInt(sp.page, 10) || 1 : 1)
  const scopedWorksiteIds = visibleWorksiteIds(session)
  const isGlobal = isGlobalRole(session)
  const isAlertFilter = filterEstado === "alert"

  const itemFilters = [
    !isGlobal
      ? scopedWorksiteIds.length > 0
        ? inArray(purchaseRequests.worksiteId, scopedWorksiteIds)
        : sql`1 = 0`
      : undefined,
    filterFaenaId ? eq(purchaseRequests.worksiteId, filterFaenaId) : undefined,
    filterEstado === "pending"
      ? inArray(purchaseRequestItems.status, ["approved", "pending_purchase"])
      : undefined,
    isAlertFilter
      ? inArray(purchaseRequestItems.status, APPROVED_STATES)
      : undefined,
    filterEstado && !isAlertFilter && filterEstado !== "pending"
      ? eq(purchaseRequestItems.status, filterEstado)
      : undefined,
  ].filter(Boolean)

  const itemWhere = itemFilters.length > 0 ? and(...itemFilters) : undefined
  const queryOffset = isAlertFilter ? 0 : (currentPage - 1) * PAGE_SIZE
  const queryLimit = isAlertFilter ? ALERT_SCAN_LIMIT : PAGE_SIZE

  /* ── Fetch scoped item rows first so downstream queries stay bounded ─── */
  const [[totalRow], itemRows, allWorksites] = await Promise.all([
    db.select({ n: count() })
      .from(purchaseRequestItems)
      .innerJoin(purchaseRequests, eq(purchaseRequestItems.requestId, purchaseRequests.id))
      .where(itemWhere),

    db.select({
      id:              purchaseRequestItems.id,
      requestId:       purchaseRequestItems.requestId,
      requestCode:     purchaseRequests.code,
      worksiteId:      purchaseRequests.worksiteId,
      productId:       purchaseRequestItems.productId,
      productNameFree: purchaseRequestItems.productNameFree,
      productName:     products.name,
      productSku:      products.sku,
      quantity:        purchaseRequestItems.quantity,
      unitOfMeasure:   purchaseRequestItems.unitOfMeasure,
      status:          purchaseRequestItems.status,
    })
      .from(purchaseRequestItems)
      .innerJoin(purchaseRequests, eq(purchaseRequestItems.requestId, purchaseRequests.id))
      .leftJoin(products, eq(purchaseRequestItems.productId, products.id))
      .where(itemWhere)
      .orderBy(desc(purchaseRequestItems.createdAt))
      .limit(queryLimit)
      .offset(queryOffset),

    db.select({ id: worksites.id, name: worksites.name })
      .from(worksites)
      .where(eq(worksites.isActive, true))
      .orderBy(asc(worksites.name)),
  ])

  const requestItemIds = itemRows.map((item) => item.id)
  const [allOcItems, allReceiptItems, allApproveDecisions] = requestItemIds.length > 0
    ? await Promise.all([
    db.select({
      id:            purchaseOrderItems.id,
      purchaseOrderId: purchaseOrderItems.purchaseOrderId,
      requestItemId: purchaseOrderItems.requestItemId,
      quantity:      purchaseOrderItems.quantity,
    })
      .from(purchaseOrderItems)
      .where(inArray(purchaseOrderItems.requestItemId, requestItemIds)),

    db.select({
      purchaseOrderItemId: receiptItems.purchaseOrderItemId,
      quantityReceived:    receiptItems.quantityReceived,
    })
      .from(receiptItems)
      .innerJoin(receipts, eq(receiptItems.receiptId, receipts.id))
      .innerJoin(purchaseOrderItems, eq(receiptItems.purchaseOrderItemId, purchaseOrderItems.id))
      .where(and(
        inArray(purchaseOrderItems.requestItemId, requestItemIds),
        eq(receipts.locationType, "faena"),
      )),

    // Approval decisions may be recorded as "approve" or "modify" when quantity changes.
    db.select({
      requestItemId: approvalDecisions.requestItemId,
      modifiedQty:   approvalDecisions.modifiedQty,
    })
      .from(approvalDecisions)
      .where(and(
        inArray(approvalDecisions.type, ["approve", "modify"]),
        inArray(approvalDecisions.requestItemId, requestItemIds),
      )),
  ])
    : [[], [], []] as const

  /* ── Build lookup maps ──────────────────────────────────────────────── */
  const worksiteMap   = Object.fromEntries(allWorksites.map((w) => [w.id, w.name]))

  // OC items indexed by requestItemId → list of OC items
  const ocByItemId = new Map<string, Array<{ id: string; purchaseOrderId: string; quantity: number }>>()
  for (const oi of allOcItems) {
    if (!oi.requestItemId) continue
    const arr = ocByItemId.get(oi.requestItemId) ?? []
    arr.push({ id: oi.id, purchaseOrderId: oi.purchaseOrderId, quantity: oi.quantity })
    ocByItemId.set(oi.requestItemId, arr)
  }

  // Received quantities indexed by OC item ID
  const receivedByOcItem = new Map<string, number>()
  for (const ri of allReceiptItems) {
    receivedByOcItem.set(
      ri.purchaseOrderItemId,
      (receivedByOcItem.get(ri.purchaseOrderItemId) ?? 0) + ri.quantityReceived,
    )
  }

  // Last approve decision modifiedQty indexed by requestItemId
  // modifiedQty=null → approver kept original quantity
  const modifiedQtyByItemId = new Map<string, number | null>()
  for (const d of allApproveDecisions) {
    if (!d.requestItemId) continue
    // Later entries overwrite earlier — last decision wins
    modifiedQtyByItemId.set(d.requestItemId, d.modifiedQty)
  }

  /* ── Aggregate per item ─────────────────────────────────────────────── */
  type MatrixRow = {
    itemId:       string
    requestId:    string
    requestCode:  string
    productName:  string
    productSku:   string | null
    worksiteId:   string
    worksiteName: string
    uom:          string
    requested:    number
    approved:     number | null  // null = not yet approved
    inOc:         number
    received:     number
    status:       string
    /** True when approved > inOc — the core missing-item alert */
    alert:        boolean
  }

  const rows: MatrixRow[] = []

  for (const item of itemRows) {
    const ocItems = ocByItemId.get(item.id) ?? []
    const inOc     = ocItems.reduce((s, oi) => s + oi.quantity, 0)
    const received = ocItems.reduce((s, oi) => s + (receivedByOcItem.get(oi.id) ?? 0), 0)

    const isApproved = APPROVED_STATE_SET.has(item.status)
    let approved: number | null = null
    if (isApproved) {
      // modifiedQty null means no change; undefined means no decision found (use original)
      const mod = modifiedQtyByItemId.get(item.id)
      approved = mod !== undefined ? (mod ?? item.quantity) : item.quantity
    }

    const alert = isApproved && approved !== null && inOc < approved

    const productName = item.productName ?? item.productNameFree ?? "—"
    const productSku  = item.productSku ?? null

    rows.push({
      itemId:       item.id,
      requestId:    item.requestId,
      requestCode:  item.requestCode,
      productName,
      productSku,
      worksiteId:   item.worksiteId,
      worksiteName: worksiteMap[item.worksiteId] ?? item.worksiteId,
      uom:          item.unitOfMeasure,
      requested:    item.quantity,
      approved,
      inOc,
      received,
      status:       item.status,
      alert,
    })
  }

  /* ── Apply filters ──────────────────────────────────────────────────── */
  const filtered = rows.filter((r) => {
    if (filterEstado === "alert"   && !r.alert) return false
    return true
  })

  /* ── Paginate ───────────────────────────────────────────────────────── */
  const totalFiltered = isAlertFilter ? filtered.length : (totalRow?.n ?? 0)
  const totalPages    = Math.ceil(totalFiltered / PAGE_SIZE)
  const safePage      = Math.min(currentPage, Math.max(totalPages, 1))
  const paginated     = isAlertFilter
    ? filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE)
    : filtered

  const alertCount = rows.filter((r) => r.alert).length

  /* ── Filter options visible to this user ───────────────────────────── */
  const visibleRowWorksiteIds = new Set(rows.map((r) => r.worksiteId))
  const visibleWorksites      = allWorksites.filter((w) => visibleRowWorksiteIds.has(w.id))

  const inputCls = [
    "h-9 rounded-[var(--radius)] border border-[var(--color-border)]",
    "bg-[var(--color-surface)] px-3 py-1.5 text-sm text-[var(--color-text)]",
    "focus:outline-none focus:border-[var(--color-primary)]",
  ].join(" ")
  const baseParams = {
    ...(filterFaenaId ? { faena: filterFaenaId } : {}),
    ...(filterEstado ? { estado: filterEstado } : {}),
  }
  const pageHref = (page: number) => `/trazabilidad?${new URLSearchParams({ ...baseParams, page: String(page) }).toString()}`

  return (
    <PageContainer>
      <PageHeader
        title="Trazabilidad de ítems"
        description="Estado de cada ítem a lo largo del flujo: solicitud → aprobación → OC → recepción → entrega."
        breadcrumb={
          <Breadcrumbs items={[
            { label: "Dashboard", href: "/dashboard" },
            { label: "Trazabilidad" },
          ]} />
        }
      />

      {/* ── Alert summary ─────────────────────────────────────────────── */}
      {alertCount > 0 && (
        <div className="mb-4 flex items-center gap-2 rounded-[var(--radius)] border border-[var(--color-signal-line)] bg-[var(--color-signal-tint)] px-4 py-3">
          <Warning weight="fill" className="h-4 w-4 shrink-0 text-[var(--color-signal-ink)]" aria-hidden />
          <p className="text-sm font-medium text-[var(--color-signal-ink)]">
            {alertCount} {alertCount === 1 ? "ítem aprobado falta" : "ítems aprobados faltan"} en órdenes de compra
          </p>
          {filterEstado !== "alert" && (
            <a
              href={`/trazabilidad?estado=alert${filterFaenaId ? `&faena=${filterFaenaId}` : ""}`}
              className="ml-auto text-xs font-medium text-[var(--color-signal-ink)] underline underline-offset-2"
            >
              Ver solo alertas
            </a>
          )}
        </div>
      )}

      {/* ── Filters ───────────────────────────────────────────────────── */}
      <form method="GET" className="mb-4 flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-[var(--color-text-muted)]">Faena</label>
          <select name="faena" defaultValue={filterFaenaId} className={inputCls}>
            <option value="">Todas las faenas</option>
            {visibleWorksites.map((w) => (
              <option key={w.id} value={w.id}>{w.name}</option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-[var(--color-text-muted)]">Estado</label>
          <select name="estado" defaultValue={filterEstado} className={inputCls}>
            <option value="">Todos los estados</option>
            <option value="alert">Alerta: aprobado sin OC</option>
            <option value="pending">Pendiente de compra</option>
            <option value="draft">Borrador</option>
            <option value="requested">Solicitado</option>
            <option value="approved">Aprobado</option>
            <option value="pending_purchase">Pendiente compra</option>
            <option value="in_purchase_order">En OC</option>
            <option value="purchased">Comprado</option>
            <option value="partially_received">Rec. parcial</option>
            <option value="received">Recibido</option>
            <option value="rejected">Rechazado</option>
            <option value="postponed">Postergado</option>
          </select>
        </div>
        <Button type="submit" variant="secondary">
          <Funnel className="h-3.5 w-3.5" aria-hidden />
          Filtrar
        </Button>
        <Link
          href="/api/trazabilidad/export"
          prefetch={false}
          className="inline-flex h-9 items-center gap-1.5 rounded-[var(--radius-full)] bg-[var(--color-surface)] shadow-[var(--shadow-card)] px-3 text-sm font-medium text-[var(--color-text)] hover:bg-[var(--color-surface-2)] transition-[color,background-color,transform] duration-[var(--duration-fast)] ease-[var(--ease-out)] active:scale-[0.97]"
          aria-label="Exportar trazabilidad a Excel"
        >
          <DownloadSimple className="h-3.5 w-3.5" aria-hidden />
          Exportar Excel
        </Link>
        {(filterFaenaId || filterEstado) && (
          <Link
            href="/trazabilidad"
            className="inline-flex h-9 items-center text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)] underline underline-offset-2"
          >
            Quitar filtros
          </Link>
        )}
        <span className="ml-auto self-end text-xs text-[var(--color-text-subtle)]">
          {totalFiltered} de {totalRow?.n ?? 0} ítems
          {totalPages > 1 && ` · Pág. ${safePage} de ${totalPages}`}
          {isAlertFilter && (totalRow?.n ?? 0) > ALERT_SCAN_LIMIT && ` · primeras ${ALERT_SCAN_LIMIT} filas revisadas`}
        </span>
      </form>

      {/* ── Matrix table ──────────────────────────────────────────────── */}
      {paginated.length === 0 ? (
        <EmptyState
          title="Sin ítems"
          description={rows.length === 0
            ? "Aún no hay solicitudes con ítems en el sistema."
            : "No hay ítems que coincidan con los filtros seleccionados. Intenta con otros filtros."}
          compact
        />
      ) : (
        <>
          <div className="grid gap-2 md:hidden">
            {paginated.map((row) => (
              <article
                key={row.itemId}
                className={[
                  "rounded-[var(--radius-2xl)] bg-[var(--color-surface)] shadow-[var(--shadow-card)] p-4",
                  row.alert ? "ring-1 ring-inset ring-[var(--color-signal-line)]" : "",
                ].join(" ")}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="text-sm font-medium text-[var(--color-text)]">{row.productName}</h2>
                    <p className="mt-0.5 text-xs text-[var(--color-text-subtle)]">
                      {row.productSku ? <span className="font-mono">{row.productSku} · </span> : null}
                      {row.worksiteName}
                    </p>
                  </div>
                  <StateBadge state={row.status} entity="item" size="sm" />
                </div>

                <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
                  <div>
                    <p className="text-[var(--color-text-subtle)]">Solicitud</p>
                    <Link
                      href={`/solicitudes/${row.requestId}`}
                      className="inline-flex items-center gap-1 font-medium text-[var(--color-primary)]"
                    >
                      {row.requestCode}
                      <ArrowSquareOut className="h-3 w-3 shrink-0" aria-hidden />
                    </Link>
                  </div>
                  <div className="text-right">
                    <p className="text-[var(--color-text-subtle)]">Solicitado</p>
                    <p className="font-mono tabular-nums text-[var(--color-text)]">{formatQty(row.requested, row.uom)}</p>
                  </div>
                  <div>
                    <p className="text-[var(--color-text-subtle)]">Aprobado</p>
                    <p className="font-mono tabular-nums text-[var(--color-text)]">
                      {row.approved !== null ? formatQty(row.approved, row.uom) : "—"}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-[var(--color-text-subtle)]">En OC</p>
                    <p className={["font-mono tabular-nums", row.alert ? "font-semibold text-[var(--color-signal-ink)]" : "text-[var(--color-text)]"].join(" ")}>
                      {formatQty(row.inOc, row.uom)}
                      {row.alert && (
                        <Warning
                          weight="fill"
                          className="ml-1 inline h-3.5 w-3.5 text-[var(--color-signal-ink)]"
                          aria-label={`Faltan ${formatQty((row.approved ?? 0) - row.inOc, row.uom)} en OC`}
                        />
                      )}
                    </p>
                  </div>
                  <div>
                    <p className="text-[var(--color-text-subtle)]">Recibido</p>
                    <p className="font-mono tabular-nums text-[var(--color-text)]">{formatQty(row.received, row.uom)}</p>
                  </div>
                </div>
              </article>
            ))}
          </div>

          <TableRoot className="hidden md:block">
            <Table>
              <TableCaption className="sr-only">
                Matriz de trazabilidad de ítems por producto, faena, solicitud, cantidades y estado.
              </TableCaption>
              <TableHeader>
                <TableRow>
                  <TableHead>Producto</TableHead>
                  <TableHead>Faena</TableHead>
                  <TableHead>Solicitud</TableHead>
                  <TableHead className="text-right">Solicitado</TableHead>
                  <TableHead className="text-right">Aprobado</TableHead>
                  <TableHead className="text-right">En OC</TableHead>
                  <TableHead className="text-right">Recibido</TableHead>
                  <TableHead>Estado</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {paginated.map((row) => (
                  <TableRow
                    key={row.itemId}
                    data-alert={row.alert ? "true" : undefined}
                    className={row.alert
                      ? "bg-[var(--color-signal-tint)] ring-1 ring-inset ring-[var(--color-signal-line)]"
                      : undefined}
                  >
                    {/* Product */}
                    <TableCell className="max-w-[220px]">
                      <div className="font-medium text-[var(--color-text)] truncate" title={row.productName}>
                        {row.productName}
                      </div>
                      {row.productSku && (
                        <div className="text-xs text-[var(--color-text-subtle)] font-mono">{row.productSku}</div>
                      )}
                    </TableCell>

                    {/* Worksite */}
                    <TableCell className="text-sm text-[var(--color-text-muted)] whitespace-nowrap">
                      {row.worksiteName}
                    </TableCell>

                    {/* Request code + link */}
                    <TableCell>
                      <Link
                        href={`/solicitudes/${row.requestId}`}
                        className="inline-flex items-center gap-1 text-sm text-[var(--color-primary)] hover:underline underline-offset-2"
                      >
                        {row.requestCode}
                        <ArrowSquareOut className="h-3 w-3 shrink-0" aria-hidden />
                      </Link>
                    </TableCell>

                    {/* Quantities */}
                    <TableCellNum>{formatQty(row.requested, row.uom)}</TableCellNum>

                    <TableCellNum>
                      {row.approved !== null ? formatQty(row.approved, row.uom) : (
                        <span className="text-[var(--color-text-subtle)]">—</span>
                      )}
                    </TableCellNum>

                    <TableCellNum>
                      <span className={row.alert ? "font-semibold text-[var(--color-signal-ink)]" : undefined}>
                        {formatQty(row.inOc, row.uom)}
                      </span>
                      {row.alert && (
                        <Warning
                          weight="fill"
                          className="inline ml-1 h-3.5 w-3.5 text-[var(--color-signal-ink)]"
                          aria-label={`Faltan ${formatQty((row.approved ?? 0) - row.inOc, row.uom)} en OC`}
                        />
                      )}
                    </TableCellNum>

                    <TableCellNum>{formatQty(row.received, row.uom)}</TableCellNum>

                    {/* Status badge */}
                    <TableCell>
                      <StateBadge state={row.status} entity="item" size="sm" />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableRoot>
        </>
      )}

      {/* ── Pagination ────────────────────────────────────────────────── */}
      {totalPages > 1 && (
        <div className="mt-4 flex items-center justify-between gap-4 border-t border-[var(--color-border)] px-4 py-3">
          <p className="text-xs text-[var(--color-text-subtle)]">
            <span className="font-mono tabular-nums">{(safePage - 1) * PAGE_SIZE + 1}</span>
            {" – "}
            <span className="font-mono tabular-nums">{Math.min(safePage * PAGE_SIZE, totalFiltered)}</span>
            {" de "}
            <span className="font-mono tabular-nums">{totalFiltered}</span>
          </p>
          <div className="flex items-center gap-1">
            {safePage > 1 && (
              <a
                href={pageHref(safePage - 1)}
                className="inline-flex h-8 w-8 items-center justify-center rounded-[var(--radius)] text-xs font-medium text-[var(--color-text-muted)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)] transition-[color,background-color,transform] duration-[var(--duration-fast)] ease-[var(--ease-out)] active:scale-[0.93]"
                aria-label="Página anterior"
              >
                ←
              </a>
            )}
            <span className="px-3 text-xs text-[var(--color-text-subtle)]">
              Pág. {safePage} de {totalPages}
            </span>
            {safePage < totalPages && (
              <a
                href={pageHref(safePage + 1)}
                className="inline-flex h-8 w-8 items-center justify-center rounded-[var(--radius)] text-xs font-medium text-[var(--color-text-muted)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)] transition-[color,background-color,transform] duration-[var(--duration-fast)] ease-[var(--ease-out)] active:scale-[0.93]"
                aria-label="Página siguiente"
              >
                →
              </a>
            )}
          </div>
        </div>
      )}

      {/* ── Legend ────────────────────────────────────────────────────── */}
      <p className="mt-4 text-xs text-[var(--color-text-subtle)]">
        Las filas resaltadas indican ítems aprobados cuya cantidad en órdenes de compra es inferior a la aprobada.
        La recepción en bodega/faena cierra el seguimiento operativo del ítem; la llegada a oficina queda como paso previo.
      </p>
    </PageContainer>
  )
}
