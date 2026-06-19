import type { Metadata } from "next"
import Link from "next/link"
import { notFound, redirect } from "next/navigation"
import { db } from "@/db"
import { receipts } from "@/db/schema"
import { eq } from "drizzle-orm"
import { canAccessWorksite, requirePermission } from "@/lib/auth/can"
import { PageHeader, Breadcrumbs } from "@/components/ui/page-header"
import { PageContainer } from "@/components/ui/page-container"
import { Badge } from "@/components/ui/badge"
import { StateBadge } from "@/components/states/state-badge"
import {
  TableRoot, Table, TableHeader, TableBody,
  TableRow, TableHead, TableCell, TableCellNum,
} from "@/components/ui/table"
import { cn, formatCLP, formatDateTime, formatQty } from "@/lib/utils"
import { ArrowSquareOut } from "@phosphor-icons/react/dist/ssr"

export const metadata: Metadata = { title: "Detalle de recepción" }

export default async function RecepcionDetallePage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  let session
  try { session = await requirePermission("receiving:view") }
  catch { redirect("/forbidden") }

  const { id } = await params
  const receipt = await db.query.receipts.findFirst({
    where: eq(receipts.id, id),
    with: {
      purchaseOrder: { with: { worksite: true, supplier: true } },
      worksite: true,
      receivedBy: true,
      items: {
        with: {
          purchaseOrderItem: true,
        },
      },
    },
  })

  if (!receipt) notFound()

  const worksiteId = receipt.worksiteId ?? receipt.purchaseOrder.worksiteId
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

  const productMap = Object.fromEntries(productRows.map((product) => [product.id, product]))
  const destinationLabel = receipt.locationType === "office"
    ? "Oficina Chome"
    : `Faena ${receipt.worksite?.name ?? receipt.purchaseOrder.worksite?.name ?? ""}`.trim()

  const totalRejected = receipt.items.reduce((sum, item) => sum + (item.quantityRejected ?? 0), 0)
  const totalDamaged  = receipt.items.reduce((sum, item) => sum + (item.quantityDamaged ?? 0), 0)
  const lineCount = receipt.items.length

  return (
    <PageContainer width="workbench">
      <PageHeader
        title={receipt.code}
        description={`Recepción de ${receipt.purchaseOrder.code} · ${receipt.purchaseOrder.supplier?.name ?? "Proveedor sin nombre"}`}
        breadcrumb={
          <Breadcrumbs items={[
            { label: "Dashboard", href: "/dashboard" },
            { label: "Recepción", href: "/recepcion" },
            { label: receipt.code },
          ]} />
        }
      />

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
                    const productName = product?.name ?? ocItem.productNameFree ?? "(sin nombre)"
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
                                <Badge variant="danger" size="sm">Rechazado {formatQty(item.quantityRejected, ocItem.unitOfMeasure)}</Badge>
                              )}
                              {(item.quantityDamaged ?? 0) > 0 && (
                                <Badge variant="warning" size="sm">Dañado {formatQty(item.quantityDamaged, ocItem.unitOfMeasure)}</Badge>
                              )}
                            </div>
                          )}
                        </TableCell>
                        <TableCellNum>
                          {formatQty(item.quantityReceived, ocItem.unitOfMeasure)}
                          <div className="mt-0.5 text-[11px] font-normal text-[var(--color-text-subtle)]">
                            En oficina: {formatQty(ocItem.quantityOfficeReceived ?? 0, ocItem.unitOfMeasure)}
                            {pendingToFaena > 0 && ` · pend. faena: ${formatQty(pendingToFaena, ocItem.unitOfMeasure)}`}
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
              <Badge variant={receipt.status === "closed" ? "success" : "info"} size="sm" dot>
                {receipt.status === "closed" ? "Cerrada" : "Abierta"}
              </Badge>
            </div>
            <dl className="mt-3 divide-y divide-[var(--color-border)]">
              <DetailLine label="Destino" value={destinationLabel} />
              <DetailLine label="Guía" value={receipt.dispatchGuideNo ?? "Sin guía"} mono />
              <DetailLine label="Recibido por" value={receipt.receivedBy?.name ?? "Usuario"} />
              <DetailLine label="Fecha" value={formatDateTime(receipt.receivedAt)} mono />
            </dl>
          </section>

          <section className="rounded-[var(--radius-2xl)] bg-[var(--color-surface)] shadow-[var(--shadow-card)] p-4">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-sm font-semibold text-[var(--color-text)]">Orden de compra</h2>
              <StateBadge state={receipt.purchaseOrder.status} entity="oc" size="sm" />
            </div>
            <dl className="mt-3 divide-y divide-[var(--color-border)]">
              <DetailLine label="OC" value={receipt.purchaseOrder.code} mono />
              <DetailLine label="Proveedor" value={receipt.purchaseOrder.supplier?.name ?? "—"} />
              <DetailLine label="Faena" value={receipt.purchaseOrder.worksite?.name ?? "—"} />
              <DetailLine label="Total OC" value={formatCLP(receipt.purchaseOrder.totalAmount)} mono />
            </dl>
            <Link
              href={`/compras/${receipt.purchaseOrderId}`}
              className="mt-3 inline-flex h-8 w-full items-center justify-center gap-1.5 rounded-[var(--radius)] bg-[var(--color-surface-2)] px-3 text-xs font-medium text-[var(--color-text)] transition-transform duration-[var(--duration-fast)] active:scale-[0.98] hover:bg-[var(--color-border)]"
            >
              Ver orden de compra
              <ArrowSquareOut size={13} />
            </Link>
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

function DetailLine({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 py-2.5">
      <dt className="text-xs text-[var(--color-text-subtle)]">{label}</dt>
      <dd className={cn(
        "text-right text-xs font-medium text-[var(--color-text)]",
        mono && "font-mono tabular-nums",
      )}>
        {value}
      </dd>
    </div>
  )
}

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
