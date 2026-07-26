import Link from "next/link"
import { ClockCounterClockwise } from "@phosphor-icons/react/dist/ssr"
import { cn, formatDateTime } from "@/lib/utils"
import type { OperationalActivityEntry } from "@/lib/services/operational-activity"

/** Hechos auditables desde el despliegue; no infiere actividad histórica. */
export function RecentActivity({ entries }: { entries: OperationalActivityEntry[] }) {
  return (
    <section>
      <h2 className="text-h2 text-[var(--color-text)] mb-3">Actividad reciente</h2>
      {entries.length === 0 ? (
        <p className="border-y border-[var(--color-border)] py-3 text-sm text-[var(--color-text-muted)]">
          Aún no hay hechos verificables desde la activación de este registro operacional.
        </p>
      ) : (
        <ul className="divide-y divide-[var(--color-border)] border-y border-[var(--color-border)]">
          {entries.map((entry) => {
            const content = <>
              <span className="flex h-7 w-7 items-center justify-center text-[var(--color-text-faint)]"><ClockCounterClockwise size={16} /></span>
              <div className="min-w-0"><p className="text-[13px] font-semibold text-[var(--color-text)]">{entry.actionLabel}{entry.entityCode ? <span className="ml-1 font-mono tabular-nums">{entry.entityCode}</span> : null}</p><p className="mt-0.5 truncate text-xs text-[var(--color-text-muted)]">{entry.worksiteName}{entry.actorName ? ` · ${entry.actorName}` : ""}</p></div>
              <time dateTime={entry.occurredAt} className="hidden text-right font-mono text-[11px] tabular-nums text-[var(--color-text-subtle)] sm:block">{formatDateTime(entry.occurredAt)}</time>
            </>
            return <li key={entry.id}>{entry.href ? <Link href={entry.href} className={cn("group grid grid-cols-[1.75rem_minmax(0,1fr)_auto] items-center gap-3 py-2.5 sm:gap-4", "transition-colors duration-[var(--duration-fast)] hover:bg-[var(--color-primary-tint)]", "focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--color-primary)]")}>{content}</Link> : <div className="grid grid-cols-[1.75rem_minmax(0,1fr)_auto] items-center gap-3 py-2.5 sm:gap-4">{content}</div>}</li>
          })}
        </ul>
      )}
    </section>
  )
}
