"use client"

import { useState, type ReactNode } from "react"
import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/ui/empty-state"
import type { CompletenessIssue } from "@/lib/prevention/miper/completeness"
import type { ActivityNode } from "@/lib/prevention/miper/matrix-tree"
import type { EntryChange } from "@/lib/prevention/miper/snapshot"
import { ActivitySection } from "./activity-section"

export function MatrixView({ tree, filtered, editable, incomplete, observed, changes, issuesByEntry, onNewTask, toolbar }: {
  tree: ActivityNode[]; filtered: boolean; editable: boolean
  incomplete: ReadonlySet<string>; observed: ReadonlySet<string>; changes: Map<string, EntryChange>; issuesByEntry: Map<string, CompletenessIssue[]>
  riskFactors: ReadonlyArray<{ id: string; name: string }>; hasBaseline: boolean
  onNewTask: () => void
  /** La barra de filtros la arma el workspace (necesita la URL); queda como ranura para probar la vista sin ella. */
  toolbar?: (state: { collapsedAll: boolean; toggleAll: () => void }) => ReactNode
}) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const collapsedAll = tree.length > 0 && tree.every((activity) => collapsed.has(activity.key))
  const toggleAll = () => setCollapsed(collapsedAll ? new Set() : new Set(tree.map((activity) => activity.key)))
  const toggle = (key: string) => setCollapsed((current) => { const next = new Set(current); if (next.has(key)) next.delete(key); else next.add(key); return next })
  return (
    <div className="space-y-3">
      {toolbar?.({ collapsedAll, toggleAll })}
      {tree.length === 0 ? (
        filtered
          ? <EmptyState title="Ningún riesgo coincide con los filtros" description="Quita algún filtro o cambia la búsqueda." />
          : <EmptyState title="Esta MIPER todavía no tiene riesgos" description="Empieza por una tarea: indica la actividad, la tarea y el puesto, y después sus peligros." action={editable ? <Button onClick={onNewTask}>Nueva tarea</Button> : undefined} />
      ) : tree.map((activity) => (
        <ActivitySection key={activity.key} activity={activity} expanded={filtered || !collapsed.has(activity.key)} onToggle={() => toggle(activity.key)}
          filtered={filtered} incomplete={incomplete} observed={observed} changes={changes} issuesByEntry={issuesByEntry} />
      ))}
    </div>
  )
}
