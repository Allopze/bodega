"use client"

import * as React from "react"
import Link from "next/link"
import { MetaBadge, type StateMetaInput } from "@/components/states/state-badge"
import { Button } from "@/components/ui/button"
import { DataTable, type ColumnDef } from "@/components/ui/data-table"
import { FilterSearchInput } from "@/components/ui/filter-search-input"
import { FilterToolbar, type ActiveFilterChip } from "@/components/ui/filter-toolbar"
import { OptionSelect } from "@/components/ui/option-select"
import { Progress } from "@/components/ui/progress"
import { ResponsiveDataListCard, ResponsiveDataListField } from "@/components/ui/responsive-data-list"
import { TableCell, TableRow } from "@/components/ui/table"
import { Tooltip } from "@/components/ui/tooltip"
import { useUrlFilters } from "@/lib/hooks/use-url-filters"
import { capaStatusBadgeVariant, capaStatusLabel } from "@/lib/prevention/capa"
import {
  FOLLOWUP_KINDS,
  FOLLOWUP_STATUSES,
  FOLLOWUP_STATUS_LABELS,
  followupDaysOverdue,
  followupFilterIsActive,
  type InspectionFollowupFilter,
} from "@/lib/prevention/inspection-followup-query"
import { INSPECTION_KIND_LABELS } from "@/lib/prevention/inspections"
import type { InspectionFollowupRow } from "@/lib/services/prevention-inspection-followup"
import { cn, formatDate } from "@/lib/utils"

/** `DataTable` identifica cada fila por `id`; el servicio la entrega con `findingId`. */
type FollowupTableRow = InspectionFollowupRow & { id: string }

/**
 * Lo que «Plazo» significa en el Anexo 15. La pantalla habla en español llano y no está atada al formato
 * oficial; el Excel sí, y quien compara los dos necesita saber que son el mismo dato.
 */
const DUE_DATE_HINT = "Fecha comprometida para ejecutar la medida correctiva («Fecha Ejecución MC» del Anexo 15)"

/**
 * Prioridad de columnas sin tocar `DataTable`: «Avance» sólo desde `xl`, y bajo `xl` el avance va como
 * sublínea de «Acción correctiva». Así «Acción», «Plazo» y «Estado» quedan a la vista en 1024 px, donde
 * el pozo mide 776 (712 de contenido). `width` es la única clase que `DataTable` reenvía al `<th>`, así
 * que también lleva el `px-3` que iguala el relleno de encabezado y celdas, y los anchos mínimos que
 * impiden que las dos columnas de texto (hallazgo y acción) se aplasten contra las angostas.
 */
const COLUMNS: ColumnDef[] = [
  { key: "deviation", label: "Hallazgo", width: "px-3 min-w-36" },
  { key: "place", label: "Faena / sujeto", width: "px-3 w-32 xl:w-40" },
  { key: "action", label: "Acción correctiva", width: "px-3 min-w-36" },
  {
    key: "targetDate",
    label: "Plazo",
    sortable: true,
    // Sin plazo (hallazgo sin acción) al final del orden ascendente.
    sortValue: (row: FollowupTableRow) => row.targetDate ?? "9999-12-31",
    width: "px-3 w-28",
  },
  { key: "status", label: "Estado", width: "px-3 w-32" },
  { key: "progress", label: "Avance", width: "px-3 hidden xl:table-cell w-32" },
]

const CELL = "px-3 align-top"

/** El estado del hallazgo, una sola vez: el de su acción CAPA, o la falta de ella. */
function statusMeta(row: InspectionFollowupRow): StateMetaInput {
  if (row.actionId && row.capaStatus) return { label: capaStatusLabel(row.capaStatus), variant: capaStatusBadgeVariant(row.capaStatus) }
  if (row.findingStatus === "closed") return { label: "Cerrado sin CAPA", variant: "outline" }
  return { label: "Sin acción CAPA", variant: "warning" }
}

function overdueLabel(row: InspectionFollowupRow, today: string): string | null {
  if (row.followupStatus !== "vencidas") return null
  const days = followupDaysOverdue(row.targetDate, today)
  return days > 0 ? `Vencida hace ${days === 1 ? "1 día" : `${days} días`}` : "Vencida"
}

