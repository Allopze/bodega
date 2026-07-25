"use client"

import { useState, useMemo } from "react"
import Link from "next/link"
import { DataTable, type ColumnDef } from "@/components/admin/data-table"
import { TableCell, TableRow } from "@/components/ui/table"
import { DesktopOnlyTableNotice } from "@/components/ui/desktop-only-table"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { formatCLP, formatQty, formatDateTime } from "@/lib/utils"

interface OperationBatchRow {
  id: string
  periodoDesde: string
  periodoHasta: string
  archivoNombre: string
  totalEquipos: number
  filasValidas: number
  filasInvalidas: number
  totalLitros: number
  totalMonto: number
  estado: string
  createdAt: string
  importer: { name: string | null; email: string | null } | null
}

interface OperationBatchRowFlat {
  id: string
  periodoLabel: string
  archivoNombre: string
  totalEquipos: number
  filasValidas: number
  filasInvalidas: number
  totalLitros: number
  totalMonto: number
  estado: string
  createdAt: string
  importerName: string
}

const COLUMNS: ColumnDef[] = [
  { key: "createdAt", label: "Fecha", sortable: true, width: "w-36" },
  { key: "periodoLabel", label: "Período", sortable: true, width: "w-44" },
  { key: "archivoNombre", label: "Archivo", sortable: true },
  { key: "totalEquipos", label: "Equipos", sortable: true, numeric: true },
  { key: "filasValidas", label: "Filas", sortable: true, numeric: true },
  { key: "totalLitros", label: "Litros", sortable: true, numeric: true },
  { key: "totalMonto", label: "Monto", sortable: true, numeric: true },
  { key: "estado", label: "Estado", sortable: true },
  { key: "importerName", label: "Importado por", sortable: true },
  { key: "actions", label: "", width: "w-12" },
]

const SEARCH_KEYS = ["archivoNombre", "importerName", "periodoLabel"]

function flatRow(b: OperationBatchRow): OperationBatchRowFlat {
  return {
    id: b.id,
    periodoLabel: `${b.periodoDesde} — ${b.periodoHasta}`,
    archivoNombre: b.archivoNombre,
    totalEquipos: b.totalEquipos,
    filasValidas: b.filasValidas,
    filasInvalidas: b.filasInvalidas,
    totalLitros: Math.round(b.totalLitros),
    totalMonto: b.totalMonto,
    estado: b.estado,
    createdAt: b.createdAt,
    importerName: b.importer?.name ?? b.importer?.email ?? "—",
  }
}

export function OperationsBatchHistory({ batches }: { batches: OperationBatchRow[] }) {
  const [estadoFilter, setEstadoFilter] = useState("todas")

  const flatRows = useMemo(() => batches.map(flatRow), [batches])

  const preFiltered = useMemo(() => {
    let rows = flatRows
    if (estadoFilter !== "todas") rows = rows.filter((r) => r.estado === estadoFilter)
    return rows
  }, [flatRows, estadoFilter])

  const renderRow = (row: Record<string, unknown>, _index: number) => {
    const r = row as unknown as OperationBatchRowFlat
    return (
      <TableRow key={r.id}>
        <TableCell className="font-mono text-xs">{formatDateTime(r.createdAt)}</TableCell>
        <TableCell className="font-mono text-xs">{r.periodoLabel}</TableCell>
        <TableCell className="max-w-40 truncate" title={r.archivoNombre}>{r.archivoNombre}</TableCell>
        <TableCell className="text-right font-mono">{formatQty(r.totalEquipos)}</TableCell>
        <TableCell className="text-right font-mono text-xs">
          {formatQty(r.filasValidas)}
          {r.filasInvalidas > 0 && <span className="text-[var(--color-danger)]"> ({r.filasInvalidas} err.)</span>}
        </TableCell>
        <TableCell className="text-right font-mono">{formatQty(r.totalLitros, "L")}</TableCell>
        <TableCell className="text-right font-mono">{formatCLP(r.totalMonto)}</TableCell>
        <TableCell>
          <Badge variant={r.estado === "revertido" ? "danger" : "success"} size="sm">
            {r.estado === "revertido" ? "Revertido" : "Importado"}
          </Badge>
        </TableCell>
        <TableCell className="text-xs text-muted-foreground max-w-32 truncate" title={r.importerName}>{r.importerName}</TableCell>
        <TableCell>
          <Button asChild variant="ghost" size="sm">
            <Link href={`/combustibles/importar/operaciones/${r.id}`}>Ver</Link>
          </Button>
        </TableCell>
      </TableRow>
    )
  }

  const actions = (
    <Select value={estadoFilter} onValueChange={setEstadoFilter}>
      <SelectTrigger className="h-8 text-xs w-32">
        <SelectValue placeholder="Estado" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="todas">Todos</SelectItem>
        <SelectItem value="importado">Importado</SelectItem>
        <SelectItem value="revertido">Revertido</SelectItem>
      </SelectContent>
    </Select>
  )

  return (
    <>
  <DesktopOnlyTableNotice>El historial de importaciones tiene 10 columnas. La importación de planillas se hace desde un computador; aquí puedes desplazar en horizontal para consultarlo.</DesktopOnlyTableNotice>
      <DataTable
          enableColumnToggle
        stickyFirstColumn
        columns={COLUMNS}
        rows={preFiltered as unknown as Record<string, unknown>[]}
        searchKeys={SEARCH_KEYS}
        searchPlaceholder="Filtrar lotes..."
        renderRow={renderRow}
        emptyTitle="Sin lotes de log operacional"
        emptyDescription="Aún no se han importado lotes de log operacional."
        actions={actions}
      />
    </>
  )
}
