import { getProductAttributesByIds } from "@/lib/services/product-sizes"
import { formatVariantProductName } from "@/lib/products/variant-grouping"
import type { Metadata } from "next"
import Link from "next/link"
import { notFound, redirect } from "next/navigation"
import { db } from "@/db"
import { purchaseOrderInvoiceReceipts, purchaseOrderInvoices, receipts } from "@/db/schema"
import { desc, eq } from "drizzle-orm"
import { can, canAccessWorksite, requirePermission } from "@/lib/auth/can"
import { PageHeader, Breadcrumbs } from "@/components/ui/page-header"
import { PageContainer } from "@/components/ui/page-container"
import { Button } from "@/components/ui/button"
import { MetaBadge, StateBadge } from "@/components/states/state-badge"
import { RequestProgressPanel } from "@/components/states/request-progress-panel"
import { buildOcProgress } from "@/lib/work-queue"
import {
  TableRoot, Table, TableHeader, TableBody,
  TableRow, TableHead, TableCell, TableCellNum,
} from "@/components/ui/table"
import { getDocumentChain } from "@/lib/services/document-chain"
import { listDispatchGuidesForReceipt, officeWorksiteLabel } from "@/lib/services/dispatch-guides"
import { DocumentChainStrip } from "@/components/documents/document-chain-strip"
import { cn, formatCLP, formatDateTime, formatQty, formatWorksiteLabel } from "@/lib/utils"
import { DetailItem as DetailItemShared } from "@/components/ui/detail-item"
import { ArrowSquareOut } from "@phosphor-icons/react/dist/ssr"
import { ReceiptGuideActions } from "./receipt-guide-actions"

export const metadata: Metadata = { title: "Detalle de recepción" }

