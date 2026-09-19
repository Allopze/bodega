"use client"

import * as React from "react"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { MetaBadge } from "@/components/states/state-badge"
import { EmptyState } from "@/components/ui/empty-state"
import { FilterToolbar, type ActiveFilterChip } from "@/components/ui/filter-toolbar"
import { Tooltip } from "@/components/ui/tooltip"
import { useSafeShellHeader } from "@/components/layout/header-context"
import { useUrlFilters } from "@/lib/hooks/use-url-filters"
import { cn } from "@/lib/utils"
import { ResolveAction, type ReadinessResolution } from "./resolve-action"
import { readinessGroupCopy } from "./readiness-copy"
import type { PdtpFulfillmentCoverageIssue } from "@/lib/services/prevention-pdtp"

/**
 * Lo que le falta a cada actividad, como cola de trabajo.
 *
 * Es el reemplazo de `CoverageReportPanel`, que mostraba lo mismo como informe:
 * veinte actividades apiladas a ancho completo, la misma frase repetida en las
 * catorce filas de un grupo, y ninguna acción. En prueba de usabilidad el
 * prevencionista no pudo resolver ninguna.
 *
 * Tres decisiones que vienen de ahí:
 *
 * 1. **La explicación de clase se dice una vez**, en el encabezado del grupo.
 *    Lo que va en la fila es el hecho concreto: qué instrumento, en qué estado.
 * 2. **Cada fila tiene una acción posible**, aunque el usuario no pueda
 *    resolverla él mismo — en ese caso la acción es pedírselo a quien puede.
 * 3. **Tabla cruda y no `DataTable`**: hacen falta filas de encabezado de grupo
 *    dentro del `<tbody>` y una columna de acción con tres formas distintas.
 *    Caben en `renderRow`, pero la toolbar de `DataTable` (densidad, columnas,
 *    paginador) aparece igual y compite con los chips y el `FilterToolbar`.
 *
 * El filtro de texto viene del buscador del TopBar (`useSafeShellHeader`): la
 * ruta no está en `ROUTES_WITH_OWN_SEARCH`, así que el buscador global está
 * vivo acá y no hace falta un `<input>` propio.
 */

export type ReadinessRow = {
  activityId: string
  n: number
  activity: string
  status: PdtpFulfillmentCoverageIssue["status"]
  blocks: boolean
  /** El motivo de **esta** fila, no el de su grupo. */
  reason: string
  instrumentKind: string | null
  instrumentCode: string | null
  instrumentState: string | null
  /** `null` cuando la actividad no se resuelve por faena. */
  worksiteNames: string[] | null
  resolution: ReadinessResolution
}

type QuickView = "all" | "blocking" | "pending" | "segregated"

const QUICK_VIEWS: Array<{ value: QuickView; label: string }> = [
  { value: "all", label: "Todas" },
  { value: "blocking", label: "Frenan la firma" },
  { value: "pending", label: "No acreditan" },
  { value: "segregated", label: "Las acredita un tercero" },
]

function viewOf(row: ReadinessRow): Exclude<QuickView, "all"> {
  if (row.blocks) return "blocking"
  if (row.status === "segregated_valid") return "segregated"
  return "pending"
}

const SORTS = {
  gravedad: "Gravedad y número",
  numero: "Número",
  actividad: "Actividad A-Z",
  faenas: "Más faenas afectadas",
} as const
type SortKey = keyof typeof SORTS

