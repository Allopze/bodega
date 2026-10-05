"use client"

import { usePathname, useSearchParams } from "next/navigation"
import { CaretDown, CaretRight, CheckCircle } from "@phosphor-icons/react"
import type { CompletenessIssue } from "@/lib/prevention/miper/completeness"
import type { ActivityNode } from "@/lib/prevention/miper/matrix-tree"
import type { EntryChange } from "@/lib/prevention/miper/snapshot"
import { countOf } from "@/lib/utils"
import { hrefToEntry, hrefToTask } from "@/lib/prevention/miper/workspace-url"
import { SelectableRiskRow } from "./risk-row"
import type { RiskSelection } from "./use-risk-selection"
import { WorkspaceLink } from "./workspace-nav"

export function ActivitySection({ activity, expanded, onToggle, filtered, incomplete, observed, changes, issuesByEntry, selection = null }: {
  activity: ActivityNode; expanded: boolean; onToggle: () => void; filtered: boolean
  incomplete: ReadonlySet<string>; observed: ReadonlySet<string>; changes: Map<string, EntryChange>; issuesByEntry: Map<string, CompletenessIssue[]>
  /** Modo «Seleccionar» de la vista filtrada (Fase D): una casilla al lado de cada riesgo. */
  selection?: RiskSelection | null
}) {
  const pathname = usePathname()
  const params = useSearchParams()
  const Header = filtered ? "div" : "button"
  const headingId = `miper-activity-${activity.key}`
  const totals = filtered ? `${activity.matchingCount} de ${countOf(activity.entryCount, "riesgo")}` : `${countOf(activity.tasks.length, "tarea")} · ${countOf(activity.entryCount, "riesgo")}`
  const labelId = `${headingId}-label`
  const pending = activity.tasks.reduce((sum, task) => sum + task.entries.length - task.complete, 0)
  return (
    <section aria-labelledby={labelId} className="overflow-hidden rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)]">
      {/* h3 bajo el h2 «Por actividades y tareas»; su nombre es sólo la actividad (el resumen no se lee como parte del título). El id se mantiene: Inicio hace scroll a él. */}
      <h3 id={headingId} aria-labelledby={labelId} className="m-0">
        <Header type={filtered ? undefined : "button"} aria-expanded={filtered ? undefined : expanded} onClick={filtered ? undefined : onToggle} className="flex w-full flex-wrap items-center justify-between gap-3 px-4 py-3 text-left hover:bg-[var(--color-surface-2)]">
          <span className="flex min-w-0 items-center gap-2">
            {!filtered && (expanded ? <CaretDown aria-hidden className="size-4" /> : <CaretRight aria-hidden className="size-4" />)}
            <span className="min-w-0">
              <span id={labelId} className="block break-words text-sm font-semibold">{activity.label}</span>
              <span className="block text-xs font-normal text-[var(--color-text-subtle)]">{totals}</span>
            </span>
          </span>
          {pending > 0
            ? <span className="text-xs font-medium text-[var(--color-signal-ink)]">{countOf(pending, "riesgo con datos pendientes", "riesgos con datos pendientes")}</span>
            : <span className="inline-flex items-center gap-1 text-xs text-[var(--color-text-muted)]"><CheckCircle aria-hidden weight="fill" className="size-4 text-[var(--color-success-ink)]" />Completa</span>}
        </Header>
      </h3>
      {expanded && (
        <ul className="space-y-1 border-t border-[var(--color-border)] p-2">
          {activity.tasks.map((task) => (
            <li key={task.key} className="space-y-2">
              <WorkspaceLink href={hrefToTask(pathname, params, task.key)} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1 rounded-xl px-3 py-2.5 hover:bg-[var(--color-surface-2)] md:grid-cols-[minmax(0,1.4fr)_auto_auto]">
                <span className="min-w-0">
                  <span className="block break-words text-sm font-medium">{task.label}</span>
                  <span title={[task.positions.join(", "), task.locations.join(", ")].filter(Boolean).join(" · ") || undefined} className="block truncate text-xs text-[var(--color-text-subtle)]">{[task.positions[0] ? task.positions[0] + (task.positions.length > 1 ? ` y ${countOf(task.positions.length - 1, "puesto más", "puestos más")}` : "") : null, task.locations[0]].filter(Boolean).join(" · ") || "Sin puesto"}</span>
                </span>
                <span className="col-start-1 text-xs tabular-nums text-[var(--color-text-subtle)] md:col-start-auto">
                  {task.entries.length - task.complete > 0
                    ? <span className="font-medium text-[var(--color-signal-ink)]">{task.entries.length - task.complete} de {task.entries.length} con datos pendientes</span>
                    : countOf(task.entries.length, "riesgo completo", "riesgos completos")}
                  {task.observed ? ` · ${countOf(task.observed, "observado", "observados")}` : ""}{task.modified ? ` · ${countOf(task.modified, "modificado", "modificados")}` : ""}
                </span>
                <CaretRight aria-hidden className="col-start-2 row-start-1 size-4 text-[var(--color-text-subtle)] md:col-start-auto md:row-start-auto" />
              </WorkspaceLink>
              {filtered && (
                <ul className="space-y-2 pl-3">
                  {task.matching.map((entry) => (
                    <li key={entry.id}>
                      <SelectableRiskRow entry={entry} href={hrefToEntry(pathname, params, entry.id)} observed={observed.has(entry.id)} change={changes.get(entry.id) ?? null} showPosition={task.positions.length > 1}
                        issueCount={incomplete.has(entry.id) ? (issuesByEntry.get(entry.id) ?? []).filter((issue) => issue.severity === "error").length : 0}
                        selection={selection ? { checked: selection.isSelected(entry.id), onToggle: () => selection.toggle(entry.id) } : null} />
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
