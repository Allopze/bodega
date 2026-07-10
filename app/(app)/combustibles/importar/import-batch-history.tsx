"use client"

import Link from "next/link"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { formatCLP, formatQty, formatDateTime } from "@/lib/utils"

interface BatchRow {
  id: string
  worksite: { name: string } | null
  fuente: string | null
  periodoDesde: string
  periodoHasta: string
  archivoNombre: string
  totalFilas: number
  filasValidas: number
  filasInvalidas: number
  totalCantidad: number
  totalMonto: number
  estado: string
  createdAt: string
  importer: { name: string | null; email: string | null } | null
}

export function ImportBatchHistory({ batches }: { batches: BatchRow[] }) {
  if (batches.length === 0) {
    return (
      <div className="rounded-[var(--radius-lg)] border border-dashed border-[var(--color-border)] bg-[var(--color-surface-2)] px-4 py-8 text-center text-sm text-[var(--color-text-muted)]">
        Aún no se han importado lotes de consumo de combustible.
      </div>
    )
  }

  return (
    <div className="border rounded-lg overflow-x-auto">
      <Table className="min-w-[900px]">
        <TableHeader>
          <TableRow>
            <TableHead>Fecha</TableHead>
            <TableHead>Faena</TableHead>
            <TableHead>Período</TableHead>
            <TableHead>Fuente</TableHead>
            <TableHead>Archivo</TableHead>
            <TableHead className="text-right">Filas</TableHead>
            <TableHead className="text-right">Cantidad</TableHead>
            <TableHead className="text-right">Monto</TableHead>
            <TableHead>Estado</TableHead>
            <TableHead>Importado por</TableHead>
            <TableHead className="w-12"></TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {batches.map((b) => (
            <TableRow key={b.id}>
              <TableCell className="font-mono text-xs">{formatDateTime(b.createdAt)}</TableCell>
              <TableCell>{b.worksite?.name ?? "—"}</TableCell>
              <TableCell className="font-mono text-xs">{b.periodoDesde} — {b.periodoHasta}</TableCell>
              <TableCell>{b.fuente ?? "—"}</TableCell>
              <TableCell className="max-w-40 truncate" title={b.archivoNombre}>{b.archivoNombre}</TableCell>
              <TableCell className="text-right font-mono text-xs">
                {formatQty(b.filasValidas)}
                {b.filasInvalidas > 0 && <span className="text-[var(--color-danger)]"> ({b.filasInvalidas} err.)</span>}
              </TableCell>
              <TableCell className="text-right font-mono">{formatQty(Math.round(b.totalCantidad), "L")}</TableCell>
              <TableCell className="text-right font-mono">{formatCLP(b.totalMonto)}</TableCell>
              <TableCell>
                <Badge variant={b.estado === "revertido" ? "danger" : "success"} size="sm">
                  {b.estado === "revertido" ? "Revertido" : "Importado"}
                </Badge>
              </TableCell>
              <TableCell className="text-xs text-muted-foreground max-w-32 truncate">{b.importer?.name ?? b.importer?.email ?? "—"}</TableCell>
              <TableCell>
                <Button asChild variant="ghost" size="sm">
                  <Link href={`/combustibles/importar/${b.id}`}>Ver</Link>
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}
