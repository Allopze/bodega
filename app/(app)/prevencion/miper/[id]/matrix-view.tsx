"use client"

import { useLayoutEffect, useMemo, useState, type ReactNode } from "react"
import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/ui/empty-state"
import { SegmentedControl } from "@/components/ui/segmented-control"
import type { CompletenessIssue } from "@/lib/prevention/miper/completeness"
import type { ActivityNode } from "@/lib/prevention/miper/matrix-tree"
import { countOf } from "@/lib/utils"
import type { EntryChange } from "@/lib/prevention/miper/snapshot"
import { ActivitySection } from "./activity-section"
import { BulkBar } from "./bulk-bar"
import type { BulkContext } from "./bulk-shared"
import { useRiskSelection } from "./use-risk-selection"
import { readCollapsedActivities, useRestoreWorkspaceScroll, writeCollapsedActivities } from "./workspace-memory"

export function MatrixView({ matrixId, tree, filtered, editable, incomplete, observed, changes, issuesByEntry, onNewTask, onClearFilters, toolbar, bulk, presentation, onPresentationChange }: {
  matrixId: string
  presentation?: "estructura" | "resultados"
  onPresentationChange?: (presentation: "estructura" | "resultados") => void
  tree: ActivityNode[]; filtered: boolean; editable: boolean
  incomplete: ReadonlySet<string>; observed: ReadonlySet<string>; changes: Map<string, EntryChange>; issuesByEntry: Map<string, CompletenessIssue[]>
  onNewTask: () => void
  /** Quita todos los filtros de la matriz (la CTA del estado vacío filtrado, regla A4). */
  onClearFilters: () => void
  /** La barra de filtros la arma el workspace (necesita la URL); queda como ranura para probar la vista sin ella. */
  toolbar?: (state: { filtered: boolean }) => ReactNode
  /** Acciones masivas (Fase D): sólo con edición y en resultados, con o sin filtros. */
  bulk?: BulkContext
}) {
  const results = presentation ? presentation === "resultados" : filtered
  // Abrir una tarea desmonta la matriz: lo plegado se recuerda por matriz en
  // `sessionStorage`. Se lee en un efecto de layout —antes de pintar, sin
  // desfasar la hidratación— y se escribe en cada cambio.
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set())
  useLayoutEffect(() => { setCollapsed(readCollapsedActivities(matrixId)) }, [matrixId])
  useRestoreWorkspaceScroll()
  const update = (next: Set<string>) => { setCollapsed(next); writeCollapsedActivities(matrixId, next) }
  const collapsedAll = tree.length > 0 && tree.every((activity) => collapsed.has(activity.key))
  const toggleAll = () => update(collapsedAll ? new Set() : new Set(tree.map((activity) => activity.key)))
  const toggle = (key: string) => { const next = new Set(collapsed); if (next.has(key)) next.delete(key); else next.add(key); update(next) }
  // La presentación de resultados expone todos los riesgos del árbol (con o sin filtros).
  const matching = useMemo(() => (results ? tree.flatMap((activity) => activity.tasks.flatMap((task) => task.matching)) : []), [results, tree])
  const selection = useRiskSelection(matching)
  // Volver a estructura termina la selección; quitar filtros no cambia una presentación explícita.
  const [wasResults, setWasResults] = useState(results)
  if (wasResults !== results) {
    setWasResults(results)
    if (!results) selection.stop()
  }
  const selecting = Boolean(bulk) && results && selection.selecting
  return (
    <div className="space-y-3">
      {toolbar?.({ filtered })}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">{results ? "Lista de riesgos" : "Por actividades y tareas"}</h2>
          <p className="text-xs text-[var(--color-text-muted)]">{results ? `${countOf(matching.length, "riesgo")}${filtered ? " con los filtros actuales" : " en toda la matriz"}` : filtered ? "Actividades y tareas con riesgos que coinciden con los filtros." : "Abre una tarea para consultar y completar sus riesgos."}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {onPresentationChange && <SegmentedControl variant="segmented" ariaLabel="Presentación de la matriz" items={[
            { key: "estructura", label: "Por actividad", active: !results, onClick: () => onPresentationChange("estructura") },
            { key: "resultados", label: "Lista de riesgos", active: results, onClick: () => onPresentationChange("resultados") },
          ]} />}
          {!results && tree.length > 0 && <Button size="sm" variant="secondary" onClick={toggleAll}>{collapsedAll ? "Expandir todo" : "Contraer todo"}</Button>}
          {bulk && tree.length > 0 && (results || onPresentationChange) && <Button size="sm" variant="secondary" onClick={() => {
            if (selecting) selection.stop()
            else { onPresentationChange?.("resultados"); selection.start() }
          }}>{selecting ? "Terminar selección" : "Seleccionar riesgos"}</Button>}
          {selecting && <Button size="sm" variant="ghost" onClick={selection.selectAll}>Seleccionar los {matching.length} resultados</Button>}
        </div>
      </div>
      {tree.length === 0 ? (
        filtered
          // La barra ya ofrece «Limpiar filtros»: el CTA del vacío dice lo que logra, no repite el nombre (QA A2, fila 6).
          ? <EmptyState title="Ningún riesgo coincide con los filtros" description="Quita algún filtro o cambia la búsqueda." action={<Button variant="secondary" onClick={onClearFilters}>Ver todos los riesgos</Button>} />
          : <EmptyState title="Esta MIPER todavía no tiene riesgos" description="Empieza por una tarea: indica la actividad, la tarea y el puesto, y después sus peligros." action={editable ? <Button onClick={onNewTask}>Nueva tarea</Button> : undefined} />
      ) : tree.map((activity) => (
        <ActivitySection key={activity.key} activity={activity} expanded={results || !collapsed.has(activity.key)} onToggle={() => toggle(activity.key)}
          filtered={results} incomplete={incomplete} observed={observed} changes={changes} issuesByEntry={issuesByEntry} selection={selecting ? selection : null} />
      ))}
      {bulk && selecting && <BulkBar selected={selection.selected} context={bulk} onClear={selection.clear} />}
    </div>
  )
}
