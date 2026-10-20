"use client"

import * as React from "react"
import { ClipboardText } from "@phosphor-icons/react"
import { MetaBadge } from "@/components/states/state-badge"
import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/ui/empty-state"
import { FilterSearchInput } from "@/components/ui/filter-search-input"
import { FilterToolbar, type ActiveFilterChip } from "@/components/ui/filter-toolbar"
import { ResponsiveDataListCard, ResponsiveDataListField } from "@/components/ui/responsive-data-list"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRoot, TableRow } from "@/components/ui/table"
import { INSPECTION_FREQUENCY_LABELS, inspectionProgramIsOverdue } from "@/lib/prevention/inspections"
import { filterPrograms, normalizeProgramFilters, programSubjectLabel } from "@/lib/prevention/inspection-catalog-logic"
import type { InspectionSubjectOption } from "@/lib/prevention/inspection-list-query"
import { useUrlFilters } from "@/lib/hooks/use-url-filters"
import { cn, formatDate, todayInChile } from "@/lib/utils"
import type { InspectionAssigneeOption } from "../../assignee-picker"
import type { ProgramItem } from "../../_components/catalog-types"
import { EditProgramDialog, RunProgramNowButton, ToggleProgramButton } from "./program-dialogs"

/**
 * El filtro de estado es UN control con cuatro valores. «Vencidas» es un
 * subconjunto de «Activas» y vive en la URL como `vista=vencidas` (es el enlace
 * que usa la bandeja); «Activas» y «Detenidas» viajan como `estado`. Dos
 * controles para lo mismo dejaban combinaciones imposibles
 * (`estado=paused&vista=vencidas`, siempre vacía).
 */
type StateFilter = "all" | "active" | "overdue" | "paused"

const STATE_LABELS: Record<StateFilter, string> = {
  all: "Todos los estados",
  active: "Activas",
  overdue: "Vencidas",
  paused: "Detenidas",
}

const STATE_OPTIONS: StateFilter[] = ["all", "active", "overdue", "paused"]

/**
 * El estado de una programación, con la misma etiqueta y el mismo color en la
 * tabla y en la tarjeta móvil: antes la tabla decía «Sí»/«No» y la tarjeta
 * «Activa»/«Detenida»/«Vencida».
 */
export function programStatusMeta(
  program: Pick<ProgramItem, "isActive" | "templateApproved" | "nextDueOn">,
  today: string,
) {
  if (!program.templateApproved) return { label: "Plantilla reemplazada", variant: "warning" as const }
  if (!program.isActive) return { label: "Detenida", variant: "outline" as const }
  if (inspectionProgramIsOverdue(program, today)) return { label: "Vencida", variant: "warning" as const }
  return { label: "Activa", variant: "success" as const }
}

/** «Mensual · cada 30 días»: la frecuencia y el intervalo que gobierna el calendario. */
function cadenceLabel(program: Pick<ProgramItem, "frequency" | "intervalDays">) {
  const frequency = INSPECTION_FREQUENCY_LABELS[program.frequency] ?? program.frequency
  return `${frequency} · cada ${program.intervalDays} ${program.intervalDays === 1 ? "día" : "días"}`
}

/**
 * Programación: qué instrumento se ejecuta, en qué faena y cada cuánto.
 * El cron diario materializa desde acá, y "Crear y abrir inspección" usa el mismo camino.
 */
