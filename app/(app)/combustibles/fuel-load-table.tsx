"use client"

import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { CaretLeft, CaretRight } from "@phosphor-icons/react"
import { formatCLP, formatDate } from "@/lib/utils"
import { FUEL_LOAD_STATUS_LABELS as statusLabels } from "@/lib/combustibles/labels"

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
  totalPages: number
  total: number
}

const LITERS_FORMAT = new Intl.NumberFormat("es-CL", { maximumFractionDigits: 0 })
const formatLiters = (n: number) => LITERS_FORMAT.format(n)

export function FuelLoadTable({ rows, page, totalPages, total }: FuelLoadTableProps) {
  const searchParams = useSearchParams()
  // `?page=N` a secas borraba proveedor, faena, estado y período: pasar a la
  // página 2 devolvía el listado sin filtrar.
  const pageHref = (target: number) => {
    const params = new URLSearchParams(searchParams.toString())
    params.set("page", String(target))
    return `?${params.toString()}`
  }
  const hasPrev = page > 1
  const hasNext = page < totalPages

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <p className="text-sm text-[var(--color-text-muted)]">{total} cargas encontradas</p>
        <div className="flex items-center gap-2">
          {/* `disabled` sobre un <Button asChild> se pierde en el <Link>: el
              botón seguía navegando. Fuera del rango se rinde sin enlace. */}
          {hasPrev ? (
            <Button asChild variant="secondary" size="sm">
              <Link href={pageHref(page - 1)} aria-label="Página anterior"><CaretLeft className="h-4 w-4" aria-hidden /></Link>
            </Button>
          ) : (
            <Button variant="secondary" size="sm" disabled aria-label="Página anterior"><CaretLeft className="h-4 w-4" aria-hidden /></Button>
          )}
          <span className="text-sm">Página {page} de {totalPages || 1}</span>
          {hasNext ? (
            <Button asChild variant="secondary" size="sm">
              <Link href={pageHref(page + 1)} aria-label="Página siguiente"><CaretRight className="h-4 w-4" aria-hidden /></Link>
            </Button>
          ) : (
            <Button variant="secondary" size="sm" disabled aria-label="Página siguiente"><CaretRight className="h-4 w-4" aria-hidden /></Button>
          )}
        </div>
      </div>

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
                const st = statusLabels[row.status] ?? { label: row.status, variant: "default" as const }
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
                      {row.odometerReading != null ? formatLiters(row.odometerReading) : row.hourMeterReading != null ? `${formatLiters(row.hourMeterReading)} h` : "—"}
                    </TableCell>
                    <TableCell className="text-right font-mono">{formatLiters(row.liters)}</TableCell>
                    <TableCell className="text-right font-mono">{formatCLP(row.totalAmount)}</TableCell>
                    <TableCell><Badge variant={st.variant}>{st.label}</Badge></TableCell>
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
    </div>
  )
}
