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
            </TableCell>
            <TableCell>{unitName(row.unit)}</TableCell>
            <TableCell className="font-mono text-[13px]">{row.intervals.map(formatNumber).join(" · ")}</TableCell>
            <TableCell className="text-right font-mono tabular-nums">{row.itemCount}</TableCell>
            <TableCell className="text-right font-mono tabular-nums">{row.equipmentCount}</TableCell>
            <TableCell>{row.hasBrandRules ? <Badge variant="info" size="sm">Sí</Badge> : <Badge variant="default" size="sm">No</Badge>}</TableCell>
          </TableRow>
        )
      }}
      renderMobileCard={(raw) => {
        const row = raw as Row
        return (
          <Link key={row.id} href={`/mantencion/pautas/${row.id}`} className="block rounded-[var(--radius-xl)] border border-[var(--color-border)] bg-[var(--color-surface)] p-3 hover:bg-[var(--color-surface-2)]">
            <p className="font-semibold text-[var(--color-primary-ink)]">{row.name}</p>
            <p className="mt-1 text-xs text-[var(--color-text-muted)]">
              {unitName(row.unit)} · {row.intervals.map(formatNumber).join(" · ")} · {plural(row.itemCount, "actividad", "actividades")} · {plural(row.equipmentCount, "equipo", "equipos")}
            </p>
          </Link>
        )
      }}
    />
  )
}
