"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Callout } from "@/components/ui/callout"
import { EmptyState } from "@/components/ui/empty-state"
import { Textarea } from "@/components/ui/textarea"
import { useOperation } from "@/lib/hooks/use-operation"
import { STAGE_LABEL } from "@/lib/prevention/miper/states"
import type { WorkspaceMode } from "@/lib/prevention/miper/workspace-mode"
import type { MiperWorkspace } from "@/lib/services/miper/queries"
import { formatDateTime } from "@/lib/utils"
import { addMiperObservationAction } from "../actions"
import { ObservationItem } from "./observation-item"

export type ReviewPanelProps = {
  workspace: MiperWorkspace
  mode: WorkspaceMode
  onOpenEntry: (entryId: string) => void
}

export function ReviewPanel({ workspace, mode, onOpenEntry }: ReviewPanelProps) {
  const router = useRouter()
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
      {mode.canRespond && (
        <Callout tone="warning" title={openCount > 0 ? `Tienes ${openCount} observación(es) por responder` : "Todas las observaciones están respondidas"}>
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
