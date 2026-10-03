"use client"

import { useLayoutEffect, useState, type ReactNode } from "react"
import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/ui/empty-state"
import type { CompletenessIssue } from "@/lib/prevention/miper/completeness"
import type { ActivityNode } from "@/lib/prevention/miper/matrix-tree"
import type { EntryChange } from "@/lib/prevention/miper/snapshot"
import { ActivitySection } from "./activity-section"
import { readCollapsedActivities, useRestoreWorkspaceScroll, writeCollapsedActivities } from "./workspace-memory"

export function MatrixView({ matrixId, tree, filtered, editable, incomplete, observed, changes, issuesByEntry, onNewTask, onClearFilters, toolbar }: {
  matrixId: string
  tree: ActivityNode[]; filtered: boolean; editable: boolean
  incomplete: ReadonlySet<string>; observed: ReadonlySet<string>; changes: Map<string, EntryChange>; issuesByEntry: Map<string, CompletenessIssue[]>
  onNewTask: () => void
  /** Quita todos los filtros de la matriz (la CTA del estado vacío filtrado, regla A4). */
  onClearFilters: () => void
  /** La barra de filtros la arma el workspace (necesita la URL); queda como ranura para probar la vista sin ella. */
  toolbar?: (state: { collapsedAll: boolean; toggleAll: () => void; filtered: boolean }) => ReactNode
}) {
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
  return (
    <div className="space-y-3">
      {toolbar?.({ collapsedAll, toggleAll, filtered })}
      {tree.length === 0 ? (
        filtered
          // La barra ya ofrece «Limpiar filtros»: el CTA del vacío dice lo que logra, no repite el nombre (QA A2, fila 6).
          ? <EmptyState title="Ningún riesgo coincide con los filtros" description="Quita algún filtro o cambia la búsqueda." action={<Button variant="secondary" onClick={onClearFilters}>Ver todos los riesgos</Button>} />
          : <EmptyState title="Esta MIPER todavía no tiene riesgos" description="Empieza por una tarea: indica la actividad, la tarea y el puesto, y después sus peligros." action={editable ? <Button onClick={onNewTask}>Nueva tarea</Button> : undefined} />
      ) : tree.map((activity) => (
        <ActivitySection key={activity.key} activity={activity} expanded={filtered || !collapsed.has(activity.key)} onToggle={() => toggle(activity.key)}
          filtered={filtered} incomplete={incomplete} observed={observed} changes={changes} issuesByEntry={issuesByEntry} />
      ))}
    </div>
  )
}
