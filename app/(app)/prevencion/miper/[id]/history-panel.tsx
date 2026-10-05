"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/ui/empty-state"
import { groupHistoryEvents } from "@/lib/prevention/miper/history-groups"
import { ROLE_CONTEXT_TEXT, historyLabel } from "@/lib/prevention/miper/history-labels"
import { useOperation } from "@/lib/hooks/use-operation"
import type { MiperHistoryEvent, MiperHistoryPage, MiperWorkspace } from "@/lib/services/miper/queries"
import { countOf, formatDate, formatDateTime, toDateTimeAttr } from "@/lib/utils"
import { loadMiperHistoryPageAction } from "./history-actions"

export type HistoryPanelProps = {
  workspace: MiperWorkspace
  history: MiperHistoryPage
}

/**
 * Versiones selladas (la hoja "Modificaciones"), cadena de períodos de la faena
 * (§8.5) y bitácora de eventos. No usa `EntityTimeline`: ése dibuja transiciones
 * de estado (from → to) de `status_history`, y acá la mayoría de los eventos no
 * son cambios de estado (filas, medidas, observaciones).
 */
export function HistoryPanel({ workspace, history }: HistoryPanelProps) {
  /* Las páginas que se agregan con «Cargar más» cuelgan de la `history` que
   * extienden: si llega otra por props (la matriz se revalidó), el cursor y lo
   * agregado ya no corresponden a ella y se descartan. Es el ajuste de estado
   * durante el render de React (guardar lo previo y comparar), no un efecto. */
  const [loaded, setLoaded] = useState<{ base: MiperHistoryPage; events: MiperHistoryEvent[]; nextCursor: string | null }>({ base: history, events: [], nextCursor: history.nextCursor })
  let current = loaded
  if (loaded.base !== history) {
    current = { base: history, events: [], nextCursor: history.nextCursor }
    setLoaded(current)
  }
  const operation = useOperation()
  const events = [...history.events, ...current.events]
  // Una fila por racha de eventos iguales (el importador escribe uno por fila importada).
  const groups = groupHistoryEvents(events)
  const loadMore = () => {
    const cursor = current.nextCursor
    if (!cursor) return
    operation.run(() => loadMiperHistoryPageAction({ matrixId: workspace.matrix.id, cursor }), (result) => {
      const page = result.data as Partial<MiperHistoryPage> | undefined
      if (!page || !Array.isArray(page.events)) return
      const next = page.events
      setLoaded((previous) => previous.base === history ? { ...previous, events: [...previous.events, ...next], nextCursor: page.nextCursor ?? null } : previous)
    })
  }
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <section className="space-y-2">
        <h2 className="text-sm font-semibold">Versiones aprobadas</h2>
        {workspace.versions.length === 0 ? <EmptyState compact as="p" title="Aún sin versiones" description="La primera versión se sella cuando Legal y RRHH aprueba la MIPER." /> : (
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
      {/* §8.5: la cadena de MIPER de la faena por período, para saltar entre
       * versiones vigentes y anteriores sin volver a la portada. */}
      <section className="space-y-2">
        <h2 className="text-sm font-semibold">Otros períodos de la faena</h2>
        {workspace.siblingMatrices.length === 0 ? <EmptyState compact as="p" title="Sin otros períodos" description="Esta es la única MIPER registrada para la faena." /> : (
          <ol className="space-y-2">
            {workspace.siblingMatrices.map((sibling) => (
              <li key={sibling.id} className="flex items-center justify-between gap-2 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-3 text-sm">
                <a className="font-medium hover:underline" href={`/prevencion/miper/${sibling.id}`}>
                  {sibling.period ?? "Sin período"}
                </a>
                <span className="text-[var(--color-text-subtle)]">
                  {sibling.label}{sibling.versionNumber ? ` · Versión ${sibling.versionNumber}` : ""}
                </span>
              </li>
            ))}
          </ol>
        )}
      </section>
      <section className="space-y-2 lg:col-span-2">
        <h2 className="text-sm font-semibold">Bitácora</h2>
        <ol className="space-y-1 text-sm">
          {groups.map(({ first: event, count }, index) => (
            <li key={event.id} className="flex flex-wrap gap-x-2 border-b border-[var(--color-border)] py-1.5 sm:grid sm:grid-cols-[8.5rem_minmax(0,1fr)_minmax(0,18rem)] sm:gap-x-3">
              <time className="tabular-nums text-[var(--color-text-subtle)]" dateTime={toDateTimeAttr(event.at)}>{formatDateTime(event.at)}</time>
              <span className="font-medium">{historyLabel(event.changeType, { object: event.object, count, atLeast: index === groups.length - 1 && Boolean(current.nextCursor) })}</span>
              <span>{event.actorName ?? "Sistema"}{event.actingAs ? ` (${ROLE_CONTEXT_TEXT[event.actingAs] ?? "otro rol"})` : ""}</span>
              {event.reason && <span className="w-full text-[var(--color-text-subtle)] sm:col-span-3">{event.reason}</span>}
            </li>
          ))}
        </ol>
        {/* `status` (C7): es polite y atómico, así que se anuncia la frase entera y no sólo «60 eventos». */}
        <p role="status" aria-live="polite" className="text-xs text-[var(--color-text-subtle)]">Mostrando {countOf(events.length, "evento", "eventos")}</p>
        {operation.message && <p role="alert" className="text-sm text-[var(--color-danger)]">{operation.message}</p>}
        {current.nextCursor && <Button size="sm" variant="secondary" disabled={operation.pending} onClick={loadMore}>Cargar más</Button>}
      </section>
    </div>
  )
}
