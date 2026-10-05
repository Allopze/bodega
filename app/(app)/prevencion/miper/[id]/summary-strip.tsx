import { CaretRight } from "@phosphor-icons/react"
import type { MiperSnapshot } from "@/lib/prevention/miper/snapshot"
import { cn, countOf, formatDate } from "@/lib/utils"

/** Contexto compacto. La clasificación y el estado de control se consultan en filtros. */
export function SummaryStrip({ snapshot, authorName, submittedAt, versionLabel, taskCount, completeCount, pendingActive = false, onTogglePending }: {
  snapshot: MiperSnapshot
  authorName: string | null
  submittedAt: string | null
  versionLabel: string
  taskCount?: number
  completeCount?: number
  pendingActive?: boolean
  onTogglePending?: () => void
}) {
  const pending = completeCount === undefined ? undefined : snapshot.entries.length - completeCount
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--color-border)] pb-3 text-sm">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <p className="text-[var(--color-text-muted)]">{countOf(snapshot.entries.length, "riesgo")}{taskCount !== undefined ? ` en ${countOf(taskCount, "tarea")}` : ""}</p>
        {pending !== undefined && (pending > 0 && onTogglePending ? (
          <button type="button" aria-pressed={pendingActive} onClick={onTogglePending}
            className={cn("inline-flex min-h-11 items-center rounded-lg px-2 py-1 sm:min-h-0 text-[var(--color-signal-ink)] underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2", pendingActive && "bg-[var(--color-signal-tint)]")}>
            {countOf(pending, "riesgo con datos pendientes", "riesgos con datos pendientes")}
          </button>
        ) : <p className="text-[var(--color-text-muted)]">{pending === 0 ? "Todos los riesgos tienen los datos requeridos" : countOf(pending, "riesgo con datos pendientes", "riesgos con datos pendientes")}</p>)}
      </div>
      <details className="group text-xs text-[var(--color-text-muted)]">
        <summary className="inline-flex min-h-11 cursor-pointer list-none items-center gap-1 sm:min-h-0 [&::-webkit-details-marker]:hidden"><CaretRight aria-hidden className="size-3 group-open:rotate-90 motion-safe:transition-transform duration-[var(--duration-fast)]" />Datos del documento</summary>
        <p className="mt-2">{snapshot.header.worksiteName} · {snapshot.header.period} · {versionLabel} · Dotación {snapshot.header.headcountTotal ?? "sin informar"}</p>
        {authorName && <p>Elaboró {authorName}{submittedAt ? ` · enviada ${formatDate(submittedAt)}` : ""}</p>}
      </details>
    </div>
  )
}
