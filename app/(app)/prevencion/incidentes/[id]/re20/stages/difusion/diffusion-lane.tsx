"use client"

import { useState } from "react"
import { CheckCircle, Megaphone } from "@phosphor-icons/react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { EmptyState } from "@/components/ui/empty-state"
import { formatDateTime } from "@/lib/utils"
import { confirmIncidentDiffusionAction, markIncidentDiffusionAction } from "../../../../actions"
import { Re20Text, Re20TextArea } from "../../fields"
import type { Re20DiffusionRecord } from "../../types"
import type { Re20WorkspaceApi } from "../../use-re20-workspace"

export type DiffusionKind = Re20DiffusionRecord["kind"]

const COPY: Record<DiffusionKind, { dialogTitle: string; action: string; emptyTitle: string; emptyText: string; summaryLabel: string; summaryHint: string }> = {
  shift: {
    dialogTitle: "Marcar la difusión en turnos",
    action: "Marcar difusión en turnos",
    emptyTitle: "Aún no se difunde en los turnos",
    emptyText: "Cuando el aprendizaje se comente con los turnos de la faena, márcalo aquí. Otra persona lo confirma después.",
    summaryLabel: "Cómo y a quién se difundió",
    summaryHint: "Por ejemplo: charla de 5 minutos al turno A y B, con registro de asistencia.",
  },
  corrective_measures: {
    dialogTitle: "Marcar la difusión de las medidas correctivas",
    action: "Marcar difusión de medidas",
    emptyTitle: "Las medidas correctivas aún no se difunden",
    emptyText: "Cuando las medidas se comuniquen a quienes deben aplicarlas, márcalo aquí. Otra persona lo confirma después.",
    summaryLabel: "Qué medidas se difundieron y a quién",
    summaryHint: "Por ejemplo: instalación de drenaje y nuevo procedimiento de limpieza, a supervisores de patio.",
  },
}

/** Una vía de difusión con doble confirmación: una persona la marca y otra la confirma. */
export function DiffusionLane({ ws, kind, markedHere, onMarked, id }: {
  ws: Re20WorkspaceApi
  kind: DiffusionKind
  /** Claves `tipo:texto` de las difusiones que ESTA persona marcó en esta sesión (el servidor aún no informa quién marcó). */
  markedHere: ReadonlySet<string>
  onMarked: (summary: string) => void
  id: string
}) {
  const copy = COPY[kind]
  const items = ws.diffusions.filter((item) => item.kind === kind)
  const [open, setOpen] = useState(false)
  const [summary, setSummary] = useState("")
  const [evidence, setEvidence] = useState("")
  const [busy, setBusy] = useState<string | null>(null)
  const canWrite = !ws.readOnly
  const valid = summary.trim().length >= 3

  async function mark() {
    if (!valid) return
    setBusy("mark")
    const result = await ws.runServerAction(
      () => markIncidentDiffusionAction({ incidentId: ws.incident.id, kind, summary: summary.trim(), ...(evidence.trim() ? { evidenceRef: evidence.trim() } : {}) }),
      { requireSaved: false },
    )
    setBusy(null)
    if (result?.ok) {
      onMarked(summary.trim())
      setOpen(false)
      setSummary("")
      setEvidence("")
    }
  }

  async function confirm(diffusionId: string) {
    setBusy(diffusionId)
    await ws.runServerAction(() => confirmIncidentDiffusionAction({ incidentId: ws.incident.id, diffusionId }), { requireSaved: false })
    setBusy(null)
  }

  return (
    <div id={id} className="space-y-3">
      {items.length === 0 ? (
        <EmptyState
          compact
          align="start"
          as="p"
          icon={<Megaphone aria-hidden className="size-5" />}
          title={copy.emptyTitle}
          description={copy.emptyText}
          action={canWrite ? <Button type="button" onClick={() => setOpen(true)}>{copy.action}</Button> : undefined}
        />
      ) : (
        <>
          <ul className="divide-y divide-[var(--color-border)] border-y border-[var(--color-border)]">
            {items.map((item) => {
              const mine = item.markedByUserId ? item.markedByUserId === ws.currentUser.id : markedHere.has(`${item.kind}:${item.summary.trim()}`)
              const confirmed = item.status === "confirmed"
              return (
                <li key={item.id} className="space-y-2 py-3">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    {confirmed
                      ? <Badge variant="success"><CheckCircle aria-hidden weight="fill" className="size-3" />Confirmada</Badge>
                      : <Badge variant="signal">Falta que otra persona la confirme</Badge>}
                    <span className="font-mono text-xs tabular-nums text-[var(--color-text-muted)]">Marcada {formatDateTime(item.markedAt)}{mine ? " por ti" : item.markedByName ? ` por ${item.markedByName}` : ""}</span>
                    {confirmed && item.confirmedAt && <span className="font-mono text-xs tabular-nums text-[var(--color-text-muted)]">Confirmada {formatDateTime(item.confirmedAt)}</span>}
                  </div>
                  <p className="whitespace-pre-wrap text-sm text-[var(--color-text)]">{item.summary}</p>
                  {!confirmed && (
                    <div className="flex flex-wrap items-center gap-3">
                      {ws.permissions.canConfirmDiffusion && !mine && (
                        <Button type="button" variant="secondary" loading={busy === item.id} disabled={busy !== null} onClick={() => void confirm(item.id)}>
                          Confirmar que se difundió
                        </Button>
                      )}
                      <p className="text-xs text-[var(--color-text-muted)]">
                        {mine
                          ? "La marcaste tú: la confirma otra persona con permiso de confirmar difusiones."
                          : ws.permissions.canConfirmDiffusion
                            ? "Si fuiste quien la marcó, no puedes confirmarla."
                            : "Quien la marcó no puede confirmarla; la confirma el supervisor de faena."}
                      </p>
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
          {canWrite && <Button type="button" variant="secondary" onClick={() => setOpen(true)}>{copy.action}</Button>}
        </>
      )}

      <Dialog open={open} onOpenChange={(next) => { if (busy !== "mark") setOpen(next) }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{copy.dialogTitle}</DialogTitle>
            <DialogDescription>Queda pendiente hasta que otra persona confirme que se hizo. Recién ahí se acredita en el PDTP.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 px-1">
            <Re20TextArea id={`${id}-summary`} label={copy.summaryLabel} required rows={4} maxLength={5000} value={summary} onChange={setSummary} helper={copy.summaryHint} />
            <Re20Text id={`${id}-evidence`} label="Referencia de la constancia" value={evidence} onChange={setEvidence} maxLength={4000} helper="Opcional: folio de asistencia, enlace o nombre del archivo." />
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" disabled={busy === "mark"} onClick={() => setOpen(false)}>Cancelar</Button>
            <Button type="button" disabled={!valid} loading={busy === "mark"} onClick={() => void mark()}>Marcar como difundida</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