export function ActivityReadinessWorkbench({
  rows,
  total,
  ready,
}: {
  rows: ReadinessRow[]
  total: number
  ready: number
}) {
  const { getFilter, setFilter, clearFilters } = useUrlFilters()
  const { searchQuery } = useSafeShellHeader()

  const view = (getFilter("vista") || "all") as QuickView
  const worksite = getFilter("faena")
  const kind = getFilter("tipo")
  const sort = (getFilter("orden") || "gravedad") as SortKey

  const worksiteOptions = React.useMemo(
    () => [...new Set(rows.flatMap((row) => row.worksiteNames ?? []))].sort((a, b) => a.localeCompare(b, "es-CL")),
    [rows],
  )
  const kindOptions = React.useMemo(
    () => [...new Set(rows.map((row) => row.instrumentKind).filter((value): value is string => Boolean(value)))].sort(),
    [rows],
  )

  const visible = React.useMemo(() => {
    const needle = searchQuery.trim().toLocaleLowerCase("es-CL")
    const filtered = rows.filter((row) => {
      if (view !== "all" && viewOf(row) !== view) return false
      if (worksite && !(row.worksiteNames ?? []).includes(worksite)) return false
      if (kind && row.instrumentKind !== kind) return false
      if (needle) {
        const haystack = `N°${row.n} ${row.activity} ${row.reason} ${row.instrumentCode ?? ""}`.toLocaleLowerCase("es-CL")
        if (!haystack.includes(needle)) return false
      }
      return true
    })
    return [...filtered].sort((a, b) => {
      if (sort === "numero") return a.n - b.n
      if (sort === "actividad") return a.activity.localeCompare(b.activity, "es-CL") || a.n - b.n
      if (sort === "faenas") return (b.worksiteNames?.length ?? 0) - (a.worksiteNames?.length ?? 0) || a.n - b.n
      return Number(b.blocks) - Number(a.blocks) || a.n - b.n
    })
  }, [rows, view, worksite, kind, sort, searchQuery])

  /* Los conteos de los chips ignoran el chip activo —si no, el chip elegido
   * siempre mostraría el total y los demás cero— pero sí respetan los filtros
   * finos, que es lo que el usuario espera al acotar por faena. */
  const counts = React.useMemo(() => {
    const base = rows.filter((row) => {
      if (worksite && !(row.worksiteNames ?? []).includes(worksite)) return false
      if (kind && row.instrumentKind !== kind) return false
      return true
    })
    return {
      all: base.length,
      blocking: base.filter((row) => viewOf(row) === "blocking").length,
      pending: base.filter((row) => viewOf(row) === "pending").length,
      segregated: base.filter((row) => viewOf(row) === "segregated").length,
    } satisfies Record<QuickView, number>
  }, [rows, worksite, kind])

  // Agrupación dentro del `<tbody>`: el orden de las filas ya viene decidido,
  // y el grupo se abre cuando cambia el status respecto de la fila anterior.
  const grouped = React.useMemo(() => {
    const byStatus = new Map<ReadinessRow["status"], ReadinessRow[]>()
    for (const row of visible) {
      const list = byStatus.get(row.status) ?? []
      list.push(row)
      byStatus.set(row.status, list)
    }
    return [...byStatus.entries()]
  }, [visible])

  const activeChips: ActiveFilterChip[] = [
    ...(worksite ? [{ key: "faena", label: "Faena", value: worksite, displayValue: worksite }] : []),
    ...(kind ? [{ key: "tipo", label: "Tipo", value: kind, displayValue: kind }] : []),
  ]
  const hasFilters = activeChips.length > 0 || view !== "all" || Boolean(searchQuery.trim())

  return (
    <div>
      <p className="mb-3 text-sm text-[var(--color-text-muted)]">
        <span className="tabular-nums">{ready}</span> de <span className="tabular-nums">{total}</span> actividades
        del programa están listas. Estas son las que todavía no.
      </p>

      <div className="mb-3 flex flex-wrap gap-1" aria-label="Vistas rápidas">
        {QUICK_VIEWS.map(({ value, label }) => {
          const count = counts[value]
          // Un chip en 0 sigue siendo un destino legítimo: pulsarlo es cómo el
          // usuario confirma "no hay nada que frene la firma".
          const empty = count === 0 && view !== value
          return (
            <button
              key={value}
              type="button"
              aria-pressed={view === value}
              title={empty ? "Sin actividades en esta vista con los filtros actuales" : undefined}
              onClick={() => setFilter("vista", value === "all" ? null : value)}
              className={cn(
                "flex h-9 shrink-0 items-center gap-1.5 rounded-[var(--radius)] border px-3 text-xs font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-primary)]",
                view === value
                  ? "border-[var(--color-primary)] bg-[var(--color-primary-tint)] text-[var(--color-primary-ink)]"
                  : "border-[var(--color-border)] text-[var(--color-text-muted)] hover:bg-[var(--color-surface-2)]",
                /* Borde discontinuo y no `opacity-60`: atenuar con opacidad
                 * baja el texto a 2.95:1 sobre blanco y reprueba WCAG AA
                 * (axe lo marca `serious`). El chip tiene que seguir siendo
                 * legible: su conteo en 0 ya es la señal, y el `title` la
                 * explica. */
                empty && "border-dashed",
              )}
            >
              {label}
              <span className={cn(
                "rounded-full px-1.5 text-[11px] tabular-nums",
                view === value ? "bg-[var(--color-primary)] text-white" : "bg-[var(--color-surface-2)] text-[var(--color-text-subtle)]",
              )}>{count}</span>
            </button>
          )
        })}
      </div>

      <FilterToolbar
        activeChips={activeChips}
        hasActiveFilters={hasFilters}
        onRemoveChip={(key) => setFilter(key, null)}
        onClearAll={() => clearFilters()}
      >
        {worksiteOptions.length > 0 && (
          <Select value={worksite || "_all"} onValueChange={(value) => setFilter("faena", value)}>
            <SelectTrigger aria-label="Filtrar por faena"><SelectValue placeholder="Faena" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="_all">Todas las faenas</SelectItem>
              {worksiteOptions.map((name) => <SelectItem key={name} value={name}>{name}</SelectItem>)}
            </SelectContent>
          </Select>
        )}
        {kindOptions.length > 0 && (
          <Select value={kind || "_all"} onValueChange={(value) => setFilter("tipo", value)}>
            <SelectTrigger aria-label="Filtrar por tipo de instrumento"><SelectValue placeholder="Tipo" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="_all">Todos los tipos</SelectItem>
              {kindOptions.map((name) => <SelectItem key={name} value={name}>{name}</SelectItem>)}
            </SelectContent>
          </Select>
        )}
        <Select value={sort} onValueChange={(value) => setFilter("orden", value === "gravedad" ? null : value)}>
          <SelectTrigger aria-label="Ordenar"><SelectValue /></SelectTrigger>
          <SelectContent>
            {Object.entries(SORTS).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}
          </SelectContent>
        </Select>
      </FilterToolbar>

      {/* Sin esto, quien navega con lector de pantalla pulsa un chip y no
          recibe ninguna señal de que la lista cambió. */}
      <p role="status" aria-live="polite" className="sr-only">
        Mostrando {visible.length} de {rows.length} actividades.
      </p>

      {visible.length === 0 ? (
        <EmptyState
          compact
          title={rows.length === 0 ? "Todo listo" : "No hay actividades con estos filtros"}
          description={rows.length === 0
            ? "Todas las actividades del programa tienen dónde ejecutarse y quién las acredita."
            : "Prueba con otra vista o quita los filtros."}
          tone={rows.length === 0 ? "success" : "neutral"}
          action={rows.length > 0 && hasFilters
            ? <button type="button" className="text-sm underline" onClick={() => clearFilters()}>Limpiar filtros</button>
            : undefined}
        />
      ) : (
        <>
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full min-w-[900px] border-collapse text-sm">
              <caption className="sr-only">
                Actividades del programa con algo pendiente, ordenadas por {SORTS[sort].toLocaleLowerCase("es-CL")}.
              </caption>
              <thead>
                <tr className="border-b border-[var(--color-border)] text-left">
                  <th scope="col" className="th-type w-16 px-3 py-2 text-right">N°</th>
                  <th scope="col" className="th-type px-3 py-2">Actividad</th>
                  <th scope="col" className="th-type px-3 py-2">Qué falta</th>
                  <th scope="col" className="th-type px-3 py-2">Estado</th>
                  <th scope="col" className="th-type px-3 py-2">Faenas</th>
                  <th scope="col" className="th-type px-3 py-2 text-right"><span className="sr-only">Acciones</span></th>
                </tr>
              </thead>
              <tbody>
                {grouped.map(([status, groupRows]) => {
                  const copy = readinessGroupCopy(status)
                  return (
                    <React.Fragment key={status}>
                      <tr className="bg-[var(--color-surface-2)]">
                        {/* `th scope="colgroup"` y no un `td` estilizado: el
                            encabezado de grupo tiene que ser navegable como tal. */}
                        <th scope="colgroup" colSpan={6} className="px-3 py-2 text-left font-normal">
                          <span className="flex flex-wrap items-center gap-2">
                            <MetaBadge
                              meta={{ label: String(groupRows.length), variant: groupRows[0]!.blocks ? "danger" : status === "segregated_valid" ? "outline" : "warning" }}
                              dot
                            />
                            <span className="text-sm font-semibold text-[var(--color-text)]">{copy.title}</span>
                          </span>
                          {/* La explicación de clase, una vez por grupo: antes
                              se repetía idéntica en cada una de sus filas. */}
                          <span className="mt-0.5 block text-xs text-[var(--color-text-muted)]">{copy.blurb}</span>
                        </th>
                      </tr>
                      {groupRows.map((row) => <ReadinessTableRow key={row.activityId} row={row} />)}
                    </React.Fragment>
                  )
                })}
              </tbody>
            </table>
          </div>

          <ul className="space-y-2 md:hidden">
            {visible.map((row) => <ReadinessCard key={row.activityId} row={row} />)}
          </ul>
        </>
      )}
    </div>
  )
}

