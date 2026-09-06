"use client"

import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { MetaBadge, metaFor } from "@/components/states/state-badge"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Button } from "@/components/ui/button"
import { formatCLP, formatDate, formatQty } from "@/lib/utils"
import { FUEL_LOAD_STATUS_LABELS as statusLabels } from "@/lib/combustibles/labels"
import { ServerPagination } from "@/components/ui/server-pagination"
import { buildPaginationHref, resolvePagination } from "@/lib/pagination"

interface FuelLoadRow {
  id: string
  loadDate: string
  serviceType: string
  product: string
  receiptNumber: string | null
  odometerReading: number | null
  hourMeterReading: number | null
  liters: number
  totalAmount: number
  status: string
  vehicle: { plate: string } | null
  supplier: { name: string } | null
  worksite: { name: string } | null
}

interface FuelLoadTableProps {
  rows: FuelLoadRow[]
  page: number
  total: number
  pageSize: number
}


export function FuelLoadTable({ rows, page, total, pageSize }: FuelLoadTableProps) {
  const searchParams = useSearchParams()
  // `?page=N` a secas borraba proveedor, faena, estado y período: pasar a la
  // página 2 devolvía el listado sin filtrar.
  const pageHref = (target: number) => buildPaginationHref(
    "/combustibles/facturas",
    Object.fromEntries(searchParams.entries()),
    target,
  )
  const pagination = resolvePagination({ pageParam: String(page), totalItems: total, pageSize })

  return (
    <div>
      <p className="mb-3 text-sm text-[var(--color-text-muted)]">{total} cargas encontradas</p>

      <div className="border rounded-lg overflow-x-auto -mx-4 px-4 sm:mx-0 sm:px-0">
        <Table className="min-w-[800px]">
          <TableHeader>
            <TableRow>
              <TableHead>Fecha</TableHead>
              <TableHead>Servicio</TableHead>
              <TableHead>Vehículo</TableHead>
              <TableHead>Proveedor</TableHead>
              <TableHead>Faena</TableHead>
              <TableHead>Producto</TableHead>
              <TableHead>Nro Factura</TableHead>
              <TableHead className="text-right">Km/Hr</TableHead>
              <TableHead className="text-right">Litros</TableHead>
              <TableHead className="text-right">Total</TableHead>
              <TableHead>Estado</TableHead>
              <TableHead className="w-12"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={12} className="text-center py-8 text-[var(--color-text-muted)]">
                  No hay cargas de combustible registradas
                </TableCell>
              </TableRow>
            ) : (
              rows.map((row) => {
                const st = metaFor(statusLabels, row.status)
                return (
                  <TableRow key={row.id}>
                    <TableCell className="font-mono text-sm">{formatDate(row.loadDate)}</TableCell>
                    <TableCell>{row.serviceType}</TableCell>
                    <TableCell>{row.vehicle?.plate ?? "—"}</TableCell>
                    <TableCell>{row.supplier?.name ?? "—"}</TableCell>
                    <TableCell className="max-w-40 truncate">{row.worksite?.name ?? "—"}</TableCell>
                    <TableCell>{row.product}</TableCell>
                    <TableCell className="font-mono text-sm">{row.receiptNumber ?? "—"}</TableCell>
                    <TableCell className="text-right font-mono text-sm">
                      {row.odometerReading != null ? formatQty(row.odometerReading) : row.hourMeterReading != null ? `${formatQty(row.hourMeterReading)} h` : "—"}
                    </TableCell>
                    <TableCell className="text-right font-mono">{formatQty(row.liters)}</TableCell>
                    <TableCell className="text-right font-mono">{formatCLP(row.totalAmount)}</TableCell>
                    <TableCell><MetaBadge meta={st} /></TableCell>
                    <TableCell>
                      <Button asChild variant="ghost" size="sm">
                        <Link href={`/combustibles/${row.id}`}>Ver</Link>
                      </Button>
                    </TableCell>
                  </TableRow>
                )
              })
            )}
          </TableBody>
        </Table>
      </div>
      <ServerPagination pagination={pagination} hrefForPage={pageHref} className="mt-3" />
    </div>
  )
}
