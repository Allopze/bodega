"use client"

import * as React from "react"
import Link from "next/link"
import { CaretDown, CaretUp, CaretUpDown, Truck } from "@phosphor-icons/react"
import { useSafeShellHeader } from "@/components/layout/header-context"
import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/ui/empty-state"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRoot, TableRow } from "@/components/ui/table"
import { brandAndModel, formatReading, plural, remainingText } from "@/lib/mantencion/format"
import { matchesEquipmentSearch, type EquipmentListRow } from "@/lib/services/mantencion/equipment-list"
import { formatDate } from "@/lib/utils"
import { EquipmentStateBadge } from "../shared/equipment-state-badge"

/** Cuántos equipos se agregan cada vez que se pide «Mostrar … más» (§10). */
export const EQUIPMENT_PAGE = 50

type SortKey = "cod" | "faena" | "prox" | "estado"
type SortDir = "asc" | "desc"

const byCode = (a: EquipmentListRow, b: EquipmentListRow) => a.code.localeCompare(b.code, "es", { numeric: true })
const urgencyOf = (row: EquipmentListRow) => row.urgency ?? Number.POSITIVE_INFINITY

const COMPARE: Record<SortKey, (a: EquipmentListRow, b: EquipmentListRow) => number> = {
  cod: byCode,
  faena: (a, b) => a.worksiteName.localeCompare(b.worksiteName, "es") || byCode(a, b),
  prox: (a, b) => urgencyOf(a) - urgencyOf(b) || byCode(a, b),
  estado: (a, b) => a.stateOrder - b.stateOrder || urgencyOf(a) - urgencyOf(b) || byCode(a, b),
}

const COLUMNS: Array<{ key: SortKey | null; label: string }> = [
  { key: "cod", label: "Equipo" },
  { key: null, label: "Tipo y marca" },
  { key: "faena", label: "Faena" },
  { key: null, label: "Pauta" },
  { key: null, label: "Última lectura" },
  { key: "prox", label: "Próxima mantención" },
  { key: "estado", label: "Estado" },
]

function SortHeader({ column, sort, onSort }: { column: (typeof COLUMNS)[number]; sort: { key: SortKey; dir: SortDir } | null; onSort: (key: SortKey) => void }) {
  if (!column.key) return <TableHead>{column.label}</TableHead>
  const key = column.key
  const active = sort?.key === key
  const Icon = !active ? CaretUpDown : sort.dir === "asc" ? CaretUp : CaretDown
  return (
    <TableHead aria-sort={active ? (sort.dir === "asc" ? "ascending" : "descending") : undefined}>
      <button
        type="button"
        onClick={() => onSort(key)}
        className="inline-flex min-h-6 items-center gap-1 uppercase tracking-wider hover:text-[var(--color-text)]"
        aria-label={`Ordenar por ${column.label}${active ? ` (${sort.dir === "asc" ? "ascendente" : "descendente"})` : ""}`}
      >
        {column.label}
        <Icon size={12} aria-hidden weight={active ? "bold" : "regular"} className={active ? "text-[var(--color-primary)]" : "opacity-40"} />
      </button>
    </TableHead>
  )
}

function NextMaintenance({ row }: { row: EquipmentListRow }) {
  if (row.nextReading == null) return <span className="text-[var(--color-text-subtle)]">—</span>
  return (
    <>
      <span className="font-mono text-[13px] tabular-nums">{formatReading(row.nextReading, row.unit)}</span>
      <div className="text-xs text-[var(--color-text-muted)]">{remainingText({ remaining: row.remaining }, row.unit)}</div>
    </>
  )
}

/**
 * Tabla de «Equipos». La búsqueda de texto es la de la barra superior
 * (`useSafeShellHeader`): filtra la lista que el servidor ya recortó con los
 * filtros estructurados de la URL. El orden por defecto es el del servidor
 * (vencida → próxima → al día → …); cada encabezado ordenable lo reemplaza y un
 * tercer clic vuelve al orden por estado. «Mostrar 50 más» agranda la ventana
 * sobre la lista ya ordenada, no sobre una página.
 */
