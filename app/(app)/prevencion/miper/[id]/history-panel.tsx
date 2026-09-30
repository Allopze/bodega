import { EmptyState } from "@/components/ui/empty-state"
import { ACTING_AS_TEXT, historyLabel } from "@/lib/prevention/miper/history-labels"
import type { MiperHistoryEvent, MiperWorkspace } from "@/lib/services/miper/queries"
import { formatDate, formatDateTime } from "@/lib/utils"

export type HistoryPanelProps = {
  workspace: MiperWorkspace
  history: MiperHistoryEvent[]
}

/**
 * Versiones selladas (la hoja "Modificaciones") y bitácora de eventos. No usa
 * `EntityTimeline`: ése dibuja transiciones de estado (from → to) de
 * `status_history`, y acá la mayoría de los eventos no son cambios de estado
 * (filas, medidas, observaciones).
 */
export function HistoryPanel({ workspace, history }: HistoryPanelProps) {
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <section className="space-y-2">
        <h2 className="text-sm font-semibold">Versiones aprobadas</h2>
        {workspace.versions.length === 0 ? <EmptyState title="Aún sin versiones" description="La primera versión se sella cuando Legal y RRHH aprueba la MIPER." /> : (
          <ol className="space-y-2">
            {workspace.versions.map((version) => (
              <li key={version.id} className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-3 text-sm">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold">Versión {version.versionNumber} · {formatDate(version.approvedAt)}</span>
                  <a className="underline" href={`/api/prevencion/miper/${version.id}/export`}>Descargar Excel</a>
                </div>
                <p className="mt-1">{version.changeSummary}</p>
                <p className="mt-1 text-xs text-[var(--color-text-subtle)]">Elaboró {version.elaboratedByName} · Revisó {version.technicalReviewerName} · Aprobó {version.approverName}</p>
              </li>
            ))}
          </ol>
        )}
      </section>
      <section className="space-y-2">
        <h2 className="text-sm font-semibold">Bitácora</h2>
        <ol className="space-y-1 text-sm">
          {history.map((event) => (
            <li key={event.id} className="flex flex-wrap gap-x-2 border-b border-[var(--color-border)] py-1.5">
              <time className="tabular-nums text-[var(--color-text-subtle)]" dateTime={event.at}>{formatDateTime(event.at)}</time>
              <span className="font-medium">{historyLabel(event.changeType)}</span>
              <span>{event.actorName ?? "Sistema"}{event.actingAs ? ` (${ACTING_AS_TEXT[event.actingAs] ?? "otro rol"})` : ""}</span>
              {event.reason && <span className="w-full text-[var(--color-text-subtle)]">{event.reason}</span>}
            </li>
          ))}
        </ol>
      </section>
    </div>
  )
}