export default async function RecepcionDetallePage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  let session
  try { session = await requirePermission("receiving:view") }
  catch { redirect(`/forbidden?desde=${encodeURIComponent("/recepcion")}`) }

  const { id } = await params
  const receipt = await db.query.receipts.findFirst({
    where: eq(receipts.id, id),
    with: {
      // Una sola factura basta: sólo interesa si la OC ya tiene alguna.
      purchaseOrder: {
        with: { worksite: true, supplier: true },
      },
      worksite: true,
      receivedBy: true,
      items: {
        with: {
          purchaseOrderItem: {
            with: {
              requestItem: {
                with: { attributes: true },
              },
            },
          },
        },
      },
    },
  })

  if (!receipt) notFound()

  // Una recepción de proveedor se guarda en la bodega real de la oficina,
  // pero su alcance operativo sigue siendo el de la faena de la OC.
  const worksiteId = receipt.locationType === "office"
    ? receipt.purchaseOrder.worksiteId
    : receipt.worksiteId ?? receipt.purchaseOrder.worksiteId
  if (!canAccessWorksite(session, worksiteId)) notFound()

  const productIds = receipt.items
    .map((item) => item.purchaseOrderItem.productId)
    .filter((productId): productId is string => productId !== null)

  const productRows = productIds.length > 0
    ? await db.query.products.findMany({
        where: (product, { inArray }) => inArray(product.id, [...new Set(productIds)]),
        columns: { id: true, sku: true, name: true },
      })
    : []

  const [documentChain, acquisitionGuides, officeLabel, linkedInvoices] = await Promise.all([
    getDocumentChain(session, { kind: "receipt", id: receipt.id }),
    listDispatchGuidesForReceipt(receipt.id),
    officeWorksiteLabel(),
    db
      .select({
        id: purchaseOrderInvoices.id,
        invoiceNumber: purchaseOrderInvoices.invoiceNumber,
        issueDate: purchaseOrderInvoices.issueDate,
        uploadedAt: purchaseOrderInvoices.uploadedAt,
      })
      .from(purchaseOrderInvoiceReceipts)
      .innerJoin(purchaseOrderInvoices, eq(purchaseOrderInvoiceReceipts.invoiceId, purchaseOrderInvoices.id))
      .where(eq(purchaseOrderInvoiceReceipts.receiptId, receipt.id))
      .orderBy(desc(purchaseOrderInvoices.uploadedAt)),
  ])

  const attributesById = await getProductAttributesByIds(productIds)
  const productMap = Object.fromEntries(productRows.map((product) => [product.id, { ...product, attributes: attributesById.get(product.id) }]))
  const destinationLabel = receipt.locationType === "office"
    ? officeLabel
    : formatWorksiteLabel(receipt.worksite?.name ?? receipt.purchaseOrder.worksite?.name ?? "").trim()

  const canAttachInvoice = session.user.permissions.includes("purchasing:send_order")
    && !["draft", "cancelled"].includes(receipt.purchaseOrder.status)
  const canViewInvoices = can(session, "purchasing:view")

  const totalRejected = receipt.items.reduce((sum, item) => sum + (item.quantityRejected ?? 0), 0)
  const totalDamaged  = receipt.items.reduce((sum, item) => sum + (item.quantityDamaged ?? 0), 0)
  const lineCount = receipt.items.length

  const progress = buildOcProgress(
    receipt.purchaseOrder.status,
    receipt.items.map((item) => {
      const ocItem = item.purchaseOrderItem
      const product = ocItem.productId ? productMap[ocItem.productId] : null
      return {
        id:               item.id,
        productName:      formatVariantProductName(product?.name ?? ocItem.productNameFree ?? "(sin nombre)", product?.attributes, ocItem.requestItem?.attributes.map((a) => ({ name: a.attributeName, value: a.value }))),
        quantity:         ocItem.quantity,
        unitOfMeasure:    ocItem.unitOfMeasure,
        quantityReceived: ocItem.quantityReceived ?? 0,
        attributes:       ocItem.requestItem?.attributes.map((attribute) => ({
          name: attribute.attributeName,
          value: attribute.value,
        })) ?? [],
      }
    }),
    // A-10: el panel es compartido con /compras/[id]; sin declarar la audiencia
    // mostraba aquí instrucciones dirigidas a quien compra.
    "recepcion",
  )

  return (
    <PageContainer width="workbench">
      <PageHeader
        title={receipt.code}
        description={`Recepción de ${receipt.purchaseOrder.code} · ${receipt.purchaseOrder.supplier?.name ?? "Proveedor sin nombre"}`}
        breadcrumb={
          <Breadcrumbs items={[
            { label: "Inicio", href: "/dashboard" },
            { label: "Recepción", href: "/recepcion" },
            { label: receipt.code },
          ]} />
        }
      />

      <DocumentChainStrip
        chain={documentChain}
        current={{ kind: "receipt", id: receipt.id }}
        currentCode={receipt.code}
        className="mb-6"
      />

      {progress && (
        <div className="mb-6">
          <RequestProgressPanel progress={progress} />
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px] lg:items-start">
        {/* ── Main: received items ─────────────────────────────────────────── */}
        <div className="min-w-0 flex flex-col gap-6">
          <section className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-h2 text-[var(--color-text)]">
                {receipt.locationType === "office" ? "Ítems recibidos en oficina" : "Ítems recibidos en faena"}
              </h2>
              <span className="font-mono text-xs text-[var(--color-text-subtle)] tabular-nums">
                {lineCount} {lineCount === 1 ? "línea" : "líneas"}
              </span>
            </div>

            <TableRoot>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Producto</TableHead>
                    <TableHead className="text-right">Recibido</TableHead>
                    <TableHead>Nota</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {receipt.items.map((item) => {
                    const ocItem = item.purchaseOrderItem
                    const product = ocItem.productId ? productMap[ocItem.productId] : null
                    const productName = formatVariantProductName(product?.name ?? ocItem.productNameFree ?? "(sin nombre)", product?.attributes, ocItem.requestItem?.attributes.map((a) => ({ name: a.attributeName, value: a.value })))
                    const pendingToFaena = Math.max(0, (ocItem.quantityOfficeReceived ?? 0) - (ocItem.quantityReceived ?? 0))
                    const flagged = (item.quantityRejected ?? 0) > 0 || (item.quantityDamaged ?? 0) > 0

                    return (
                      <TableRow key={item.id}>
                        <TableCell>
                          <div className="font-medium text-[var(--color-text)]">{productName}</div>
                          {product?.sku && (
                            <div className="mt-0.5 font-mono text-[11px] text-[var(--color-text-subtle)]">{product.sku}</div>
                          )}
                          {flagged && (
                            <div className="mt-1 flex flex-wrap gap-1.5">
                              {(item.quantityRejected ?? 0) > 0 && (
                                <MetaBadge meta={{ label: `Rechazado ${formatQty(item.quantityRejected, ocItem.unitOfMeasure)}`, variant: "danger" }} />
                              )}
                              {(item.quantityDamaged ?? 0) > 0 && (
                                <MetaBadge meta={{ label: `Dañado ${formatQty(item.quantityDamaged, ocItem.unitOfMeasure)}`, variant: "warning" }} />
                              )}
                            </div>
                          )}
                        </TableCell>
                        <TableCellNum>
                          {formatQty(item.quantityReceived, ocItem.unitOfMeasure)}
                          {/* A-35: "En oficina" junto a un título "Ítems recibidos
                              en faena" se leía como contradicción. Son dos hitos
                              distintos de la misma línea; el texto lo dice. */}
                          <div className="mt-0.5 text-[11px] font-normal text-[var(--color-text-subtle)]">
                            Llegó antes a oficina: {formatQty(ocItem.quantityOfficeReceived ?? 0, ocItem.unitOfMeasure)}
                            {pendingToFaena > 0 && ` · por despachar: ${formatQty(pendingToFaena, ocItem.unitOfMeasure)}`}
                          </div>
                        </TableCellNum>
                        <TableCell className="text-sm text-[var(--color-text-muted)]">{item.notes ?? "—"}</TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </TableRoot>
          </section>

          <section className="rounded-[var(--radius-2xl)] bg-[var(--color-surface)] shadow-[var(--shadow-card)] p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-h2 text-[var(--color-text)]">Despacho {officeLabel} → Faena</h2>
                <p className="mt-1 text-xs text-[var(--color-text-muted)]">
                  La guía se prepara desde esta recepción y se coteja aquí mismo como segundo evento físico.
                </p>
              </div>
              <span className="font-mono text-xs text-[var(--color-text-subtle)]">
                {acquisitionGuides.length} {acquisitionGuides.length === 1 ? "guía" : "guías"}
              </span>
              <ReceiptGuideActions
                receiptId={receipt.id}
                canPrepare={receipt.locationType === "office"
                  && can(session, "warehouse:create_guide")
                  && acquisitionGuides.some((guide) => ["dispatched", "partially_received", "received"].includes(guide.status))}
              />
            </div>
            {acquisitionGuides.length === 0 ? (
              <p className="mt-4 rounded-[var(--radius-lg)] border border-dashed border-[var(--color-border)] px-3 py-3 text-sm text-[var(--color-text-muted)]">
                {receipt.locationType === "office"
                  ? "No hay bienes catalogados trasladables en esta recepción; los servicios y las compras destinadas a oficina no generan GDI."
                  : "Esta recepción no tiene una GDI asociada."}
              </p>
            ) : (
              <div className="mt-4 divide-y divide-[var(--color-border)] rounded-[var(--radius-lg)] border border-[var(--color-border)]">
                {acquisitionGuides.map((guide) => {
                  const active = ["dispatched", "partially_received", "received"].includes(guide.status)
                  const progressLabel = guide.status === "draft"
                    ? `${formatQty(guide.totalQuantity)} disponibles para despachar`
                    : `${formatQty(guide.totalQuantity)} despachadas · ${formatQty(guide.receivedQuantity)} cotejadas`
                  return (
                    <div key={guide.id} className="flex flex-wrap items-center justify-between gap-3 px-3 py-3">
                      <div className="min-w-0">
                        <Link href={`/bodega/guias/${guide.id}`} className="font-mono text-sm font-semibold text-[var(--color-text)] hover:underline">
                          {guide.code}
                        </Link>
                        <p className="mt-1 text-xs text-[var(--color-text-muted)]">
                          {guide.destinationWorksiteName} · {guide.itemCount} {guide.itemCount === 1 ? "línea" : "líneas"} · {progressLabel}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <StateBadge state={guide.status} entity="dispatch_guide" size="sm" />
                        {(guide.status === "draft" || guide.status === "dispatched") && (
                          <Button asChild size="sm" variant="secondary">
                            <Link href={`/bodega/guias/${guide.id}`}>
                              {guide.status === "draft" ? "Completar despacho" : "Cotejar en faena"}
                              <ArrowSquareOut size={13} aria-hidden />
                            </Link>
                          </Button>
                        )}
                        {active && guide.status === "partially_received" && (
                          <span className="sr-only">La guía tiene diferencias registradas</span>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </section>

          {receipt.notes && (
            <section className="rounded-[var(--radius-2xl)] bg-[var(--color-surface)] shadow-[var(--shadow-card)] p-5">
              <h2 className="text-sm font-semibold text-[var(--color-text)]">Observaciones</h2>
              <p className="mt-2 text-sm text-[var(--color-text-muted)] whitespace-pre-line">{receipt.notes}</p>
            </section>
          )}
        </div>

        {/* ── Sidebar: operational context ─────────────────────────────────── */}
        <aside className="space-y-6 lg:sticky lg:top-6">
          <section className="rounded-[var(--radius-2xl)] bg-[var(--color-surface)] shadow-[var(--shadow-card)] p-4">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-sm font-semibold text-[var(--color-text)]">Recepción</h2>
              <MetaBadge meta={{ label: "Registrada", variant: "success" }} dot />
            </div>
            {/*
              REC-003 (auditoría 2026-09-14), patrón P7: aquí se pintaba
              «Abierta — quedan líneas por conciliar; aún admite ajustes» para
              cualquier estado distinto de `closed`. Esa recepción no existe:
              `registerReceipt` inserta siempre `closed` y el `default('open')`
              del esquema está muerto. La ficha prometía una edición que no hay
              en ninguna pantalla, y el remedio real es otro —ver abajo—.
            */}
            <p className="mt-2 text-xs text-[var(--color-text-muted)]">
              Una recepción se registra completa y en un solo acto: mueve stock, avanza la
              orden de compra y cambia el estado de los ítems, todo en la misma transacción.
              No se edita después. Si lo recibido no coincide con lo registrado, la
              corrección es un ajuste de inventario en Bodega, que deja su propio folio y su
              motivo.
            </p>
            <dl className="mt-3 divide-y divide-[var(--color-border)]">
              <DetailItemShared label="Destino" value={destinationLabel} />
              <DetailItemShared label="Guía" value={receipt.dispatchGuideNo ?? "Sin guía"} mono />
              <DetailItemShared label="Recibido por" value={receipt.receivedBy?.name ?? "Usuario"} />
              <DetailItemShared label="Fecha" value={formatDateTime(receipt.receivedAt)} mono />
            </dl>
          </section>

          <section className="rounded-[var(--radius-2xl)] bg-[var(--color-surface)] shadow-[var(--shadow-card)] p-4">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-sm font-semibold text-[var(--color-text)]">Orden de compra</h2>
              <StateBadge state={receipt.purchaseOrder.status} entity="oc" size="sm" />
            </div>
            <dl className="mt-3 divide-y divide-[var(--color-border)]">
              <DetailItemShared label="OC" value={receipt.purchaseOrder.code} mono />
              <DetailItemShared label="Proveedor" value={receipt.purchaseOrder.supplier?.name ?? "—"} />
              <DetailItemShared label="Faena" value={receipt.purchaseOrder.worksite?.name ?? "—"} />
              <DetailItemShared label="Total OC" value={formatCLP(receipt.purchaseOrder.totalAmount)} mono />
            </dl>
            <Button asChild variant="secondary" size="sm" className="mt-3 w-full">
              <Link href={`/compras/${receipt.purchaseOrderId}`}>
                Ver OC
                <ArrowSquareOut size={13} aria-hidden />
              </Link>
            </Button>
            <div className="mt-3 border-t border-(--color-border) pt-3">
              <p className="text-xs font-medium text-(--color-text)">Facturas relacionadas ({linkedInvoices.length})</p>
              {linkedInvoices.length > 0 ? (
                <ul className="mt-1.5 space-y-1">
                  {linkedInvoices.map((invoice) => (
                    <li key={invoice.id} className="text-xs text-(--color-text-muted)">
                      {canViewInvoices ? (
                        <a
                          href={`/api/purchase-orders/invoices/${invoice.id}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="font-medium text-(--color-text) hover:underline"
                        >
                          {invoice.invoiceNumber}
                        </a>
                      ) : invoice.invoiceNumber}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-1 text-xs text-(--color-text-muted)">Esta recepción aún no tiene factura asociada.</p>
              )}
            </div>

            {canAttachInvoice ? (
              <Button asChild variant="signal" size="sm" className="mt-2 w-full">
                <Link href={`/compras/${receipt.purchaseOrderId}?tab=facturacion&receiptId=${encodeURIComponent(receipt.id)}`}>
                  {linkedInvoices.length > 0 ? "Adjuntar otra factura" : "Adjuntar factura"}
                  <ArrowSquareOut size={13} aria-hidden />
                </Link>
              </Button>
            ) : linkedInvoices.length === 0 ? (
              <p className="mt-2 text-xs text-[var(--color-text-muted)]">
                La factura la adjunta quien compra.
              </p>
            ) : null}
          </section>

          <section className="rounded-[var(--radius-2xl)] bg-[var(--color-surface)] shadow-[var(--shadow-card)] p-4">
            <h2 className="text-sm font-semibold text-[var(--color-text)]">Calidad</h2>
            <dl className="mt-3 divide-y divide-[var(--color-border)]">
              <QtyLine label="Líneas recibidas" value={lineCount} />
              <QtyLine label="Rechazado" value={totalRejected} signal={totalRejected > 0} />
              <QtyLine label="Dañado" value={totalDamaged} signal={totalDamaged > 0} />
            </dl>
            {totalRejected === 0 && totalDamaged === 0 && (
              <p className="mt-3 text-xs text-[var(--color-text-subtle)]">Sin rechazos ni daños registrados.</p>
            )}
          </section>
        </aside>
      </div>
    </PageContainer>
  )
}

// Detalle: mismo patrón que el resto de las fichas (`DetailItem`).

function QtyLine({ label, value, signal = false }: { label: string; value: number; signal?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 py-2.5">
      <dt className="text-xs text-[var(--color-text-subtle)]">{label}</dt>
      <dd className={cn(
        "text-right font-mono text-sm font-semibold tabular-nums",
        signal ? "text-[var(--color-signal-ink)]" : "text-[var(--color-text)]",
      )}>
        {value}
      </dd>
    </div>
  )
}
