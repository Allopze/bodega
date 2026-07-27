import Link from "next/link"
import { ClockCounterClockwise } from "@phosphor-icons/react/dist/ssr"
import { cn, formatDateTime } from "@/lib/utils"
import type { OperationalActivityEntry } from "@/lib/services/operational-activity"

/** Hechos auditables desde el despliegue; no infiere actividad histórica. */
export function RecentActivity({ entries }: { entries: OperationalActivityEntry[] }) {
  return (
    <section className="rounded-2xl border border-slate-200/80 bg-white p-5 sm:p-6 shadow-xs">
      <h2 className="text-base font-bold text-slate-900 border-b border-slate-100 pb-3 mb-3">Actividad reciente</h2>
      {entries.length === 0 ? (
        <p className="py-4 text-xs text-slate-500 text-center">
          Aún no hay hechos verificables desde la activación de este registro operacional.
        </p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {entries.map((entry) => {
            const content = (
              <>
                <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-slate-100 text-slate-500">
                  <ClockCounterClockwise size={15} />
                </span>
                <div className="min-w-0">
                  <p className="text-[13px] font-semibold text-slate-800">
                    {entry.actionLabel}
                    {entry.entityCode ? <span className="ml-1 font-mono tabular-nums text-slate-600">{entry.entityCode}</span> : null}
                  </p>
                  <p className="mt-0.5 truncate text-xs text-slate-500">
                    {entry.worksiteName}{entry.actorName ? ` · ${entry.actorName}` : ""}
                  </p>
                </div>
                <time dateTime={entry.occurredAt} className="hidden text-right font-mono text-[11px] tabular-nums text-slate-400 sm:block">
                  {formatDateTime(entry.occurredAt)}
                </time>
              </>
            )
            return (
              <li key={entry.id}>
                {entry.href ? (
                  <Link
                    href={entry.href}
                    className={cn(
                      "group grid grid-cols-[1.75rem_minmax(0,1fr)_auto] items-center gap-3 py-2.5 sm:gap-4",
                      "transition-colors duration-150 rounded-lg px-2 hover:bg-slate-50",
                      "focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-blue-600"
                    )}
                  >
                    {content}
                  </Link>
                ) : (
                  <div className="grid grid-cols-[1.75rem_minmax(0,1fr)_auto] items-center gap-3 py-2.5 sm:gap-4 px-2">
                    {content}
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
