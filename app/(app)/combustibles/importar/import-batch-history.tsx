"use client"

import { useState, useMemo } from "react"
import Link from "next/link"
import { DataTable, type ColumnDef } from "@/components/admin/data-table"
import { TableCell, TableRow } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ResponsiveDataListCard, ResponsiveDataListField } from "@/components/ui/responsive-data-list"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
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

type BatchRowFlat = {
  id: string
  worksiteName: string
  fuente: string
  periodoDesde: string
  periodoHasta: string
  archivoNombre: string
  filasValidas: number
  filasInvalidas: number
  totalCantidad: number
  totalMonto: number
  estado: string
  createdAt: string
  importerName: string
  periodoLabel: string
}

const COLUMNS: ColumnDef[] = [
  { key: "createdAt", label: "Fecha", sortable: true, width: "w-36" },
  { key: "worksiteName", label: "Faena", sortable: true },
  { key: "periodoLabel", label: "Período", sortable: true, width: "w-44" },
  { key: "fuente", label: "Fuente", sortable: true },
  { key: "archivoNombre", label: "Archivo", sortable: true },
  { key: "filasValidas", label: "Filas", sortable: true, numeric: true },
  { key: "totalCantidad", label: "Cantidad", sortable: true, numeric: true },
  { key: "totalMonto", label: "Monto", sortable: true, numeric: true },
  { key: "estado", label: "Estado", sortable: true },
  { key: "importerName", label: "Importado por", sortable: true },
  { key: "actions", label: "", width: "w-12" },
]

const SEARCH_KEYS: (keyof BatchRowFlat)[] = ["worksiteName", "fuente", "archivoNombre", "importerName", "periodoLabel"]

function flatRow(b: BatchRow): BatchRowFlat {
  return {
    id: b.id,
    worksiteName: b.worksite?.name ?? "—",
    fuente: b.fuente ?? "—",
    periodoDesde: b.periodoDesde,
    periodoHasta: b.periodoHasta,
    archivoNombre: b.archivoNombre,
    filasValidas: b.filasValidas,
    filasInvalidas: b.filasInvalidas,
    totalCantidad: Math.round(b.totalCantidad),
    totalMonto: b.totalMonto,
    estado: b.estado,
    createdAt: b.createdAt,
    importerName: b.importer?.name ?? b.importer?.email ?? "—",
    periodoLabel: `${b.periodoDesde} a ${b.periodoHasta}`,
  }
}

export function ImportBatchHistory({ batches }: { batches: BatchRow[] }) {
  const [estadoFilter, setEstadoFilter] = useState("todas")
  const [fuenteFilter, setFuenteFilter] = useState("todas")

  const flatRows = useMemo(() => batches.map(flatRow), [batches])

  const fuentes = useMemo(() => {
    const s = new Set(flatRows.map((r) => r.fuente))
    return ["todas", ...[...s].sort()]
  }, [flatRows])

  const preFiltered = useMemo(() => {
    let rows = flatRows
    if (estadoFilter !== "todas") rows = rows.filter((r) => r.estado === estadoFilter)
    if (fuenteFilter !== "todas") rows = rows.filter((r) => r.fuente === fuenteFilter)
    return rows
  }, [flatRows, estadoFilter, fuenteFilter])

  const renderRow = (r: BatchRowFlat, _index: number) => {
    return (
      <TableRow key={r.id}>
        <TableCell className="font-mono text-xs">{formatDateTime(r.createdAt)}</TableCell>
        <TableCell title={r.worksiteName}>{r.worksiteName}</TableCell>
        <TableCell className="font-mono text-xs">{r.periodoLabel}</TableCell>
        <TableCell>{r.fuente}</TableCell>
        <TableCell className="max-w-40 truncate" title={r.archivoNombre}>{r.archivoNombre}</TableCell>
        <TableCell className="text-right font-mono text-xs">
          {formatQty(r.filasValidas)}
          {r.filasInvalidas > 0 && <span className="text-[var(--color-danger)]"> ({r.filasInvalidas} err.)</span>}
        </TableCell>
        <TableCell className="text-right font-mono">{formatQty(r.totalCantidad, "L")}</TableCell>
        <TableCell className="text-right font-mono">{formatCLP(r.totalMonto)}</TableCell>
        <TableCell>
          <Badge variant={r.estado === "revertido" ? "danger" : "success"} size="sm">
            {r.estado === "revertido" ? "Revertido" : "Importado"}
          </Badge>
        </TableCell>
        <TableCell className="text-xs text-[var(--color-text-muted)] max-w-32 truncate" title={r.importerName}>{r.importerName}</TableCell>
        <TableCell>
          <Button asChild variant="ghost" size="sm">
            <Link href={`/combustibles/importar/${r.id}`}>Ver</Link>
          </Button>
        </TableCell>
      </TableRow>
    )
  }

  const actions = (
    <div className="flex items-center gap-2">
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
      <Select value={fuenteFilter} onValueChange={setFuenteFilter}>
        <SelectTrigger className="h-8 text-xs w-36">
          <SelectValue placeholder="Fuente" />
        </SelectTrigger>
        <SelectContent>
          {fuentes.map((f) => (
            <SelectItem key={f} value={f}>{f === "todas" ? "Todas" : f}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )

  return (
    <>
      <DataTable
          caption="Historial de Importaciones de Combustible"
          enableColumnToggle
          viewKey="imp"
        stickyFirstColumn
        columns={COLUMNS}
        rows={preFiltered}
        searchKeys={SEARCH_KEYS}
        searchPlaceholder="Filtrar lotes..."
        renderRow={renderRow}
        renderMobileCard={(r) => {
          return (
            <ResponsiveDataListCard
              title={r.archivoNombre}
              description={r.periodoLabel}
              status={<Badge variant={r.estado === "revertido" ? "danger" : "success"}>{r.estado === "revertido" ? "Revertido" : "Importado"}</Badge>}
              actions={<Button asChild type="button" variant="ghost" size="sm"><Link href={`/combustibles/importar/${r.id}`}>Ver lote</Link></Button>}
            >
              <ResponsiveDataListField label="Faena">{r.worksiteName}</ResponsiveDataListField>
              <ResponsiveDataListField label="Fuente">{r.fuente}</ResponsiveDataListField>
              <ResponsiveDataListField label="Filas">
                <span className="font-mono tabular-nums text-[var(--color-text)]">{formatQty(r.filasValidas)}{r.filasInvalidas > 0 ? ` válidas · ${r.filasInvalidas} con error` : " válidas"}</span>
              </ResponsiveDataListField>
              <ResponsiveDataListField label="Cantidad / monto">
                <span className="font-mono tabular-nums text-[var(--color-text)]">{formatQty(r.totalCantidad, "L")} · {formatCLP(r.totalMonto)}</span>
              </ResponsiveDataListField>
              <ResponsiveDataListField label="Importado por" className="col-span-2">{r.importerName} · {formatDateTime(r.createdAt)}</ResponsiveDataListField>
            </ResponsiveDataListCard>
          )
        }}
        emptyTitle="Sin lotes de importación"
        emptyDescription="Aún no se han importado lotes de consumo de combustible."
        actions={actions}
      />
    </>
  )
}
