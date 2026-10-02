"use client"

import { usePathname, useSearchParams } from "next/navigation"
import { CaretDown, CaretRight } from "@phosphor-icons/react"
import { RiskClassificationBadge } from "@/components/prevention/risk-classification-badge"
import type { CompletenessIssue } from "@/lib/prevention/miper/completeness"
import type { ActivityNode, ClassificationCounts } from "@/lib/prevention/miper/matrix-tree"
import { RISK_CLASSIFICATIONS } from "@/lib/prevention/miper/methodology"
import type { EntryChange } from "@/lib/prevention/miper/snapshot"
import { hrefToEntry, hrefToTask } from "@/lib/prevention/miper/workspace-url"
import { RiskRow } from "./risk-row"
import { WorkspaceLink } from "./workspace-nav"

function Counts({ counts }: { counts: ClassificationCounts }) {
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      {[...RISK_CLASSIFICATIONS].reverse().filter((cls) => counts[cls] > 0).map((cls) => (
        <span key={cls} className="inline-flex items-center gap-1"><RiskClassificationBadge classification={cls} size="sm" /><span className="text-xs tabular-nums">{counts[cls]}</span></span>
      ))}
    </span>
  )
}

export function ActivitySection({ activity, expanded, onToggle, filtered, incomplete, observed, changes, issuesByEntry }: {
  activity: ActivityNode; expanded: boolean; onToggle: () => void; filtered: boolean
  incomplete: ReadonlySet<string>; observed: ReadonlySet<string>; changes: Map<string, EntryChange>; issuesByEntry: Map<string, CompletenessIssue[]>
}) {
  const pathname = usePathname()
  const params = useSearchParams()
  const headingId = `miper-activity-${activity.key}`
  const totals = filtered ? `${activity.matchingCount} de ${activity.entryCount} riesgos` : `${activity.tasks.length} tarea${activity.tasks.length === 1 ? "" : "s"} · ${activity.entryCount} riesgos`
  return (
    <section aria-labelledby={headingId} className="overflow-hidden rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)]">
      <h2 id={headingId} className="m-0">
        <button type="button" aria-expanded={expanded} onClick={onToggle} className="flex w-full flex-wrap items-center justify-between gap-3 px-4 py-3 text-left hover:bg-[var(--color-surface-2)]">
          <span className="flex items-center gap-2">
            {expanded ? <CaretDown aria-hidden className="size-4" /> : <CaretRight aria-hidden className="size-4" />}
            <span>
              <span className="block text-sm font-semibold">{activity.label}</span>
              <span className="block text-xs font-normal text-[var(--color-text-subtle)]">{totals}</span>
            </span>
          </span>
          <Counts counts={activity.counts} />
        </button>
      </h2>
      {expanded && (
        <ul className="space-y-1 border-t border-[var(--color-border)] p-2">
          {activity.tasks.map((task) => (
            <li key={task.key} className="space-y-2">
              <WorkspaceLink href={hrefToTask(pathname, params, task.key)} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1 rounded-xl px-3 py-2.5 hover:bg-[var(--color-surface-2)] md:grid-cols-[minmax(0,1.4fr)_auto_auto_auto]">
                <span className="min-w-0">
                  <span className="block text-sm font-medium">{task.label}</span>
                  <span className="block truncate text-xs text-[var(--color-text-subtle)]">{[task.positions[0], task.positions.length > 1 ? `+${task.positions.length - 1}` : null, task.locations[0]].filter(Boolean).join(" · ") || "Sin puesto"}</span>
                </span>
                <span className="col-start-1 md:col-start-auto"><Counts counts={task.counts} /></span>
                <span className="col-start-1 text-xs tabular-nums text-[var(--color-text-subtle)] md:col-start-auto">{task.complete} de {task.entries.length} completos{task.observed ? ` · ${task.observed} observado(s)` : ""}{task.modified ? ` · ${task.modified} modificado(s)` : ""}</span>
                <CaretRight aria-hidden className="col-start-2 row-start-1 size-4 text-[var(--color-text-subtle)] md:col-start-auto" />
              </WorkspaceLink>
              {filtered && (
                <ul className="space-y-2 pl-3">
                  {task.matching.map((entry) => (
                    <li key={entry.id}>
                      <RiskRow entry={entry} href={hrefToEntry(pathname, params, entry.id)} observed={observed.has(entry.id)} change={changes.get(entry.id) ?? null} showPosition={task.positions.length > 1}
                        issueCount={incomplete.has(entry.id) ? (issuesByEntry.get(entry.id) ?? []).filter((issue) => issue.severity === "error").length : 0} />
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