function WorksiteCell({ names }: { names: string[] | null }) {
  if (!names) return <span className="text-[var(--color-text-subtle)]">Todas</span>
  if (names.length === 1) return <span>{names[0]}</span>
  return (
    <>
      <Tooltip content={names.join(", ")}>
        <span className="tabular-nums underline decoration-dotted">{names.length} faenas</span>
      </Tooltip>
      {/* Un tooltip no es un medio fiable por teclado para contenido que
          importa: los nombres también van al árbol de accesibilidad. */}
      <span className="sr-only">{names.join(", ")}</span>
    </>
  )
}

function ReadinessTableRow({ row }: { row: ReadinessRow }) {
  return (
    <tr className="group border-b border-[var(--color-border)] last:border-0 hover:bg-[var(--color-surface-2)]">
      <td className="px-3 py-2.5 text-right align-top font-mono text-xs tabular-nums text-[var(--color-text-subtle)]">
        N°{row.n}
      </td>
      <td className="max-w-[28rem] px-3 py-2.5 align-top">
        <span className="line-clamp-2 break-words text-[var(--color-text)]" title={row.activity}>{row.activity}</span>
        <span className="mt-0.5 line-clamp-1 block text-[11px] text-[var(--color-text-muted)]" title={row.reason}>
          {row.reason}
        </span>
      </td>
      <td className="px-3 py-2.5 align-top">
        {row.instrumentKind
          ? (
            <>
              <MetaBadge meta={{ label: row.instrumentKind, variant: "neutral" }} size="sm" />
              {row.instrumentCode && (
                <span className="mt-0.5 block font-mono text-[11px] text-[var(--color-text-subtle)]">{row.instrumentCode}</span>
              )}
            </>
          )
          : <span className="text-[var(--color-text-subtle)]">—</span>}
      </td>
      <td className="px-3 py-2.5 align-top text-xs text-[var(--color-text-muted)]">
        {row.instrumentState ?? "—"}
      </td>
      <td className="px-3 py-2.5 align-top text-xs text-[var(--color-text-muted)]">
        <WorksiteCell names={row.worksiteNames} />
      </td>
      <td className="px-3 py-2.5 align-top">
        <ResolveAction resolution={row.resolution} activityLabel={`N°${row.n} ${row.activity}`} />
      </td>
    </tr>
  )
}

function ReadinessCard({ row }: { row: ReadinessRow }) {
  return (
    <li className="group rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
      <div className="flex items-start justify-between gap-2">
        <span className="font-mono text-xs tabular-nums text-[var(--color-text-subtle)]">N°{row.n}</span>
        {row.instrumentKind && <MetaBadge meta={{ label: row.instrumentKind, variant: "neutral" }} size="sm" />}
      </div>
      <p className="mt-1 text-sm text-[var(--color-text)]">{row.activity}</p>
      <p className="mt-1 text-xs text-[var(--color-text-muted)]">{row.reason}</p>
      {row.worksiteNames && row.worksiteNames.length > 0 && (
        <p className="mt-1 text-xs text-[var(--color-text-subtle)]">{row.worksiteNames.join(", ")}</p>
      )}
      <div className="mt-3">
        <ResolveAction resolution={row.resolution} activityLabel={`N°${row.n} ${row.activity}`} />
      </div>
    </li>
  )
}