export function EquipmentTable({ rows, canManage, filtered }: { rows: EquipmentListRow[]; canManage: boolean; filtered: boolean }) {
  const { searchQuery } = useSafeShellHeader()
  const [sort, setSort] = React.useState<{ key: SortKey; dir: SortDir } | null>(null)
  const [limit, setLimit] = React.useState(EQUIPMENT_PAGE)

  const visible = React.useMemo(() => {
    const matching = rows.filter((row) => matchesEquipmentSearch(row, searchQuery))
    if (!sort) return matching
    const sorted = [...matching].sort(COMPARE[sort.key])
    return sort.dir === "asc" ? sorted : sorted.reverse()
  }, [rows, searchQuery, sort])

  const toggleSort = (key: SortKey) => setSort((current) => {
    if (current?.key !== key) return { key, dir: "asc" }
    return current.dir === "asc" ? { key, dir: "desc" } : null
  })

  if (rows.length === 0) {
    return (
      <EmptyState
        icon={<Truck size={24} aria-hidden />}
        title={filtered ? "Ningún equipo coincide con los filtros" : "Todavía no hay equipos en la mantención"}
        description={filtered
          ? "Prueba con otra faena, tipo, pauta o estado, o quita los filtros."
          : "Agrega los equipos uno a uno o impórtalos desde una planilla de Excel: aparecerán en la app del mecánico en su próxima sincronización."}
        action={filtered
          ? <Button asChild variant="secondary" size="sm"><Link href="/mantencion/equipos">Quitar los filtros</Link></Button>
          : canManage ? <Button asChild size="sm"><Link href="/mantencion/equipos/nuevo">Nuevo equipo</Link></Button> : undefined}
        secondaryAction={!filtered && canManage ? <Button asChild variant="secondary" size="sm"><Link href="/mantencion/equipos/importar">Importar desde Excel</Link></Button> : undefined}
      />
    )
  }

  const shown = visible.slice(0, limit)
  const remaining = visible.length - shown.length

  return (
    <div className="flex flex-col gap-3">
      {/* Móvil: una tarjeta por equipo. A 390 px la tabla dejaba el estado fuera de la pantalla. */}
      <ul className="flex flex-col gap-2 md:hidden" aria-label="Equipos de mantención">
        {shown.length === 0 && (
          <li className="py-6 text-center text-sm text-[var(--color-text-muted)]">Ningún equipo coincide con «{searchQuery.trim()}».</li>
        )}
        {shown.map((row) => (
          <li key={row.id}>
            <Link
              href={`/mantencion/equipos/${row.id}`}
              className="flex min-h-11 flex-col gap-1.5 rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3 transition-colors duration-(--duration-fast) hover:bg-[var(--color-surface-2)]"
            >
              <span className="flex items-baseline justify-between gap-3">
                <span className="whitespace-nowrap font-mono text-[13px] font-semibold text-[var(--color-primary-ink)]">
                  {row.code}
                  {row.showPlate && <span className="ml-2 font-normal text-[var(--color-text-muted)]">{row.plate}</span>}
                </span>
                <span className="truncate text-xs text-[var(--color-text-muted)]">{row.worksiteName}</span>
              </span>
              <span className="text-sm text-[var(--color-text)]">
                {[row.typeName, brandAndModel(row.brandName, row.model)].filter(Boolean).join(" · ")}
              </span>
              <span className="text-xs text-[var(--color-text-muted)]">
                {row.hasSchedule ? row.scheduleName : "Sin pauta"}
                {row.reading != null && <> · <span className="whitespace-nowrap font-mono tabular-nums">{formatReading(row.reading, row.unit)}</span></>}
              </span>
              <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <EquipmentStateBadge state={row.state} workshop={row.inWorkshop ? { days: row.workshopDays ?? null } : null} />
                {row.inWorkshop && row.workshopStale && <span className="text-xs font-semibold text-[var(--color-signal-ink)]">Sin actualizar</span>}
              </span>
            </Link>
          </li>
        ))}
      </ul>
      <TableRoot aria-label="Equipos de mantención" className="hidden md:block">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              {COLUMNS.map((column) => <SortHeader key={column.label} column={column} sort={sort} onSort={toggleSort} />)}
            </TableRow>
          </TableHeader>
          <TableBody>
            {shown.length === 0 && (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={COLUMNS.length} className="py-8 text-center text-[var(--color-text-muted)]">
                  Ningún equipo coincide con «{searchQuery.trim()}».
                </TableCell>
              </TableRow>
            )}
            {shown.map((row) => (
              <TableRow key={row.id} className={row.state === "baja" ? "bg-[var(--color-surface-2)]/60" : undefined}>
                <TableCell className="whitespace-nowrap">
                  {/* Objetivo táctil de 44 px en móvil; en escritorio la línea normal. */}
                  <Link
                    href={`/mantencion/equipos/${row.id}`}
                    className="inline-flex min-h-11 items-center font-mono text-[13px] font-semibold text-[var(--color-primary-ink)] underline-offset-2 hover:underline focus-visible:underline sm:min-h-0"
                  >
                    {row.code}
                  </Link>
                  {row.showPlate && <div className="font-mono text-xs text-[var(--color-text-muted)]">{row.plate}</div>}
                  {row.noPlate && <div className="text-xs text-[var(--color-text-subtle)]">Sin patente</div>}
                </TableCell>
                <TableCell>
                  <div>{row.typeName}</div>
                  <div className="text-xs text-[var(--color-text-muted)]">
                    {[brandAndModel(row.brandName, row.model), row.year].filter(Boolean).join(" · ")}
                  </div>
                </TableCell>
                <TableCell>{row.worksiteName}</TableCell>
                <TableCell>{row.hasSchedule ? row.scheduleName : <span className="text-[var(--color-text-subtle)]">Sin pauta</span>}</TableCell>
                <TableCell className="whitespace-nowrap">
                  {row.reading == null ? <span className="text-[var(--color-text-subtle)]">—</span> : (
                    <>
                      <span className="font-mono text-[13px] tabular-nums">{formatReading(row.reading, row.unit)}</span>
                      {row.readingDate && <div className="text-xs text-[var(--color-text-muted)]">{formatDate(row.readingDate)}</div>}
                    </>
                  )}
                </TableCell>
                <TableCell className="whitespace-nowrap"><NextMaintenance row={row} /></TableCell>
                <TableCell>
                  {/* Sin fecha de ingreso (`workshopDays` nulo) no hay cuántos días decir: la etiqueta dice sólo «En taller». */}
                  <EquipmentStateBadge state={row.state} workshop={row.inWorkshop ? { days: row.workshopDays ?? null } : null} />
                  {row.inWorkshop && row.workshopStale && (
                    <div className="mt-1 text-xs font-semibold text-[var(--color-signal-ink)]">Sin actualizar</div>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableRoot>
      <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-[var(--color-text-muted)]">
        <p aria-live="polite">Mostrando {shown.length.toLocaleString("es-CL")} de {plural(visible.length, "equipo", "equipos")}</p>
        {remaining > 0 && (
          <Button variant="secondary" size="sm" onClick={() => setLimit((current) => current + EQUIPMENT_PAGE)}>
            Mostrar {Math.min(EQUIPMENT_PAGE, remaining)} más
          </Button>
        )}
      </div>
    </div>
  )
}
