"use client"

import { useState } from "react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Callout } from "@/components/ui/callout"
import { EmptyState } from "@/components/ui/empty-state"
import { Textarea } from "@/components/ui/textarea"
import { useOperation } from "@/lib/hooks/use-operation"
import { hrefToReviewWalk, reviewQuickFilters } from "@/lib/prevention/miper/review-walk"
import type { MiperEntrySnapshot } from "@/lib/prevention/miper/snapshot"
import { STAGE_LABEL } from "@/lib/prevention/miper/states"
import type { WorkspaceMode } from "@/lib/prevention/miper/workspace-mode"
import type { MiperWorkspace } from "@/lib/services/miper/queries"
import { countOf, formatDateTime } from "@/lib/utils"
import { addMiperObservationAction } from "../actions"
import { ObservationItem } from "./observation-item"
import { WorkspaceLink } from "./workspace-nav"

export type ReviewPanelProps = {
  workspace: MiperWorkspace
  mode: WorkspaceMode
  onOpenEntry: (entryId: string) => void
  rows: readonly MiperEntrySnapshot[]
  observed: ReadonlySet<string>
  modified: ReadonlySet<string>
  hasBaseline: boolean
}

export function ReviewPanel({ workspace, mode, onOpenEntry, rows, observed, modified, hasBaseline }: ReviewPanelProps) {
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()
  const quickFilters = reviewQuickFilters(rows, { observed, modified, hasBaseline })
  const [body, setBody] = useState("")
  const operation = useOperation({ feedback: "toast", onSuccess: () => router.refresh() })
  const groups = [
    { key: "open", title: "Abiertas" },
    { key: "answered", title: "Respondidas (pendientes de confirmar)" },
    { key: "resolved", title: "Resueltas" },
  ] as const
  const openCount = workspace.observations.filter((item) => item.status === "open").length
  return (
    <section className="space-y-4">
      {workspace.openRound && (
        <p className="text-sm text-[var(--color-text-subtle)]">
          Ronda {workspace.openRound.roundNumber} · {STAGE_LABEL[workspace.openRound.stage]} · enviada {formatDateTime(workspace.openRound.submittedAt)}{workspace.openRound.openedAt ? ` · abierta ${formatDateTime(workspace.openRound.openedAt)}` : " · aún no abierta por la revisora"}
        </p>
      )}
      {/* Lectura: la ven todos los que ven la pestaña. Cada atajo abre el editor en el primer riesgo del filtro, con el filtro en la URL. */}
      <section aria-labelledby="review-walk-title" className="space-y-2">
        <h2 id="review-walk-title" className="text-sm font-semibold">Recorrer la MIPER</h2>
        <ul className="flex flex-wrap gap-2 text-sm">
          {quickFilters.map((filter) => (
            <li key={filter.key}>
              {filter.firstEntryId
                ? <WorkspaceLink href={hrefToReviewWalk(pathname, params, filter.patch, filter.firstEntryId)} className="inline-flex rounded-full border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1 font-medium text-[var(--color-primary-ink)] hover:underline">{filter.label} ({filter.count})</WorkspaceLink>
                : <span className="inline-flex px-3 py-1 text-[var(--color-text-subtle)]">Sin {filter.label.toLowerCase()}</span>}
            </li>
          ))}
        </ul>
      </section>
      {mode.canRespond && (
        <Callout tone="warning" title={openCount > 0 ? `Tienes ${countOf(openCount, "observación", "observaciones")} por responder` : "Todas las observaciones están respondidas"}>
          Corrige la matriz donde corresponda, responde cada observación y luego usa «Reenviar a revisión».
        </Callout>
      )}
      {mode.canObserve && (
        <div className="space-y-2 rounded-[var(--radius-2xl)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
          <p className="text-sm font-medium">Observación general</p>
          <Textarea aria-label="Observación general" value={body} onChange={(event) => setBody(event.target.value)} placeholder="Algo que no corresponde a una fila en particular (antecedentes, participación, cobertura)." />
          <Button size="sm" disabled={operation.pending || body.trim().length < 5} onClick={() => operation.run(() => addMiperObservationAction({ matrixId: workspace.matrix.id, entryId: null, body }), () => setBody(""))}>Registrar observación general</Button>
        </div>
      )}
      {workspace.observations.length === 0 ? (
        <EmptyState title="Sin observaciones" description={mode.canObserve ? "Observa una fila desde la matriz (botón «Observar») o registra una observación general." : "Cuando la revisión registre observaciones, aparecerán aquí con su respuesta."} />
      ) : groups.map((group) => {
        const items = workspace.observations.filter((item) => item.status === group.key)
        if (items.length === 0) return null
        return (
          <details key={group.key} open={group.key !== "resolved"} className="space-y-2">
            <summary className="cursor-pointer text-sm font-semibold">{group.title} ({items.length})</summary>
            <div className="mt-2 space-y-2">{items.map((item) => <ObservationItem key={item.id} observation={item} mode={mode} onOpenEntry={onOpenEntry} onChanged={() => router.refresh()} />)}</div>
          </details>
        )
      })}
    </section>
  )
}
