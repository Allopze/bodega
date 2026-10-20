"use client"

import * as React from "react"
import { ClipboardText, MagnifyingGlass } from "@phosphor-icons/react"
import { MetaBadge } from "@/components/states/state-badge"
import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/ui/empty-state"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { INSPECTION_FREQUENCY_LABELS, inspectionProgramIsOverdue } from "@/lib/prevention/inspections"
import { filterPrograms, normalizeProgramFilters, programSubjectLabel } from "@/lib/prevention/inspection-catalog-logic"
import type { InspectionSubjectOption } from "@/lib/prevention/inspection-list-query"
import { useUrlFilters } from "@/lib/hooks/use-url-filters"
import { formatDate, todayInChile } from "@/lib/utils"
import type { InspectionAssigneeOption } from "../../assignee-picker"
import type { ProgramItem } from "../../_components/catalog-types"
import { EditProgramDialog, RunProgramNowButton, ToggleProgramButton } from "./program-dialogs"

/**
 * Programación: qué instrumento se ejecuta, en qué faena y con qué frecuencia.
 * El cron diario materializa desde acá, y "Ejecutar ahora" usa el mismo camino.
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
  // I-16: filtros en la URL, mismo patrón que la bandeja — sólo `vista` sobrevivía al refresh.
  const { getFilter, setFilters } = useUrlFilters()
  const today = todayInChile()
  // «Vencidas» es una vista, no un estado: un mismo concepto en dos controles
  // dejaba combinaciones imposibles (`estado=paused&vista=vencidas`, siempre vacía).
  const { status, overdueView } = normalizeProgramFilters({ estado: getFilter("estado"), vista: getFilter("vista") })
  const worksite = getFilter("faena") || "all"
  const urlQuery = getFilter("q")
  const [query, setQueryDraft] = React.useState(urlQuery)
  React.useEffect(() => setQueryDraft(urlQuery), [urlQuery])
  React.useEffect(() => {
    const next = query.trim()
    if (next === urlQuery) return
    const timer = setTimeout(() => setFilters({ q: next || null }), 350)
    return () => clearTimeout(timer)
  }, [query, urlQuery, setFilters])
  const worksites = React.useMemo(() => Array.from(
    new Map(programs.map((item) => [item.worksiteId, item.worksiteName])).entries(),
  ).map(([id, name]) => ({ id, name })), [programs])
  const visiblePrograms = React.useMemo(
    () => filterPrograms(programs, { query: urlQuery, status, worksite, overdueView, today }),
    [programs, urlQuery, status, worksite, overdueView, today],
  )

  return (
    <div className="space-y-4">
      <div className="grid gap-2 sm:grid-cols-[minmax(14rem,1fr)_12rem_12rem_auto]">
        <div className="relative">
          <MagnifyingGlass size={16} aria-hidden className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-subtle)]" />
          <Input value={query} onChange={(event) => setQueryDraft(event.target.value)} placeholder="Buscar plantilla, sujeto o riesgo" aria-label="Buscar programaciones" className="pl-9" />
        </div>
        <Select value={status} onValueChange={(value) => setFilters({ estado: value === "all" ? null : value, vista: null })}><SelectTrigger aria-label="Filtrar programaciones por estado"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">Todos los estados</SelectItem><SelectItem value="active">Activas</SelectItem><SelectItem value="paused">Detenidas</SelectItem></SelectContent></Select>
        <Select value={worksite} onValueChange={(value) => setFilters({ faena: value === "all" ? null : value })}><SelectTrigger aria-label="Filtrar programaciones por faena"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">Todas las faenas</SelectItem>{worksites.map((item) => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}</SelectContent></Select>
        <Button
          type="button"
          size="sm"
          variant={overdueView ? "primary" : "secondary"}
          aria-pressed={overdueView}
          onClick={() => setFilters({ vista: overdueView ? null : "vencidas", estado: null })}
        >
          {overdueView ? "Ver todas" : "Sólo vencidas"}
        </Button>
      </div>
      <p className="text-eyebrow">{visiblePrograms.length} {visiblePrograms.length === 1 ? "programación" : "programaciones"}</p>

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
              ? <Button type="button" variant="secondary" onClick={() => setFilters({ vista: null, estado: null })}>Ver todas</Button>
              : <Button type="button" variant="secondary" onClick={() => setFilters({ q: null, estado: null, faena: null, vista: null })}>Limpiar filtros</Button>}
        />
      ) : (
        <>
        <div className="space-y-3 md:hidden">
          {visiblePrograms.map((item) => {
            const overdue = inspectionProgramIsOverdue(item, today)
            return (
              <article key={item.id} className="space-y-3 rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
                <div className="flex items-start justify-between gap-3">
                  <div><h2 className="text-sm font-semibold">{item.templateName}</h2><p className="mt-1 text-xs text-[var(--color-text-subtle)]">{item.worksiteName}</p></div>
                  <MetaBadge meta={{ label: `${!item.templateApproved ? "Plantilla reemplazada" : !item.isActive ? "Detenida" : overdue ? "Vencida" : "Activa"}`, variant: !item.templateApproved ? "warning" : !item.isActive ? "outline" : overdue ? "warning" : "success" }} />
                </div>
                <dl className="grid grid-cols-2 gap-3 text-xs">
                  <div><dt className="text-[var(--color-text-subtle)]">Cadencia</dt><dd className="mt-0.5 font-medium">{INSPECTION_FREQUENCY_LABELS[item.frequency] ?? item.frequency} · {item.intervalDays} días</dd></div>
                  <div><dt className="text-[var(--color-text-subtle)]">Próxima</dt><dd className="mt-0.5 font-medium tabular-nums">{formatDate(item.nextDueOn)}</dd></div>
                  <div><dt className="text-[var(--color-text-subtle)]">Asignada a</dt><dd className="mt-0.5 font-medium">{item.assigneeName ?? "Sin asignar"}</dd></div>
                  <div><dt className="text-[var(--color-text-subtle)]">Sujeto</dt><dd className="mt-0.5 font-medium">{programSubjectLabel(item)}</dd></div>
                </dl>
                {item.riskLabel && <p className="rounded-lg bg-[var(--color-surface-2)] px-3 py-2 text-xs"><span className="text-[var(--color-text-subtle)]">Riesgo MIPER:</span> {item.riskLabel}</p>}
                {canManage && <ProgramActions program={item} assignees={assignees} subjectsByWorksite={subjectsByWorksite} riskEntriesByWorksite={riskEntriesByWorksite} />}
              </article>
            )
          })}
        </div>
        <div className="hidden overflow-x-auto rounded-lg border border-[var(--color-border)] md:block">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Plantilla</TableHead>
                <TableHead>Faena</TableHead>
                <TableHead>Frecuencia</TableHead>
                <TableHead>Próxima</TableHead>
                <TableHead>Asignada a</TableHead>
                <TableHead>Contexto</TableHead>
                <TableHead>Activa</TableHead>
                {canManage && <TableHead className="text-right">Acción</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {visiblePrograms.map((item) => (
                <TableRow key={item.id}>
                  <TableCell className="text-sm">{item.templateName}</TableCell>
                  <TableCell className="text-sm">{item.worksiteName}</TableCell>
                  <TableCell className="text-sm">
                    {INSPECTION_FREQUENCY_LABELS[item.frequency] ?? item.frequency}
                    <span className="block text-xs text-[var(--color-text-subtle)]">cada {item.intervalDays} {item.intervalDays === 1 ? "día" : "días"}</span>
                  </TableCell>
                  <TableCell className="text-sm tabular-nums">
                    {formatDate(item.nextDueOn)}
                    {inspectionProgramIsOverdue(item, today) && (
                      <span className="block text-xs text-[var(--color-warning-ink)]">Vencida</span>
                    )}
                  </TableCell>
                  <TableCell className="text-sm">{item.assigneeName ?? "Sin asignar"}</TableCell>
                  <TableCell className="max-w-64 text-sm">
                    <span>{programSubjectLabel(item)}</span>
                    {item.riskLabel && <span className="mt-1 block text-xs text-[var(--color-text-subtle)]">MIPER · {item.riskLabel}</span>}
                  </TableCell>
                  <TableCell className="text-sm">
                    {!item.templateApproved
                      ? <MetaBadge meta={{ label: "Plantilla reemplazada", variant: "warning" }} />
                      : item.isActive ? "Sí" : "No"}
                  </TableCell>
                  {canManage && (
                    <TableCell className="text-right">
                      <ProgramActions program={item} assignees={assignees} subjectsByWorksite={subjectsByWorksite} riskEntriesByWorksite={riskEntriesByWorksite} />
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        </>
      )}
    </div>
  )
}

export function ProgramActions({ program, assignees, subjectsByWorksite, riskEntriesByWorksite }: {
  program: ProgramItem
  assignees: InspectionAssigneeOption[]
  subjectsByWorksite: Record<string, InspectionSubjectOption[]>
  riskEntriesByWorksite: Record<string, { id: string; hazardCode: string; hazard: string }[]>
}) {
  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      <EditProgramDialog
        program={program}
        assignees={assignees}
        subjects={subjectsByWorksite[program.worksiteId] ?? []}
        riskEntries={riskEntriesByWorksite[program.worksiteId] ?? []}
      />
      <ToggleProgramButton program={program} />
      {program.isActive && (program.templateApproved
        ? <RunProgramNowButton program={program} />
        // I-04: un botón deshabilitado no avisa de forma fiable por teclado/
        // lector de pantalla ni en móvil (sin hover); el texto siempre visible
        // dice lo mismo en ambos casos, sin JS.
        : <p className="max-w-64 text-right text-xs text-[var(--color-warning-ink)]">
            No producirá inspecciones: su plantilla ya no está aprobada. Detén este programa y crea uno nuevo apuntando a una plantilla vigente.
          </p>)}
    </div>
  )
}
