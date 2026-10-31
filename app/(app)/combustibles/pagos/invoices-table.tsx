import Link from "next/link"
import { FuelTerm } from "@/components/combustibles/fuel-glossary"
import { MetaBadge, metaFor } from "@/components/states/state-badge"
import { Button } from "@/components/ui/button"
import { ResponsiveDataListCard, ResponsiveDataListField } from "@/components/ui/responsive-data-list"
import { ServerPagination } from "@/components/ui/server-pagination"
import { Table, TableBody, TableCell, TableCellNum, TableHead, TableHeader, TableRoot, TableRow } from "@/components/ui/table"
import { FUEL_LOAD_STATUS_LABELS } from "@/lib/combustibles/labels"
import { fuelLoadHref } from "@/lib/combustibles/routes"
import type { PaginationState } from "@/lib/pagination"
import { formatCLP, formatDate, formatQty } from "@/lib/utils"
import { SERVICE_TYPE_LABELS, invoiceEquipmentLabel } from "./invoice-params"

export interface InvoiceRow {
  id: string
  loadDate: string
  serviceType: string
  product: string
  receiptNumber: string | null
  odometerReading: number | null
  hourMeterReading: number | null
  liters: number
  baseAmount: number
  iecTotal: number
  ivaAmount: number
  totalAmount: number
  status: string
  vehicle: { code: string | null; plate: string } | null
  supplierName: string | null
  worksiteName: string | null
}

/** Lectura del medidor al cargar: kilómetros o horas, lo que tenga el equipo. */
function meterText(row: Pick<InvoiceRow, "odometerReading" | "hourMeterReading">): string | null {
  if (row.odometerReading != null) return `${formatQty(row.odometerReading)} km`
  if (row.hourMeterReading != null) return `${formatQty(row.hourMeterReading)} h`
  return null
}

/**
 * Lista de «Pagos › Facturas»: una fila por carga facturada, con el neto, el IEC
 * y el IVA como columnas (antes sólo se veía el total). La misma información sale
 * dos veces —tarjetas bajo `md`, tabla desde `md`— porque a 390 px una tabla de
 * 12 columnas queda tras un desplazamiento horizontal. Cada fila lleva a la ficha
 * de la carga.
 */
export function InvoicesTable({
  rows,
  pagination,
  hrefForPage,
}: {
  rows: InvoiceRow[]
  pagination: PaginationState
  hrefForPage: (page: number) => string
}) {
  return (
    <div>
      <p className="mb-3 text-sm text-[var(--color-text-muted)]" aria-live="polite">
        <span className="font-mono tabular-nums">{formatQty(pagination.totalItems)}</span>{" "}
        {pagination.totalItems === 1 ? "carga" : "cargas"} en esta lista
      </p>

      <div className="grid grid-cols-1 gap-2 md:hidden">
        {rows.map((row) => {
          const status = metaFor(FUEL_LOAD_STATUS_LABELS, row.status)
          const href = fuelLoadHref({ origen: "factura", id: row.id })
          return (
            <ResponsiveDataListCard
              key={row.id}
              title={<Link href={href}>{invoiceEquipmentLabel(row.vehicle)}</Link>}
              description={`${formatDate(row.loadDate)} · ${row.supplierName ?? "—"} · ${row.worksiteName ?? "—"}`}
              status={<MetaBadge meta={status} />}
              actions={
                <Button asChild variant="primary" size="sm" className="w-full">
                  <Link href={href}>{row.receiptNumber ? `Ver factura ${row.receiptNumber}` : "Ver factura"}</Link>
                </Button>
              }
            >
              <ResponsiveDataListField label="N.º factura"><span className="font-mono">{row.receiptNumber ?? "—"}</span></ResponsiveDataListField>
              <ResponsiveDataListField label="Litros"><span className="font-mono tabular-nums">{formatQty(row.liters)} L</span></ResponsiveDataListField>
              <ResponsiveDataListField label="Neto"><span className="font-mono tabular-nums">{formatCLP(row.baseAmount)}</span></ResponsiveDataListField>
              <ResponsiveDataListField label="IEC"><span className="font-mono tabular-nums">{formatCLP(row.iecTotal)}</span></ResponsiveDataListField>
              <ResponsiveDataListField label="IVA"><span className="font-mono tabular-nums">{formatCLP(row.ivaAmount)}</span></ResponsiveDataListField>
              <ResponsiveDataListField label="Total"><span className="font-mono font-semibold tabular-nums">{formatCLP(row.totalAmount)}</span></ResponsiveDataListField>
            </ResponsiveDataListCard>
          )
        })}
      </div>

      <TableRoot className="hidden md:block" aria-label="Facturas de combustible">
        <Table className="min-w-[1180px]">
          <TableHeader>
            <TableRow>
              <TableHead>Fecha</TableHead>
              <TableHead>Equipo</TableHead>
              <TableHead>Proveedor</TableHead>
              <TableHead>Faena</TableHead>
              <TableHead>Producto</TableHead>
              <TableHead>N.º factura</TableHead>
              <TableHead className="text-right">Litros</TableHead>
              <TableHead className="text-right">Neto</TableHead>
              <TableHead className="text-right"><FuelTerm term="IEC">IEC</FuelTerm></TableHead>
              <TableHead className="text-right"><FuelTerm term="IVA">IVA</FuelTerm></TableHead>
              <TableHead className="text-right">Total</TableHead>
              <TableHead>Estado</TableHead>
              <TableHead><span className="sr-only">Abrir</span></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => {
              const status = metaFor(FUEL_LOAD_STATUS_LABELS, row.status)
              const href = fuelLoadHref({ origen: "factura", id: row.id })
              const meter = meterText(row)
              return (
                <TableRow key={row.id}>
                  <TableCell className="whitespace-nowrap font-mono text-sm">{formatDate(row.loadDate)}</TableCell>
                  <TableCell className="whitespace-nowrap">
                    <span className="font-mono font-semibold">{invoiceEquipmentLabel(row.vehicle)}</span>
                    {meter && <span className="block text-xs text-[var(--color-text-subtle)]"><span className="font-mono tabular-nums">{meter}</span></span>}
                  </TableCell>
                  <TableCell>
                    {row.supplierName ?? "—"}
                    <span className="block text-xs text-[var(--color-text-subtle)]">{SERVICE_TYPE_LABELS[row.serviceType] ?? row.serviceType}</span>
                  </TableCell>
                  <TableCell className="max-w-40 truncate" title={row.worksiteName ?? undefined}>{row.worksiteName ?? "—"}</TableCell>
                  <TableCell>{row.product}</TableCell>
                  <TableCell className="font-mono text-sm">{row.receiptNumber ?? "—"}</TableCell>
                  <TableCellNum>{formatQty(row.liters)}</TableCellNum>
                  <TableCellNum>{formatCLP(row.baseAmount)}</TableCellNum>
                  <TableCellNum>{formatCLP(row.iecTotal)}</TableCellNum>
                  <TableCellNum>{formatCLP(row.ivaAmount)}</TableCellNum>
                  <TableCellNum className="font-semibold">{formatCLP(row.totalAmount)}</TableCellNum>
                  <TableCell><MetaBadge meta={status} /></TableCell>
                  <TableCell>
                    <Button asChild variant="ghost" size="sm">
                      <Link href={href} aria-label={`Ver la factura ${row.receiptNumber ?? "sin número"} del ${formatDate(row.loadDate)}`}>Ver</Link>
                    </Button>
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </TableRoot>
      <ServerPagination pagination={pagination} hrefForPage={hrefForPage} className="mt-3" />
    </div>
  )
}
