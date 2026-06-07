import type { Metadata } from "next"
import { redirect } from "next/navigation"
import Link from "next/link"
import { db } from "@/db"
import {
  purchaseRequests, purchaseRequestItems,
  purchaseOrderItems, receiptItems, deliveryItems,
  approvalDecisions, products, worksites,
} from "@/db/schema"
import { asc, eq, inArray } from "drizzle-orm"
import { requirePermission, canAccessWorksite } from "@/lib/auth/can"
import { PageHeader, Breadcrumbs } from "@/components/ui/page-header"
import { StateBadge } from "@/components/states/state-badge"
import { EmptyState } from "@/components/ui/empty-state"
import { formatQty } from "@/lib/utils"
import {
  TableRoot, Table, TableHeader, TableBody,
  TableRow, TableHead, TableCell, TableCellNum,
} from "@/components/ui/table"
import { Warning, ArrowSquareOut, Funnel } from "@phosphor-icons/react/dist/ssr"

export const metadata: Metadata = { title: "Trazabilidad de ítems" }

/** States that indicate an item has been approved (or past approval). */
const APPROVED_STATES = new Set([
  "approved", "pending_purchase", "in_purchase_order", "purchased",
  "partially_received", "received", "partially_delivered", "delivered",
])

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

  /* ── Fetch all data in parallel ─────────────────────────────────────── */
  const [
    allItems, allRequests, allProducts, allWorksites,
    allOcItems, allReceiptItems, allDeliveryItems, allApproveDecisions,
  ] = await Promise.all([
    db.select({
      id:              purchaseRequestItems.id,
      requestId:       purchaseRequestItems.requestId,
      productId:       purchaseRequestItems.productId,
      productNameFree: purchaseRequestItems.productNameFree,
      quantity:        purchaseRequestItems.quantity,
      unitOfMeasure:   purchaseRequestItems.unitOfMeasure,
      status:          purchaseRequestItems.status,
    }).from(purchaseRequestItems).orderBy(asc(purchaseRequestItems.createdAt)),

    db.select({
      id:         purchaseRequests.id,
      code:       purchaseRequests.code,
      worksiteId: purchaseRequests.worksiteId,
    }).from(purchaseRequests),

    db.select({ id: products.id, name: products.name, sku: products.sku }).from(products),

    db.select({ id: worksites.id, name: worksites.name })
      .from(worksites)
      .where(eq(worksites.isActive, true))
      .orderBy(asc(worksites.name)),

    db.select({
      id:            purchaseOrderItems.id,
      requestItemId: purchaseOrderItems.requestItemId,
      quantity:      purchaseOrderItems.quantity,
    }).from(purchaseOrderItems),

    db.select({
      purchaseOrderItemId: receiptItems.purchaseOrderItemId,
      quantityReceived:    receiptItems.quantityReceived,
    }).from(receiptItems),

    db.select({
      requestItemId: deliveryItems.requestItemId,
      quantity:      deliveryItems.quantity,
    }).from(deliveryItems),

    // Approval decisions may be recorded as "approve" or "modify" when quantity changes.
    db.select({
      requestItemId: approvalDecisions.requestItemId,
      modifiedQty:   approvalDecisions.modifiedQty,
    }).from(approvalDecisions).where(inArray(approvalDecisions.type, ["approve", "modify"])),
  ])

  /* ── Build lookup maps ──────────────────────────────────────────────── */
  const requestMap    = Object.fromEntries(allRequests.map((r) => [r.id, r]))
  const productMap    = Object.fromEntries(allProducts.map((p) => [p.id, p]))
  const worksiteMap   = Object.fromEntries(allWorksites.map((w) => [w.id, w.name]))

  // OC items indexed by requestItemId → list of OC items
  const ocByItemId = new Map<string, Array<{ id: string; quantity: number }>>()
  for (const oi of allOcItems) {
    if (!oi.requestItemId) continue
    const arr = ocByItemId.get(oi.requestItemId) ?? []
    arr.push({ id: oi.id, quantity: oi.quantity })
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

  // Delivered quantities indexed by requestItemId
  // Note: warehouse dispatch deliveries may not populate requestItemId.
  // This captures only deliveries linked back to a request item.
  const deliveredByItemId = new Map<string, number>()
  for (const di of allDeliveryItems) {
    if (!di.requestItemId) continue
    deliveredByItemId.set(
      di.requestItemId,
      (deliveredByItemId.get(di.requestItemId) ?? 0) + di.quantity,
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
    delivered:    number
    status:       string
    /** True when approved > inOc — the core missing-item alert */
    alert:        boolean
  }

  const rows: MatrixRow[] = []

  for (const item of allItems) {
    const request = requestMap[item.requestId]
    if (!request) continue
    if (!canAccessWorksite(session, request.worksiteId)) continue

    const ocItems = ocByItemId.get(item.id) ?? []
    const inOc     = ocItems.reduce((s, oi) => s + oi.quantity, 0)
    const received = ocItems.reduce((s, oi) => s + (receivedByOcItem.get(oi.id) ?? 0), 0)
    const delivered = deliveredByItemId.get(item.id) ?? 0

    const isApproved = APPROVED_STATES.has(item.status)
    let approved: number | null = null
    if (isApproved) {
      // modifiedQty null means no change; undefined means no decision found (use original)
      const mod = modifiedQtyByItemId.get(item.id)
      approved = mod !== undefined ? (mod ?? item.quantity) : item.quantity
    }

    const alert = isApproved && approved !== null && inOc < approved

    const product     = item.productId ? productMap[item.productId] : null
    const productName = product?.name ?? item.productNameFree ?? "—"
    const productSku  = product?.sku ?? null

    rows.push({
      itemId:       item.id,
      requestId:    request.id,
      requestCode:  request.code,
      productName,
      productSku,
      worksiteId:   request.worksiteId,
      worksiteName: worksiteMap[request.worksiteId] ?? request.worksiteId,
      uom:          item.unitOfMeasure,
      requested:    item.quantity,
      approved,
      inOc,
      received,
      delivered,
      status:       item.status,
      alert,
    })
  }

  /* ── Apply filters ──────────────────────────────────────────────────── */
  const filtered = rows.filter((r) => {
    if (filterFaenaId && r.worksiteId !== filterFaenaId) return false
    if (filterEstado === "alert"   && !r.alert) return false
    if (filterEstado === "pending" && !["approved", "pending_purchase"].includes(r.status)) return false
    if (filterEstado && filterEstado !== "alert" && filterEstado !== "pending" && r.status !== filterEstado) return false
    return true
  })

  const alertCount = rows.filter((r) => r.alert).length

  /* ── Filter options visible to this user ───────────────────────────── */
  const visibleWorksiteIds = new Set(rows.map((r) => r.worksiteId))
  const visibleWorksites   = allWorksites.filter((w) => visibleWorksiteIds.has(w.id))

  const inputCls = [
    "h-9 rounded-[var(--radius)] border border-[var(--color-border)]",
    "bg-[var(--color-surface)] px-3 py-1.5 text-sm text-[var(--color-text)]",
    "focus:outline-none focus:border-[var(--color-primary)]",
  ].join(" ")

  return (
    <>
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
        <div className="mb-4 flex items-center gap-2 rounded-[var(--radius)] border border-[var(--color-signal-100)] bg-[var(--color-signal-50)] px-4 py-3">
          <Warning weight="fill" className="h-4 w-4 shrink-0 text-[oklch(0.52_0.15_56)]" aria-hidden />
          <p className="text-sm font-medium text-[oklch(0.52_0.15_56)]">
            {alertCount} {alertCount === 1 ? "ítem aprobado falta" : "ítems aprobados faltan"} en órdenes de compra
          </p>
          {filterEstado !== "alert" && (
            <a
              href={`/trazabilidad?estado=alert${filterFaenaId ? `&faena=${filterFaenaId}` : ""}`}
              className="ml-auto text-xs font-medium text-[oklch(0.52_0.15_56)] underline underline-offset-2"
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
            <option value="partially_delivered">Entrega parcial</option>
            <option value="delivered">Entregado</option>
            <option value="rejected">Rechazado</option>
            <option value="postponed">Postergado</option>
          </select>
        </div>
        <button
          type="submit"
          className="inline-flex h-9 items-center gap-1.5 rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-sm font-medium text-[var(--color-text)] hover:bg-[var(--color-surface-2)] transition-colors"
        >
          <Funnel className="h-3.5 w-3.5" aria-hidden />
          Filtrar
        </button>
        {(filterFaenaId || filterEstado) && (
          <a
            href="/trazabilidad"
            className="inline-flex h-9 items-center text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)] underline underline-offset-2"
          >
            Quitar filtros
          </a>
        )}
        <span className="ml-auto self-end text-xs text-[var(--color-text-subtle)]">
          {filtered.length} de {rows.length} ítems
        </span>
      </form>

      {/* ── Matrix table ──────────────────────────────────────────────── */}
      {filtered.length === 0 ? (
        <EmptyState
          title="Sin ítems"
          description={rows.length === 0
            ? "Aún no hay solicitudes con ítems en el sistema."
            : "No hay ítems que coincidan con los filtros seleccionados."}
          compact
        />
      ) : (
        <TableRoot>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Producto</TableHead>
                <TableHead>Faena</TableHead>
                <TableHead>Solicitud</TableHead>
                <TableHead className="text-right">Solicitado</TableHead>
                <TableHead className="text-right">Aprobado</TableHead>
                <TableHead className="text-right">En OC</TableHead>
                <TableHead className="text-right">Recibido</TableHead>
                <TableHead className="text-right">Entregado</TableHead>
                <TableHead>Estado</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((row) => (
                <TableRow
                  key={row.itemId}
                  data-alert={row.alert ? "true" : undefined}
                  className={row.alert
                    ? "bg-[var(--color-signal-50)] border-l-2 border-l-[oklch(0.52_0.15_56)]"
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
                    <span className={row.alert ? "font-semibold text-[oklch(0.52_0.15_56)]" : undefined}>
                      {formatQty(row.inOc, row.uom)}
                    </span>
                    {row.alert && (
                      <Warning
                        weight="fill"
                        className="inline ml-1 h-3.5 w-3.5 text-[oklch(0.52_0.15_56)]"
                        aria-label={`Faltan ${formatQty((row.approved ?? 0) - row.inOc, row.uom)} en OC`}
                      />
                    )}
                  </TableCellNum>

                  <TableCellNum>{formatQty(row.received, row.uom)}</TableCellNum>
                  <TableCellNum>{formatQty(row.delivered, row.uom)}</TableCellNum>

                  {/* Status badge */}
                  <TableCell>
                    <StateBadge state={row.status} entity="item" size="sm" />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableRoot>
      )}

      {/* ── Legend ────────────────────────────────────────────────────── */}
      <p className="mt-4 text-xs text-[var(--color-text-subtle)]">
        Las filas resaltadas indican ítems aprobados cuya cantidad en órdenes de compra es inferior a la aprobada.
        Entregas vinculadas directamente desde bodega (sin trazabilidad a un ítem de solicitud) no se reflejan en la columna Entregado.
      </p>
    </>
  )
}
