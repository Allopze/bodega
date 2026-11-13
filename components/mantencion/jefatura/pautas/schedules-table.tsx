"use client"

import Link from "next/link"
import { Badge } from "@/components/ui/badge"
import { DataTable } from "@/components/ui/data-table"
import { TableCell, TableRow } from "@/components/ui/table"
import { formatNumber, plural, unitName } from "@/lib/mantencion/format"
import type { ScheduleListRow } from "@/lib/services/mantencion/schedules"

type Row = ScheduleListRow & Record<string, unknown>

const COLUMNS = [
  { key: "name", label: "Pauta", sortable: true },
  { key: "unit", label: "Unidad", sortable: true },
  { key: "intervals", label: "Intervalos", sortValue: (row: Row) => row.intervals[0] ?? 0, sortable: true },
  { key: "itemCount", label: "Actividades", sortable: true, numeric: true },
  { key: "equipmentCount", label: "Equipos", sortable: true, numeric: true },
  { key: "hasBrandRules", label: "Reglas por marca", sortable: true, sortValue: (row: Row) => (row.hasBrandRules ? 1 : 0) },
]

/** Una pauta sin actividades no sirve para registrar una preventiva: se marca en la lista (auditoría 2026-11-13, M15). */
function EmptyScheduleBadge({ row }: { row: Row }) {
  return row.itemCount === 0 ? <Badge variant="warning" size="sm" className="ml-2 align-middle">Sin actividades</Badge> : null
}

/** Lista de pautas: la búsqueda es la de la barra superior (hay pocas pautas). Cada nombre abre su editor. */
export function SchedulesTable({ rows }: { rows: ScheduleListRow[] }) {
  return (
    <DataTable
      caption="Pautas de mantención"
      columns={COLUMNS}
      rows={rows as Row[]}
      searchKeys={["name"]}
      hideDensityToggle
      emptyTitle="Todavía no hay pautas"
      emptyDescription="Crea la primera con «Nueva pauta»: define cómo se mide y cada cuánto se hace, y después asígnala a los equipos."
      renderRow={(raw) => {
        const row = raw as Row
        return (
          <TableRow key={row.id}>
            <TableCell>
              <Link href={`/mantencion/pautas/${row.id}`} className="font-semibold text-[var(--color-primary-ink)] underline-offset-2 hover:underline focus-visible:underline">{row.name}</Link>
              {row.dirty && <Badge variant="warning" size="sm" className="ml-2 align-middle">Cambios sin publicar</Badge>}
              <EmptyScheduleBadge row={row} />
            </TableCell>
            <TableCell>{unitName(row.unit)}</TableCell>
            <TableCell className="font-mono text-sm">{row.intervals.map(formatNumber).join(" · ")}</TableCell>
            <TableCell className="text-right font-mono tabular-nums">{row.itemCount}</TableCell>
            <TableCell className="text-right font-mono tabular-nums">{row.equipmentCount}</TableCell>
            {/* Texto, no una insignia «No» por fila: lo habitual es no tener reglas y repetirlo era ruido. */}
            <TableCell>{row.hasBrandRules ? "Con reglas" : <><span aria-hidden className="text-[var(--color-text-subtle)]">—</span><span className="sr-only">Sin reglas por marca</span></>}</TableCell>
          </TableRow>
        )
      }}
      renderMobileCard={(raw) => {
        const row = raw as Row
        return (
          <Link key={row.id} href={`/mantencion/pautas/${row.id}`} className="block rounded-[var(--radius-xl)] border border-[var(--color-border)] bg-[var(--color-surface)] p-3 hover:bg-[var(--color-surface-2)]">
            <p className="font-semibold text-[var(--color-primary-ink)]">
              {row.name}
              {row.dirty && <Badge variant="warning" size="sm" className="ml-2 align-middle">Cambios sin publicar</Badge>}
              <EmptyScheduleBadge row={row} />
            </p>
            <p className="mt-1 text-xs text-[var(--color-text-muted)]">
              {unitName(row.unit)} · {row.intervals.map(formatNumber).join(" · ")} · {plural(row.itemCount, "actividad", "actividades")} · {plural(row.equipmentCount, "equipo", "equipos")}{row.hasBrandRules ? " · con reglas por marca" : ""}
            </p>
          </Link>
        )
      }}
    />
  )
}