export function InspectionProgramsPanel({
  programs, assignees, subjectsByWorksite = {}, riskEntriesByWorksite = {}, canManage, emptyAction, emptyDescription,
}: {
  programs: ProgramItem[]
  assignees: InspectionAssigneeOption[]
  /** Inventario por faena, para declarar QUÉ se inspecciona (INS-04). */
  subjectsByWorksite?: Record<string, InspectionSubjectOption[]>
  riskEntriesByWorksite?: Record<string, { id: string; hazardCode: string; hazard: string }[]>
  canManage: boolean
  /** La acción real del estado vacío (A4): crear la primera programación, o ir a donde se arregla lo que falta. */
  emptyAction?: React.ReactNode
  /** Reemplaza la explicación del estado vacío cuando lo que falta es otra cosa (p. ej. una plantilla aprobada). */
  emptyDescription?: string
}) {
  // I-16: filtros en la URL, mismo patrón que la bandeja. La búsqueda la escribe
  // `FilterSearchInput` (con rebote, y se vacía sola si la URL cambia por fuera).
  const { getFilter, setFilters } = useUrlFilters()
  const today = todayInChile()
  const { status, overdueView } = normalizeProgramFilters({ estado: getFilter("estado"), vista: getFilter("vista") })
  const stateFilter: StateFilter = overdueView ? "overdue" : status
  const worksite = getFilter("faena") || "all"
  const query = getFilter("q").trim()

  const worksites = React.useMemo(() => Array.from(
    new Map(programs.map((item) => [item.worksiteId, item.worksiteName])).entries(),
  ).map(([id, name]) => ({ id, name })), [programs])
  const visiblePrograms = React.useMemo(
    // Una vencida siempre está activa: con la vista de vencidas el estado no
    // vuelve a filtrar (un enlace con `estado=paused&vista=vencidas` no da un vacío falso).
    () => filterPrograms(programs, { query, status: overdueView ? "all" : status, worksite, overdueView, today }),
    [programs, query, status, worksite, overdueView, today],
  )

  function changeState(value: string) {
    setFilters({
      estado: value === "active" || value === "paused" ? value : null,
      vista: value === "overdue" ? "vencidas" : null,
    })
  }
  function clearAll() {
    setFilters({ q: null, estado: null, faena: null, vista: null })
  }
  function removeChip(key: string) {
    // «Estado» son dos claves de la URL: la forma vieja (`estado=overdue`) y la vista.
    setFilters(key === "estado" ? { estado: null, vista: null } : { [key]: null })
  }

  const activeChips: ActiveFilterChip[] = []
  if (stateFilter !== "all") activeChips.push({ key: "estado", label: "Estado", value: stateFilter, displayValue: STATE_LABELS[stateFilter] })
  if (worksite !== "all") {
    const found = worksites.find((item) => item.id === worksite)
    if (found) activeChips.push({ key: "faena", label: "Faena", value: worksite, displayValue: found.name })
  }
  if (query) activeChips.push({ key: "q", label: "Búsqueda", value: query, displayValue: query })
  const isFiltered = stateFilter !== "all" || worksite !== "all" || query !== ""

  const countLabel = `${isFiltered && programs.length !== visiblePrograms.length ? `${visiblePrograms.length} de ${programs.length}` : visiblePrograms.length} ${programs.length === 1 ? "programación" : "programaciones"}`

  return (
    <div className="space-y-4">
      {/* Sin programaciones no hay nada que filtrar: sólo el estado vacío y su acción. */}
      {programs.length > 0 && (
        <FilterToolbar
          // El `mb-4` de la barra se sumaba al espacio entre bloques de este panel.
          className="mb-0"
          activeChips={activeChips}
          onRemoveChip={removeChip}
          onClearAll={clearAll}
          hasActiveFilters={isFiltered}
          actions={<p className="text-eyebrow" aria-live="polite">{countLabel}</p>}
        >
          {/* Búsqueda y selects miden lo mismo (36 px desde `sm`): antes eran 34, 36 y 30. */}
          <FilterSearchInput
            pageKeys={[]}
            placeholder="Instrumento, sujeto o riesgo"
            ariaLabel="Buscar programaciones"
            // 224 px a 1024 para que búsqueda, los dos selects y «Limpiar filtros» quepan en
            // una fila; con más pozo (xl) se ensancha.
            className="h-11 w-full pl-8 text-xs sm:h-9 sm:w-56 xl:w-72"
          />
          <Select value={stateFilter} onValueChange={changeState}>
            <SelectTrigger aria-label="Filtrar programaciones por estado" className="min-w-0 flex-1 sm:min-w-40 sm:flex-none">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {STATE_OPTIONS.map((value) => <SelectItem key={value} value={value}>{STATE_LABELS[value]}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={worksite} onValueChange={(value) => setFilters({ faena: value === "all" ? null : value })}>
            <SelectTrigger aria-label="Filtrar programaciones por faena" className="min-w-0 flex-1 sm:min-w-44 sm:flex-none">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas las faenas</SelectItem>
              {worksites.map((item) => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </FilterToolbar>
      )}

      {visiblePrograms.length === 0 ? (
        <EmptyState
          icon={<ClipboardText size={20} />}
          title={programs.length === 0 ? "Aún no hay programación" : overdueView ? "No hay programaciones vencidas" : "No hay programaciones con estos filtros"}
          description={programs.length === 0
            ? emptyDescription ?? (canManage
              ? "Una programación crea sola la inspección de cada período, con el instrumento y la faena que elijas."
              : "Todavía no se programó ninguna inspección. Quien administra las inspecciones puede crearlas.")
            : overdueView ? "Todas las programaciones activas tienen su próxima fecha al día." : "Ajusta la búsqueda, el estado o la faena."}
          action={programs.length === 0
            ? emptyAction
            : overdueView
              ? <Button type="button" variant="secondary" onClick={() => changeState("all")}>Ver todas</Button>
              : <Button type="button" variant="secondary" onClick={clearAll}>Limpiar filtros</Button>}
        />
      ) : (
        <>
          <div className="space-y-3 md:hidden">
            {visiblePrograms.map((item) => {
              const overdue = inspectionProgramIsOverdue(item, today)
              return (
                <ResponsiveDataListCard
                  key={item.id}
                  // El título de la tarjeta se recorta con elipsis y lo que distingue a
                  // «…EPP», «…EPP (JT)» y «…EPP (PRF)» está al final: aquí se parte en líneas.
                  title={<span className="whitespace-normal break-words">{item.templateName}</span>}
                  description={item.worksiteName}
                  status={<MetaBadge meta={programStatusMeta(item, today)} />}
                  actions={canManage ? <ProgramActions program={item} assignees={assignees} subjectsByWorksite={subjectsByWorksite} riskEntriesByWorksite={riskEntriesByWorksite} /> : undefined}
                >
                  <ResponsiveDataListField label="Cadencia">{cadenceLabel(item)}</ResponsiveDataListField>
                  <ResponsiveDataListField label="Próxima">
                    <span className="tabular-nums">{formatDate(item.nextDueOn)}</span>
                    {overdue && <span className="ml-1.5 font-medium text-[var(--color-warning-ink)]">Vencida</span>}
                  </ResponsiveDataListField>
                  <ResponsiveDataListField label="Asignada a">{item.assigneeName ?? "Sin asignar"}</ResponsiveDataListField>
                  <ResponsiveDataListField label="Sujeto">{programSubjectLabel(item)}</ResponsiveDataListField>
                  {item.riskLabel && <ResponsiveDataListField label="Riesgo MIPER" className="col-span-2">{item.riskLabel}</ResponsiveDataListField>}
                </ResponsiveDataListCard>
              )
            })}
          </div>

          {/* Seis columnas caben de `xl` en adelante; debajo, «Sujeto / riesgo» baja a una
              sublínea del instrumento y «Acción» nunca queda tras un scroll horizontal. */}
          <TableRoot aria-label="Programaciones de inspecciones" className="hidden md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="px-3">Instrumento / faena</TableHead>
                  <TableHead className="px-3">Próxima</TableHead>
                  <TableHead className="px-3">Asignada a</TableHead>
                  <TableHead className="hidden px-3 xl:table-cell">Sujeto / riesgo</TableHead>
                  <TableHead className="px-3">Estado</TableHead>
                  {canManage && <TableHead className="px-3 text-right">Acción</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {visiblePrograms.map((item) => {
                  const overdue = inspectionProgramIsOverdue(item, today)
                  const subject = programSubjectLabel(item)
                  return (
                    <TableRow key={item.id}>
                      <TableCell className="px-3 align-top">
                        <span className="block font-medium">{item.templateName}</span>
                        <span className="block text-xs text-[var(--color-text-muted)]">{item.worksiteName}</span>
                        {/* Bajo `xl` la columna «Sujeto / riesgo» no se ve: va aquí, una línea cada
                            uno. `line-clamp-1` y no `truncate`: un `nowrap` con `max-w` fijaba el
                            ancho mínimo de la columna en ese máximo y la tabla desbordaba a 1024 px. */}
                        <span className="mt-0.5 line-clamp-1 break-words text-xs text-[var(--color-text-subtle)] xl:hidden" title={subject}>{subject}</span>
                        {item.riskLabel && (
                          <span className="line-clamp-1 break-words text-xs text-[var(--color-text-subtle)] xl:hidden" title={`MIPER · ${item.riskLabel}`}>MIPER · {item.riskLabel}</span>
                        )}
                      </TableCell>
                      <TableCell className="px-3 align-top">
                        {/* Sin partir: «18-09-/2026» y «cada 30 / días» en 4 líneas eran ilegibles. */}
                        <span className="block whitespace-nowrap tabular-nums">{formatDate(item.nextDueOn)}</span>
                        <span className="block whitespace-nowrap text-xs text-[var(--color-text-muted)]">{cadenceLabel(item)}</span>
                        {overdue && <span className="block text-xs font-medium text-[var(--color-warning-ink)]">Vencida</span>}
                      </TableCell>
                      <TableCell className="px-3 align-top">
                        {item.assigneeName ?? <span className="text-[var(--color-text-subtle)]">Sin asignar</span>}
                      </TableCell>
                      <TableCell className="hidden max-w-56 px-3 align-top xl:table-cell">
                        <span className="block">{subject}</span>
                        {item.riskLabel && <span className="mt-0.5 block text-xs text-[var(--color-text-subtle)]">MIPER · {item.riskLabel}</span>}
                      </TableCell>
                      <TableCell className="px-3 align-top">
                        <MetaBadge meta={programStatusMeta(item, today)} />
                      </TableCell>
                      {canManage && (
                        <TableCell className="px-3 align-top">
                          <ProgramActions program={item} assignees={assignees} subjectsByWorksite={subjectsByWorksite} riskEntriesByWorksite={riskEntriesByWorksite} className="ml-auto w-40 gap-1" />
                        </TableCell>
                      )}
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </TableRoot>
        </>
      )}
    </div>
  )
}

export function ProgramActions({ program, assignees, subjectsByWorksite, riskEntriesByWorksite, className }: {
  program: ProgramItem
  assignees: InspectionAssigneeOption[]
  subjectsByWorksite: Record<string, InspectionSubjectOption[]>
  riskEntriesByWorksite: Record<string, { id: string; hazardCode: string; hazard: string }[]>
  className?: string
}) {
  const canRun = program.isActive && program.templateApproved
  return (
    // La acción que produce trabajo va primero; editar y detener, que administran la
    // programación, en la línea de abajo. `flex-wrap` en una columna angosta
    // (la tabla) las apila sin esconder ninguna; en la tarjeta caben en una fila.
    <div className={cn("flex w-full flex-wrap items-center justify-end gap-2", className)}>
      {canRun && <RunProgramNowButton program={program} />}
      <EditProgramDialog
        program={program}
        assignees={assignees}
        subjects={subjectsByWorksite[program.worksiteId] ?? []}
        riskEntries={riskEntriesByWorksite[program.worksiteId] ?? []}
      />
      <ToggleProgramButton program={program} />
      {/* I-04: un botón deshabilitado no avisa de forma fiable por teclado/
          lector de pantalla ni en móvil (sin hover); el texto siempre visible
          dice lo mismo en ambos casos, sin JS. */}
      {program.isActive && !program.templateApproved && (
        <p className="w-full text-right text-xs text-[var(--color-warning-ink)]">
          No generará inspecciones: su plantilla ya no está aprobada. Detén este programa y crea uno con una plantilla vigente.
        </p>
      )}
    </div>
  )
}