/** Un guion no dice nada a quien lee con lector de pantalla: se le narra la ausencia. */
function Absent({ children }: { children: string }) {
  return (
    <>
      <span aria-hidden className="text-[var(--color-text-subtle)]">—</span>
      <span className="sr-only">{children}</span>
    </>
  )
}

function DueDate({ row, today }: { row: InspectionFollowupRow; today: string }) {
  if (!row.targetDate) return <Absent>Sin plazo</Absent>
  const overdue = overdueLabel(row, today)
  return (
    <>
      <Tooltip side="top" content={DUE_DATE_HINT}>
        <span className="cursor-help font-mono text-xs tabular-nums text-[var(--color-text)] underline decoration-dotted decoration-[var(--color-border-strong)] underline-offset-4">
          {formatDate(row.targetDate)}
        </span>
      </Tooltip>
      {/* `text-balance`: en la columna angosta «Vencida hace 20 / días» dejaba «días» huérfano. */}
      {overdue && <p className="mt-1 text-balance text-xs font-medium text-[var(--color-danger-ink)]">{overdue}</p>}
    </>
  )
}

function CapaCode({ row, canViewCapa }: { row: InspectionFollowupRow; canViewCapa: boolean }) {
  if (!row.actionId || !row.actionCode) return null
  // El código se muestra siempre; sólo se enlaza a quien puede abrir la acción.
  return canViewCapa
    ? <Link href={`/prevencion/capa/${row.actionId}`} className="whitespace-nowrap font-mono text-xs text-[var(--color-primary)] underline-offset-2 hover:underline">{row.actionCode}</Link>
    : <span className="whitespace-nowrap font-mono text-xs text-[var(--color-text-muted)]">{row.actionCode}</span>
}

function LastFollowup({ row }: { row: InspectionFollowupRow }) {
  if (!row.lastFollowup) return null
  return (
    <p className="mt-1 line-clamp-2 text-xs text-[var(--color-text-subtle)]">
      <span className="font-medium text-[var(--color-text-muted)]">Último seguimiento</span> · {formatDate(row.lastFollowup.at)}: {row.lastFollowup.note}
    </p>
  )
}

function ProgressBar({ row }: { row: InspectionFollowupRow }) {
  return (
    <div className="flex items-center gap-2">
      <span className="font-mono text-xs tabular-nums text-[var(--color-text)]">{row.progress} %</span>
      <Progress
        value={row.progress}
        size="sm"
        tone={row.followupStatus === "vencidas" ? "danger" : "primary"}
        label={`Avance de la acción ${row.actionCode ?? ""}: ${row.progress} %`}
        className="w-14"
      />
    </div>
  )
}

function FollowupFilters({ worksites, filter, setFilter, clearFilters }: {
  worksites: Array<{ id: string; name: string }>
  filter: InspectionFollowupFilter
  /** Del `useUrlFilters` de la tabla: así `isPending` ve los cambios que hacen estos controles. */
  setFilter: ReturnType<typeof useUrlFilters>["setFilter"]
  clearFilters: ReturnType<typeof useUrlFilters>["clearFilters"]
}) {

  // Quitar un filtro es borrar su parámetro; el buscador se resincroniza solo con la URL.
  const chips: ActiveFilterChip[] = []
  if (filter.search) chips.push({ key: "q", label: "Búsqueda", value: filter.search, displayValue: filter.search })
  if (filter.status) chips.push({ key: "estado", label: "Estado", value: filter.status, displayValue: FOLLOWUP_STATUS_LABELS[filter.status] })
  if (filter.kind) chips.push({ key: "tipo", label: "Tipo", value: filter.kind, displayValue: INSPECTION_KIND_LABELS[filter.kind] ?? filter.kind })
  if (filter.worksiteId) {
    const worksite = worksites.find((item) => item.id === filter.worksiteId)
    chips.push({ key: "faena", label: "Faena", value: filter.worksiteId, displayValue: worksite?.name ?? "Faena no disponible" })
  }

  return (
    <FilterToolbar
      activeChips={chips}
      onRemoveChip={(key) => setFilter(key, null)}
      onClearAll={() => clearFilters()}
      hasActiveFilters={chips.length > 0}
    >
      {/* Esta ruta no tiene el buscador de la shell (`/prevencion/inspecciones` está en
          `ROUTES_WITH_OWN_SEARCH`), y el filtrado es del servidor: la tabla no filtra en memoria. */}
      <FilterSearchInput
        param="q"
        pageKeys={[]}
        placeholder="Hallazgo, acción, código o sujeto"
        ariaLabel="Buscar en el seguimiento"
        className="h-11 w-full pl-8 text-xs sm:h-8 sm:w-56"
      />
      <OptionSelect
        aria-label="Faena"
        className="h-11 min-w-36 text-xs sm:h-8"
        emptyLabel="Todas las faenas"
        options={worksites.map((worksite) => ({ value: worksite.id, label: worksite.name }))}
        value={filter.worksiteId ?? ""}
        onValueChange={(value) => setFilter("faena", value || null)}
      />
      <OptionSelect
        aria-label="Estado"
        className="h-11 min-w-36 text-xs sm:h-8"
        emptyLabel="Todos los estados"
        options={FOLLOWUP_STATUSES.map((value) => ({ value, label: FOLLOWUP_STATUS_LABELS[value] }))}
        value={filter.status ?? ""}
        onValueChange={(value) => setFilter("estado", value || null)}
      />
      <OptionSelect
        aria-label="Tipo de instrumento"
        className="h-11 min-w-36 text-xs sm:h-8"
        emptyLabel="Todos los tipos"
        options={FOLLOWUP_KINDS.map((value) => ({ value, label: INSPECTION_KIND_LABELS[value] ?? value }))}
        value={filter.kind ?? ""}
        onValueChange={(value) => setFilter("tipo", value || null)}
      />
    </FilterToolbar>
  )
}

