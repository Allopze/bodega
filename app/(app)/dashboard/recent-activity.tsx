import Link from "next/link"
import { ClockCounterClockwise } from "@phosphor-icons/react/dist/ssr"
import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/ui/empty-state"
import { cn, formatDateTime } from "@/lib/utils"
import type { OperationalActivityEntry } from "@/lib/services/operational-activity"

/** Hechos auditables desde el despliegue; no infiere actividad histórica. */
export function RecentActivity({ entries }: { entries: OperationalActivityEntry[] }) {
  return (
    <section className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5 sm:p-6 shadow-xs">
      <h2 className="text-h3 text-[var(--color-text)] border-b border-[var(--color-border)] pb-3 mb-3">Actividad reciente</h2>
      {entries.length === 0 ? (
        // A4: lenguaje de usuario + CTA real. La actividad se genera al trabajar
        // las tareas, así que abrir los pendientes es literalmente la acción que
        // llena esta lista — no hay un "crear actividad" que inventar.
        <EmptyState
          compact
          align="start"
          icon={<ClockCounterClockwise size={20} />}
          title="Todavía no hay movimientos"
          description="Aquí van a aparecer las solicitudes, órdenes, recepciones y entregas a medida que tú y tu equipo las registren."
          action={<Button asChild size="sm" variant="secondary"><Link href="/pendientes">Ver mis pendientes</Link></Button>}
        />
      ) : (
        <ul className="divide-y divide-[var(--color-border)]">
          {entries.map((entry) => {
            const content = (
              <>
                <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-[var(--color-surface-2)] text-[var(--color-text-muted)]">
                  <ClockCounterClockwise size={15} />
                </span>
                <div className="min-w-0">
                  <p className="text-[13px] font-semibold text-[var(--color-text)]">
                    {entry.actionLabel}
                    {entry.entityCode ? <span className="ml-1 font-mono tabular-nums text-[var(--color-text-muted)]">{entry.entityCode}</span> : null}
                  </p>
                  <p className="mt-0.5 truncate text-xs text-[var(--color-text-muted)]">
                    {entry.worksiteName}{entry.actorName ? ` · ${entry.actorName}` : ""}
                  </p>
                </div>
                <time dateTime={entry.occurredAt} className="hidden text-right font-mono text-[11px] tabular-nums text-[var(--color-text-faint)] sm:block">
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
                      "transition-colors duration-150 rounded-lg px-2 hover:bg-[var(--color-surface-2)]",
                      "focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--color-primary)]"
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
