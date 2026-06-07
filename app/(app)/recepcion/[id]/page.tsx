import type { Metadata } from "next"
import Link from "next/link"
import { notFound, redirect } from "next/navigation"
import { db } from "@/db"
import { receipts } from "@/db/schema"
import { eq } from "drizzle-orm"
import { canAccessWorksite, requirePermission } from "@/lib/auth/can"
import { PageHeader, Breadcrumbs } from "@/components/ui/page-header"
import { Badge } from "@/components/ui/badge"
import {
  TableRoot, Table, TableHeader, TableBody,
  TableRow, TableHead, TableCell, TableCellNum,
} from "@/components/ui/table"
import { formatDateTime, formatQty } from "@/lib/utils"
import { ArrowSquareOut } from "@phosphor-icons/react/dist/ssr"

export const metadata: Metadata = { title: "Detalle de recepción" }

export default async function RecepcionDetallePage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  let session
  try { session = await requirePermission("receiving:view") }
  catch { redirect("/dashboard") }

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
  const destinationLabel = receipt.locationType === "warehouse"
    ? "Ingreso a bodega"
    : `Directo a ${receipt.worksite?.name ?? receipt.purchaseOrder.worksite?.name ?? "faena"}`

  return (
    <>
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
        actions={
          <Link
            href={`/compras/${receipt.purchaseOrderId}`}
            className="inline-flex h-8 items-center gap-1.5 rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-surface-2)] px-3 text-xs font-medium text-[var(--color-text)] transition-transform duration-[var(--duration-fast)] active:scale-[0.98]"
          >
            Ver OC
            <ArrowSquareOut size={13} />
          </Link>
        }
      />

      <div className="max-w-4xl space-y-5">
        <section className="grid gap-px overflow-hidden rounded-[var(--radius-lg)] bg-[var(--color-border)] md:grid-cols-4">
          <SummaryCell label="Destino" value={destinationLabel} />
          <SummaryCell label="Guía" value={receipt.dispatchGuideNo ?? "Sin guía"} mono />
          <SummaryCell label="Recibido por" value={receipt.receivedBy?.name ?? "Usuario"} />
          <SummaryCell label="Fecha" value={formatDateTime(receipt.receivedAt)} mono />
        </section>

        <section className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-sm font-semibold text-[var(--color-text)]">Ítems recibidos</h2>
            <Badge variant="success" size="sm" dot>{receipt.status === "closed" ? "Cerrada" : receipt.status}</Badge>
          </div>

          <TableRoot>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Producto</TableHead>
                  <TableHead className="text-right">Recibido</TableHead>
                  <TableHead className="text-right">Rechazado</TableHead>
                  <TableHead className="text-right">Dañado</TableHead>
                  <TableHead>Nota</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {receipt.items.map((item) => {
                  const ocItem = item.purchaseOrderItem
                  const product = ocItem.productId ? productMap[ocItem.productId] : null
                  const productName = product?.name ?? ocItem.productNameFree ?? "(sin nombre)"

                  return (
                    <TableRow key={item.id}>
                      <TableCell>
                        <div className="font-medium text-[var(--color-text)]">{productName}</div>
                        {product?.sku && (
                          <div className="mt-0.5 font-mono text-[11px] text-[var(--color-text-subtle)]">{product.sku}</div>
                        )}
                      </TableCell>
                      <TableCellNum>{formatQty(item.quantityReceived, ocItem.unitOfMeasure)}</TableCellNum>
                      <TableCellNum>{formatQty(item.quantityRejected, ocItem.unitOfMeasure)}</TableCellNum>
                      <TableCellNum>{formatQty(item.quantityDamaged, ocItem.unitOfMeasure)}</TableCellNum>
                      <TableCell className="text-sm text-[var(--color-text-muted)]">{item.notes ?? "—"}</TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </TableRoot>
        </section>
      </div>
    </>
  )
}

function SummaryCell({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="bg-[var(--color-surface)] p-4">
      <p className="text-xs font-medium text-[var(--color-text-subtle)]">{label}</p>
      <p className={mono
        ? "mt-1 font-mono text-sm text-[var(--color-text)]"
        : "mt-1 text-sm font-medium text-[var(--color-text)]"}
      >
        {value}
      </p>
    </div>
  )
}