export function FollowupTable({ rows, worksites, filter, today, canViewCapa }: {
  rows: InspectionFollowupRow[]
  /** Faenas del alcance de quien mira, no las de las filas: con un filtro puesto las filas sólo traen una. */
  worksites: Array<{ id: string; name: string }>
  filter: InspectionFollowupFilter
  /** Día de Chile contra el que el servidor decidió qué está vencido. */
  today: string
  /** Con `prevention:capa:view` el código de la acción enlaza a su ficha. */
  canViewCapa: boolean
}) {
  const tableRows = React.useMemo<FollowupTableRow[]>(() => rows.map((row) => ({ ...row, id: row.findingId })), [rows])
  const { setFilter, clearFilters, isPending } = useUrlFilters()
  const isFiltered = followupFilterIsActive(filter)

  return (
    <>
      <FollowupFilters worksites={worksites} filter={filter} setFilter={setFilter} clearFilters={clearFilters} />
      {/* `aria-busy` mientras la URL nueva se resuelve en el servidor: la tabla vieja sigue en
          pantalla y, sin esto, nada dice que ya se pidió otra (R-07). */}
      <div aria-busy={isPending || undefined} className={cn(isPending && "opacity-60")}>
      <DataTable
        caption={`Hallazgos de las inspecciones con su acción correctiva, primero los que piden acción. Plazo: ${DUE_DATE_HINT}.`}
        columns={COLUMNS}
        rows={tableRows}
        searchKeys={["deviation"]}
        disableInternalSearch
        // La densidad no cambia nada útil aquí y su fila partía en dos la cabecera de la tabla.
        hideDensityToggle
        pageSize={50}
        emptyTitle={isFiltered ? "No hay hallazgos con estos filtros" : "Aún no hay hallazgos para seguir"}
        emptyDescription={isFiltered ? "Ajusta o quita algún filtro para ver el resto." : undefined}
        emptyAction={isFiltered ? <Button type="button" variant="secondary" onClick={() => clearFilters()}>Limpiar filtros</Button> : undefined}
        renderMobileCard={(row) => {
          const overdue = overdueLabel(row, today)
          return (
            <ResponsiveDataListCard
              // El texto del hallazgo se lee completo: el título de la tarjeta recorta a una línea, y la
              // envoltura en bloque con espacios normales deja que baje de renglón.
              title={<span className="block whitespace-normal">{row.deviation}</span>}
              description={
                <>
                  <span className="font-mono">{row.date ? formatDate(row.date) : "—"}</span> · <span className="font-mono">{row.runCode}</span>
                </>
              }
              status={<MetaBadge meta={statusMeta(row)} />}
              actions={
                <>
                  <Button asChild variant="secondary" size="sm">
                    {/* Hay una por hallazgo: el nombre dice de cuál inspección y cuál hallazgo (R-03). */}
                    <Link href={`/prevencion/inspecciones/${row.runId}`} aria-label={`Ver inspección ${row.runCode}: ${row.deviation}`}>Ver inspección</Link>
                  </Button>
                  {canViewCapa && row.actionId && (
                    <Button asChild variant="secondary" size="sm"><Link href={`/prevencion/capa/${row.actionId}`}>Ver acción {row.actionCode}</Link></Button>
                  )}
                </>
              }
            >
              <ResponsiveDataListField label="Faena / sujeto" className="col-span-2">
                {row.worksiteName}{row.subjectLabel ? ` · ${row.subjectLabel}` : ""}
              </ResponsiveDataListField>
              {row.actionId ? (
                <>
                  <ResponsiveDataListField label="Acción correctiva" className="col-span-2">
                    {row.correctiveMeasure}
                    <span className="mt-0.5 block text-[var(--color-text-subtle)]">Responsable: {row.responsible || "sin asignar"}</span>
                  </ResponsiveDataListField>
                  <ResponsiveDataListField label="Plazo">
                    <span className="font-mono tabular-nums">{row.targetDate ? formatDate(row.targetDate) : "—"}</span>
                    {overdue && <span className="mt-0.5 block font-medium text-[var(--color-danger-ink)]">{overdue}</span>}
                  </ResponsiveDataListField>
                  <ResponsiveDataListField label="Avance"><ProgressBar row={row} /></ResponsiveDataListField>
                  {row.lastFollowup && (
                    <ResponsiveDataListField label="Último seguimiento" className="col-span-2">
                      {formatDate(row.lastFollowup.at)}: {row.lastFollowup.note}
                    </ResponsiveDataListField>
                  )}
                </>
              ) : null}
            </ResponsiveDataListCard>
          )
        }}
        renderRow={(row) => (
          <TableRow key={row.id}>
            <TableCell className={CELL}>
              {/* Tres renglones como máximo: el texto completo está en la inspección (y en `title`). */}
              <Link
                href={`/prevencion/inspecciones/${row.runId}`}
                title={row.deviation}
                className="line-clamp-3 font-medium text-[var(--color-primary)] underline-offset-2 hover:underline"
              >
                {row.deviation}
              </Link>
              <p className="mt-1 text-xs text-[var(--color-text-subtle)]">
                <span className="font-mono">{row.date ? formatDate(row.date) : "—"}</span> · <span className="font-mono">{row.runCode}</span>
              </p>
            </TableCell>
            <TableCell className={CELL}>
              <p className="font-medium text-[var(--color-text)]">{row.worksiteName}</p>
              {row.subjectLabel && <p className="mt-0.5 text-xs text-[var(--color-text-muted)]">{row.subjectLabel}</p>}
            </TableCell>
            <TableCell className={CELL}>
              {row.actionId ? (
                <>
                  <p className="line-clamp-3 text-[var(--color-text)]" title={row.correctiveMeasure}>{row.correctiveMeasure}</p>
                  {/* Código y responsable envuelven como unidades: partido por el guion el código no se lee. */}
                  <p className="mt-1 flex flex-wrap gap-x-2 text-xs text-[var(--color-text-muted)]">
                    <CapaCode row={row} canViewCapa={canViewCapa} />
                    <span>Responsable: {row.responsible || "sin asignar"}</span>
                  </p>
                  <LastFollowup row={row} />
                  {/* Bajo `xl` la columna «Avance» no cabe: su dato baja aquí para no perderse. */}
                  <p className="mt-1 text-xs text-[var(--color-text-muted)] xl:hidden">Avance: <span className="font-mono tabular-nums">{row.progress} %</span></p>
                </>
              ) : <Absent>Sin acción correctiva</Absent>}
            </TableCell>
            <TableCell className={CELL}><DueDate row={row} today={today} /></TableCell>
            <TableCell className={CELL}><MetaBadge meta={statusMeta(row)} /></TableCell>
            <TableCell className={`${CELL} hidden xl:table-cell`}>
              {row.actionId ? <ProgressBar row={row} /> : <Absent>Sin avance</Absent>}
            </TableCell>
          </TableRow>
        )}
      />
      </div>
    </>
  )
}
