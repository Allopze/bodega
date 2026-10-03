"use client"

import { useRef, useState } from "react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/ui/empty-state"
import type { CompletenessIssue } from "@/lib/prevention/miper/completeness"
import { mostFrequent, type TaskNode } from "@/lib/prevention/miper/matrix-tree"
import type { EntryChange } from "@/lib/prevention/miper/snapshot"
import { hrefToEntry, hrefToMatrix } from "@/lib/prevention/miper/workspace-url"
import { toast } from "@/lib/toast"
import { saveMiperEntryAction } from "../actions"
import { BulkBar } from "./bulk-bar"
import type { BulkContext } from "./bulk-shared"
import { SelectableRiskRow } from "./risk-row"
import { TaskContextDialog } from "./task-context-dialog"
import { useRiskSelection } from "./use-risk-selection"
import { beforeForwardNavigation, useRestoreWorkspaceScroll } from "./workspace-memory"
import { WorkspaceLink } from "./workspace-nav"

export function TaskView({ matrixId, task, editable, incomplete, observed, changes, issuesByEntry, bulk }: {
  matrixId: string
  task: TaskNode
  editable: boolean
  incomplete: ReadonlySet<string>
  observed: ReadonlySet<string>
  changes: Map<string, EntryChange>
  issuesByEntry: Map<string, CompletenessIssue[]>
  /** Acciones masivas (Fase D): sólo con edición. Sin esto no hay «Seleccionar» ni «Editar tarea». */
  bulk?: BulkContext
}) {
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()
  const [adding, setAdding] = useState(false)
  const addingRef = useRef(false)
  const selection = useRiskSelection(task.entries)
  const [editingContext, setEditingContext] = useState(false)
  // Al volver del editor, la tarea retoma su scroll (lo guarda `navigateWorkspace` al salir).
  useRestoreWorkspaceScroll()

  async function addHazard() {
    if (addingRef.current) return
    addingRef.current = true
    setAdding(true)
    try {
      const state = await saveMiperEntryAction({
        matrixId,
        insertAfterRowNumber: task.lastRowNumber,
        values: {
          activity: task.activity, task: task.task,
          position: mostFrequent(task.entries.map((entry) => entry.position)),
          location: mostFrequent(task.entries.map((entry) => entry.location)),
          isRoutine: mostFrequent(task.entries.map((entry) => entry.isRoutine)),
        },
      })
      const id = (state.data as { id?: unknown } | undefined)?.id
      if (!state.ok || typeof id !== "string") { toast.error(state.message ?? "No se pudo agregar el peligro."); return }
      // El riesgo nuevo tiene que venir del servidor: aquí sí corresponde router.push.
      const href = hrefToEntry(pathname, params, id, "identificacion")
      beforeForwardNavigation(href)
      router.push(href)
    } catch {
      toast.error("No se pudo agregar el peligro.")
    } finally {
      addingRef.current = false
      setAdding(false)
    }
  }

  const errorCount = (entryId: string) => (issuesByEntry.get(entryId) ?? []).filter((issue) => issue.severity === "error").length
  const facts: Array<[string, string]> = [
    ["Puestos", task.positions.join(", ") || "—"],
    ["Lugares", task.locations.join(", ") || "—"],
    ["Personas expuestas", task.maxExposed > 0 ? `hasta ${task.maxExposed}` : "—"],
    ["Estado", `${task.complete} de ${task.entries.length} completos`],
  ]
  return (
    <div className="space-y-4">
      <WorkspaceLink href={hrefToMatrix(pathname, params)} restoreScroll className="text-sm font-medium text-[var(--color-primary-ink)] hover:underline">‹ Volver a la matriz</WorkspaceLink>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-xl font-semibold">{task.label}</h2>
          <p className="text-sm text-[var(--color-text-subtle)]">{task.activity ?? "Sin actividad"}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {bulk && task.entries.length > 0 && <Button variant="secondary" onClick={() => setEditingContext(true)}>Editar tarea</Button>}
          {bulk && task.entries.length > 0 && (
            <Button variant="secondary" onClick={selection.selecting ? selection.stop : selection.start}>{selection.selecting ? "Terminar selección" : "Seleccionar"}</Button>
          )}
          {editable && <Button onClick={() => { void addHazard() }} loading={adding}>Agregar peligro</Button>}
        </div>
      </div>
      <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-border)] md:grid-cols-4">
        {facts.map(([label, value]) => (
          <div key={label} className="bg-[var(--color-surface)] px-3 py-2.5">
            <dt className="text-xs text-[var(--color-text-subtle)]">{label}</dt>
            <dd className="text-sm font-medium">{value}</dd>
          </div>
        ))}
      </dl>
      <section aria-labelledby="miper-task-risks" className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 id="miper-task-risks" className="text-sm font-semibold">Peligros identificados ({task.entries.length})</h3>
          {selection.selecting && <Button size="sm" variant="ghost" onClick={selection.selectAll}>Seleccionar los {task.entries.length} riesgos</Button>}
        </div>
        {task.entries.length === 0
          ? <EmptyState compact title="Esta tarea no tiene riesgos" description="Agrega el primer peligro de la tarea para evaluarlo." action={editable ? <Button onClick={() => { void addHazard() }} loading={adding}>Agregar peligro</Button> : undefined} />
          : (
            <ul className="space-y-2">
              {task.entries.map((entry) => (
                <li key={entry.id}>
                  <SelectableRiskRow entry={entry} href={hrefToEntry(pathname, params, entry.id)} issueCount={incomplete.has(entry.id) ? errorCount(entry.id) : 0}
                    observed={observed.has(entry.id)} change={changes.get(entry.id) ?? null} showPosition={task.positions.length > 1}
                    selection={selection.selecting ? { checked: selection.isSelected(entry.id), onToggle: () => selection.toggle(entry.id) } : null} />
                </li>
              ))}
            </ul>
          )}
      </section>
      {bulk && selection.selecting && <BulkBar selected={selection.selected} context={bulk} onClear={selection.clear} />}
      {bulk && editingContext && <TaskContextDialog task={task} context={bulk} onOpenChange={setEditingContext} />}
    </div>
  )
}
