"use client"

import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { CaretLeft, CaretRight } from "@phosphor-icons/react"
import { formatCLP, formatQty } from "@/lib/utils"
import { buildConsumptionHref } from "./consumption-url"

interface ConsumptionRecordRow {
  id: string
  batchId: string
  patente: string
  numeroTarjetas: number
  numeroTransacciones: number
  cantidadUnidad: number
  monto: number
  precioPromedioUnidad: number | null
  rendimientoPromedio: number
  periodoDesde: string
  periodoHasta: string
  fuente: string | null
  vehicle: { id: string; plate: string; type: string } | null
}

interface ConsumptionDetailTableProps {
  rows: ConsumptionRecordRow[]
  page: number
  totalPages: number
  total: number
}

export function ConsumptionDetailTable({ rows, page, totalPages, total }: ConsumptionDetailTableProps) {
  const searchParams = useSearchParams()
  const pageHref = (nextPage: number) => buildConsumptionHref(
    searchParams.toString(),
    { page: String(nextPage) },
    { resetPage: false },
  )

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <p className="text-sm text-muted-foreground">{total} registros encontrados</p>
        <div className="flex items-center gap-2">
          <Button asChild variant="secondary" size="sm" disabled={page <= 1}>
            <Link href={pageHref(page - 1)} aria-label="Página anterior"><CaretLeft className="h-4 w-4" /></Link>
          </Button>
          <span className="text-sm">Página {page} de {totalPages || 1}</span>
          <Button asChild variant="secondary" size="sm" disabled={page >= totalPages}>
            <Link href={pageHref(page + 1)} aria-label="Página siguiente"><CaretRight className="h-4 w-4" /></Link>
          </Button>
        </div>
      </div>

      <div className="border rounded-lg overflow-x-auto -mx-4 px-4 sm:mx-0 sm:px-0">
        <Table className="min-w-[960px]">
          <TableHeader>
            <TableRow>
              <TableHead>Patente</TableHead>
              <TableHead>Vehículo/equipo</TableHead>
              <TableHead className="text-right">Tarjetas</TableHead>
              <TableHead className="text-right">Transacc.</TableHead>
              <TableHead className="text-right">Cantidad</TableHead>
              <TableHead className="text-right">Monto</TableHead>
              <TableHead className="text-right">Precio prom.</TableHead>
              <TableHead className="text-right">Rendimiento</TableHead>
              <TableHead>Período</TableHead>
              <TableHead>Fuente</TableHead>
              <TableHead className="w-12"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={11} className="text-center py-8 text-muted-foreground">
                  No hay registros de consumo importados para estos filtros
                </TableCell>
              </TableRow>
            ) : (
              rows.map((row) => (
                <TableRow key={row.id} className={row.vehicle ? undefined : "bg-[var(--color-warning-tint)]"}>
                  <TableCell className="font-mono text-sm">{row.patente}</TableCell>
                  <TableCell>
                    {row.vehicle
                      ? row.vehicle.plate
                      : <Badge variant="warning" size="sm">Sin asociar</Badge>}
                  </TableCell>
                  <TableCell className="text-right font-mono">{formatQty(row.numeroTarjetas)}</TableCell>
                  <TableCell className="text-right font-mono">{formatQty(row.numeroTransacciones)}</TableCell>
                  <TableCell className="text-right font-mono">{formatQty(row.cantidadUnidad, "L")}</TableCell>
                  <TableCell className="text-right font-mono">{formatCLP(row.monto)}</TableCell>
                  <TableCell className="text-right font-mono">
                    {row.precioPromedioUnidad != null ? `${formatCLP(row.precioPromedioUnidad)}/L` : "—"}
                  </TableCell>
                  <TableCell className="text-right font-mono">{row.rendimientoPromedio > 0 ? row.rendimientoPromedio.toFixed(2) : "—"}</TableCell>
                  <TableCell className="font-mono text-xs">{row.periodoDesde} a {row.periodoHasta}</TableCell>
                  <TableCell className="max-w-32 truncate">{row.fuente ?? "—"}</TableCell>
                  <TableCell>
                    <Button asChild variant="ghost" size="sm">
                      <Link href={`/combustibles/importar/${row.batchId}`}>Ver lote</Link>
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
