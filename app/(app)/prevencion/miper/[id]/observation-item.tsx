"use client"

import { useState } from "react"
import { usePathname, useSearchParams } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { useOperation } from "@/lib/hooks/use-operation"
import { STAGE_LABEL } from "@/lib/prevention/miper/states"
import { hrefToEntry } from "@/lib/prevention/miper/workspace-url"
import type { WorkspaceMode } from "@/lib/prevention/miper/workspace-mode"
import type { MiperObservationView } from "@/lib/services/miper/queries"
import { formatDateTime } from "@/lib/utils"
import { reopenMiperObservationAction, resolveMiperObservationAction, respondMiperObservationAction } from "../actions"
import { WorkspaceLink } from "./workspace-nav"

const STATUS_TEXT: Record<string, { label: string; className: string }> = {
  open: { label: "Abierta", className: "bg-[var(--color-warning-tint)] text-[var(--color-warning-ink)]" },
  answered: { label: "Respondida", className: "bg-[var(--color-signal-tint)] text-[var(--color-signal-ink)]" },
  resolved: { label: "Resuelta", className: "bg-[var(--color-success-tint)] text-[var(--color-success-ink)]" },
}

export function ObservationItem({ observation, mode, onChanged }: { observation: MiperObservationView; mode: WorkspaceMode; /** Ya no se usa: el riesgo se abre con un enlace. Se acepta para no romper a quien aún lo pasa. */ onOpenEntry?: (entryId: string) => void; /** Tras responder, resolver o reabrir. La acción ya revalida y Next refresca la página: no pasar un `router.refresh()`. */ onChanged?: () => void }) {
  const pathname = usePathname()
  const params = useSearchParams()
  const [response, setResponse] = useState("")
  const operation = useOperation({ feedback: "toast", onSuccess: onChanged })
  const status = STATUS_TEXT[observation.status] ?? STATUS_TEXT.open!
  const entryId = observation.entryId
  const canDecide = (observation.stage === "technical" && mode.canReviewTechnical) || (observation.stage === "legal_rrhh" && mode.canApproveLegal)
  return (
    <article className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-3 text-sm" aria-label={`Observación ${observation.entryLabel ?? "general"}`}>
      <header className="flex flex-wrap items-center gap-2">
        <span className={`rounded px-1.5 py-0.5 text-xs font-semibold ${status.className}`}>{status.label}</span>
        {entryId
          ? <WorkspaceLink href={hrefToEntry(pathname, params, entryId, "seguimiento")} className="font-medium underline-offset-2 hover:underline">{observation.entryLabel}</WorkspaceLink>
          : <span className="font-medium">{observation.entryLabel ?? "Observación general"}</span>}
        <span className="text-xs text-[var(--color-text-subtle)]">{STAGE_LABEL[observation.stage as keyof typeof STAGE_LABEL]} · {observation.authorName} · {formatDateTime(observation.createdAt)}</span>
      </header>
      <p className="mt-2 whitespace-pre-wrap">{observation.body}</p>
      {observation.response && (
        <p className="mt-2 border-l-2 border-[var(--color-border)] pl-3 text-[var(--color-text-subtle)]">
          <span className="font-medium text-[var(--color-text)]">Respuesta de {observation.responderName ?? "la prevencionista"}:</span> {observation.response}
        </p>
      )}
      {mode.canRespond && observation.status === "open" && (
        <div className="mt-2 space-y-2">
          <Textarea aria-label="Tu respuesta" value={response} onChange={(event) => setResponse(event.target.value)} placeholder="Qué corregiste o por qué se mantiene" />
          <Button size="sm" disabled={operation.pending || response.trim().length < 5} onClick={() => operation.run(() => respondMiperObservationAction({ observationId: observation.id, response }), () => setResponse(""))}>Responder</Button>
        </div>
      )}
      {canDecide && observation.status === "answered" && (
        <div className="mt-2 flex gap-2">
          <Button size="sm" variant="secondary" disabled={operation.pending} onClick={() => operation.run(() => resolveMiperObservationAction({ observationId: observation.id }))}>Dar por resuelta</Button>
          <Button size="sm" variant="secondary" disabled={operation.pending} onClick={() => operation.run(() => reopenMiperObservationAction({ observationId: observation.id }))}>Reabrir</Button>
        </div>
      )}
    </article>
  )
}
