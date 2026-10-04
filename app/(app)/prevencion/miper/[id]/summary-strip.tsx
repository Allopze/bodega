import type { MiperSnapshot } from "@/lib/prevention/miper/snapshot"
import { cn, formatDate } from "@/lib/utils"

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
    <div className="flex flex-wrap items-center justify-between gap-3 border-b pb-3 text-sm">
      <p className="text-[var(--color-text-muted)]">{snapshot.entries.length} riesgos{taskCount !== undefined ? ` en ${taskCount} ${taskCount === 1 ? "tarea" : "tareas"}` : ""}</p>
      {pending !== undefined && (pending > 0 && onTogglePending ? (
        <button type="button" aria-pressed={pendingActive} onClick={onTogglePending}
          className={cn("rounded-lg px-2 py-1 text-[var(--color-signal-ink)] underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2", pendingActive && "bg-[var(--color-signal-tint)]")}>
          {pending} {pending === 1 ? "riesgo con datos pendientes" : "riesgos con datos pendientes"}
        </button>
      ) : <p className="text-[var(--color-text-muted)]">{pending === 0 ? "Todos los riesgos tienen los datos requeridos" : `${pending} riesgos con datos pendientes`}</p>)}
      <details className="text-xs text-[var(--color-text-muted)]">
        <summary className="cursor-pointer">Datos del documento</summary>
        <p className="mt-2">{snapshot.header.worksiteName} · {snapshot.header.period} · {versionLabel} · Dotación {snapshot.header.headcountTotal ?? "sin informar"}</p>
        {authorName && <p>Elaboró {authorName}{submittedAt ? ` · enviada ${formatDate(submittedAt)}` : ""}</p>}
      </details>
    </div>
  )
}
