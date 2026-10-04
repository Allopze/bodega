"use client"

import { usePathname, useSearchParams } from "next/navigation"
import { CaretDown, CaretRight } from "@phosphor-icons/react"
import type { CompletenessIssue } from "@/lib/prevention/miper/completeness"
import type { ActivityNode } from "@/lib/prevention/miper/matrix-tree"
import type { EntryChange } from "@/lib/prevention/miper/snapshot"
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
  const totals = filtered ? `${activity.matchingCount} de ${activity.entryCount} riesgos` : `${activity.tasks.length} tarea${activity.tasks.length === 1 ? "" : "s"} · ${activity.entryCount} riesgos`
  return (
    <section aria-labelledby={headingId} className="overflow-hidden rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)]">
      <h2 id={headingId} className="m-0">
        <Header type={filtered ? undefined : "button"} aria-expanded={filtered ? undefined : expanded} onClick={filtered ? undefined : onToggle} className="flex w-full flex-wrap items-center justify-between gap-3 px-4 py-3 text-left hover:bg-[var(--color-surface-2)]">
          <span className="flex items-center gap-2">
            {!filtered && (expanded ? <CaretDown aria-hidden className="size-4" /> : <CaretRight aria-hidden className="size-4" />)}
            <span>
              <span className="block text-sm font-semibold">{activity.label}</span>
              <span className="block text-xs font-normal text-[var(--color-text-subtle)]">{totals}</span>
            </span>
          </span>
          <span className="text-xs text-[var(--color-text-muted)]">{activity.tasks.reduce((sum, task) => sum + task.entries.length - task.complete, 0)} riesgos con datos pendientes</span>
        </Header>
      </h2>
      {expanded && (
        <ul className="space-y-1 border-t border-[var(--color-border)] p-2">
          {activity.tasks.map((task) => (
            <li key={task.key} className="space-y-2">
              <WorkspaceLink href={hrefToTask(pathname, params, task.key)} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1 rounded-xl px-3 py-2.5 hover:bg-[var(--color-surface-2)] md:grid-cols-[minmax(0,1.4fr)_auto_auto]">
                <span className="min-w-0">
                  <span className="block text-sm font-medium">{task.label}</span>
                  <span className="block truncate text-xs text-[var(--color-text-subtle)]">{[task.positions[0], task.positions.length > 1 ? `+${task.positions.length - 1}` : null, task.locations[0]].filter(Boolean).join(" · ") || "Sin puesto"}</span>
                </span>
                <span className="col-start-1 text-xs tabular-nums text-[var(--color-text-subtle)] md:col-start-auto">{task.complete} de {task.entries.length} completos{task.observed ? ` · ${task.observed} observado(s)` : ""}{task.modified ? ` · ${task.modified} modificado(s)` : ""}</span>
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
