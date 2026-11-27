"use client"

import * as React from "react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { Warning } from "@phosphor-icons/react"
import { DataTable, type ColumnDef } from "@/components/ui/data-table"
import { TableCell, TableCellNum, TableRow } from "@/components/ui/table"
import { plural } from "@/lib/mantencion/format"
import { equipmentAction, sheetHref } from "@/lib/services/mantencion/looker/filter-hrefs"
import { photosText } from "@/lib/services/mantencion/looker/preventive-summary"
import type { ComplianceByPlate } from "@/lib/services/mantencion/looker/types"
import { cn, formatDate } from "@/lib/utils"
import { ComplianceBar } from "./compliance-bar"
import { EquipmentCell } from "./equipment-cell"

const COLUMNS: ColumnDef[] = [
  { key: "equipment", label: "Equipo", sortable: true, sortValue: (row: ComplianceByPlate) => row.code || row.plate },
  { key: "levels", label: "Niveles de pauta" },
  { key: "percent", label: "Cumplimiento", sortable: true, width: "w-48", sortValue: (row: ComplianceByPlate) => row.percent ?? Number.POSITIVE_INFINITY },
  { key: "checks", label: "Pautas", numeric: true, sortable: true },
  { key: "notDone", label: "Sin hacer", numeric: true, sortable: true },
  { key: "last", label: "Última pauta", sortable: true, sortValue: (row: ComplianceByPlate) => row.lastDate ?? "" },
  { key: "photos", label: "Fotos completas", sortable: true, sortValue: (row: ComplianceByPlate) => row.withoutPhotos },
]

/** Lo que dicen «Sin hacer» y «Fotos completas»: el número o la palabra van siempre escritos, el tono los refuerza. */
function NotDoneText({ count }: { count: number }) {
  return <span className={cn("font-mono tabular-nums", count > 0 ? "font-semibold text-[var(--color-signal-ink)]" : "text-[var(--color-text-faint)]")}>{count}</span>
}

function PhotosText({ withoutPhotos }: { withoutPhotos: number }) {
  if (withoutPhotos === 0) return <span className="text-xs text-[var(--color-text-muted)]">{photosText(0)}</span>
  return (
    <span className="inline-flex items-center gap-1 text-xs font-semibold text-[var(--color-danger-ink)]">
      <Warning size={12} weight="fill" aria-hidden />
      {photosText(withoutPhotos)}
    </span>
  )
}

function LastCheck({ row }: { row: ComplianceByPlate }) {
  if (!row.lastDate) return <span className="text-xs text-[var(--color-text-muted)]">—</span>
  return (
    <>
      <span className="font-mono text-xs">{formatDate(row.lastDate)}</span>
      <span className="block truncate text-2xs text-[var(--color-text-muted)]">{row.lastMechanic ?? "Sin mecánico"}</span>
    </>
  )
}

/**
 * Cumplimiento por equipo. Un clic en la fila (o en la patente) abre la ficha del equipo con `router.push`, así
 * «atrás» la cierra; el embudo de la celda filtra el panel por el equipo (`x_equipo`). Son dos controles distintos:
 * un mismo elemento nunca navega y filtra a la vez. La consulta que alimenta la tabla ignora `x_equipo`, así que
 * siguen viéndose todos los equipos y sólo se resalta el elegido.
 */
export function ComplianceByEquipmentTable({
  rows,
  selectedId,
  openId,
}: {
  rows: ComplianceByPlate[]
  /** Equipo del filtro cruzado (se resalta). */
  selectedId: string | null
  /** Equipo cuya ficha está abierta. */
  openId: string | null
}) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const current = React.useMemo(() => new URLSearchParams(Array.from(searchParams.entries())), [searchParams])
  const hrefFor = React.useCallback((row: ComplianceByPlate) => (row.vehicleId ? sheetHref(pathname, current, row.vehicleId) : null), [current, pathname])
  const open = (href: string | null) => { if (href) router.push(href, { scroll: false }) }

  const cell = (row: ComplianceByPlate, href: string | null) => (
    <EquipmentCell
      plate={row.plate}
      code={row.code}
      sub={[row.plate ? row.code : null, row.worksiteName].filter(Boolean).join(" · ") || null}
      href={href}
      scroll={false}
      linkTitle={`Ver las pautas de ${row.plate || row.code}`}
      {...(row.vehicleId ? { filterAction: equipmentAction(row.vehicleId, selectedId === row.vehicleId) } : {})}
    />
  )

  return (
    <DataTable
      caption="Cumplimiento por equipo"
      columns={COLUMNS}
      rows={rows}
      searchKeys={["code", "plate", "worksiteName"]}
      disableInternalSearch
      hideDensityToggle
      framed={false}
      pageSize={25}
      emptyTitle="Sin pautas en el período"
      emptyDescription="Prueba con otro período o quita algún filtro."
      tableClassName="text-xs"
      renderRow={(row) => {
        const href = hrefFor(row)
        const active = !!row.vehicleId && (selectedId === row.vehicleId || openId === row.vehicleId)
        return (
          <TableRow
            key={row.vehicleId ?? `${row.code}-${row.plate}`}
            data-selected={active ? "true" : undefined}
            onClick={href ? () => open(href) : undefined}
            className={cn(href && "cursor-pointer hover:bg-[var(--color-surface-2)]", active && "bg-[var(--color-primary-tint)]/50")}
          >
            <TableCell nowrap>{cell(row, href)}</TableCell>
            <TableCell className="max-w-52 truncate text-xs" title={row.levels.join(" · ")}>{row.levels.join(" · ") || "—"}</TableCell>
            <TableCell><ComplianceBar value={row.percent} digits={0} /></TableCell>
            <TableCellNum>{row.checks}</TableCellNum>
            <TableCellNum><NotDoneText count={row.notDone} /></TableCellNum>
            <TableCell nowrap><LastCheck row={row} /></TableCell>
            <TableCell nowrap><PhotosText withoutPhotos={row.withoutPhotos} /></TableCell>
          </TableRow>
        )
      }}
      renderMobileCard={(row) => {
        const href = hrefFor(row)
        return (
          <div
            onClick={href ? () => open(href) : undefined}
            className={cn(
              "rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] p-3",
              href && "cursor-pointer",
              (selectedId === row.vehicleId || openId === row.vehicleId) && row.vehicleId && "border-[var(--color-primary)]",
            )}
          >
            <div className="flex items-start justify-between gap-2">
              {cell(row, href)}
              <span className="shrink-0 text-xs text-[var(--color-text-muted)]">
                <NotDoneText count={row.notDone} /> sin hacer
              </span>
            </div>
            <div className="mt-2"><ComplianceBar value={row.percent} digits={0} /></div>
            <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
              <div><dt className="text-[var(--color-text-muted)]">Pautas</dt><dd className="font-mono tabular-nums">{plural(row.checks, "pauta", "pautas")}</dd></div>
              <div><dt className="text-[var(--color-text-muted)]">Niveles</dt><dd className="truncate">{row.levels.join(" · ") || "—"}</dd></div>
              <div><dt className="text-[var(--color-text-muted)]">Última pauta</dt><dd><LastCheck row={row} /></dd></div>
              <div><dt className="text-[var(--color-text-muted)]">Fotos completas</dt><dd><PhotosText withoutPhotos={row.withoutPhotos} /></dd></div>
            </dl>
          </div>
        )
      }}
    />
  )
}
