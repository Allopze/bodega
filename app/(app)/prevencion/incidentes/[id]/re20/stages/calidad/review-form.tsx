"use client"

import { useState } from "react"
import { PaperPlaneTilt } from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"
import { ChoiceCardGroup } from "@/components/ui/choice-card-group"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { RE20_QUALITY_CRITERIA, RE20_QUALITY_RESULTS, RE20_REVIEW_DECISIONS } from "@/lib/prevention/incidents"
import { toast } from "@/lib/toast"
import { reviewPreventionIncidentRe20QualityAction } from "../../../../actions"
import { Re20Block, Re20TextArea } from "../../fields"
import type { Re20WorkspaceApi } from "../../use-re20-workspace"
import {
  QUALITY_CRITERION_ID,
  QUALITY_DRAFT_KEY,
  QUALITY_ID,
  evaluatedCount,
  qualityBlockers,
  qualityPayload,
  readQualityDraft,
  type QualityDecision,
  type QualityResult,
} from "./rules"

const RESULT_TONES = { meets: "positive", partial: "warning", does_not_meet: "negative" } as const

const DECISION_RULES: Record<QualityDecision, string> = {
  approved: "Exige los 13 criterios en «Cumple». Habilita la difusión.",
  approved_with_observations: "No admite criterios en «No cumple». Pide observación final. Habilita la difusión.",
  changes_required: "Reabre el informe definitivo y devuelve el caso al equipo. Pide observación final.",
}

/** Formulario de la revisión RE-20-13: 13 criterios, decisión explícita y observación final. */
export function QualityReviewForm({ ws }: { ws: Re20WorkspaceApi }) {
  const draft = readQualityDraft(ws.extras[QUALITY_DRAFT_KEY])
  const blockers = qualityBlockers(draft)
  const evaluated = evaluatedCount(draft)
  const [notesOpen, setNotesOpen] = useState<ReadonlySet<string>>(new Set())
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const needsObservation = draft.decision !== null && draft.decision !== "approved"

  const save = (next: typeof draft) => ws.setExtra(QUALITY_DRAFT_KEY, next)
  const setResult = (id: string, result: QualityResult) => save({ ...draft, criteria: { ...draft.criteria, [id]: { ...draft.criteria[id], result } } })
  const setNote = (id: string, observation: string) => save({ ...draft, criteria: { ...draft.criteria, [id]: { ...draft.criteria[id], observation } } })

  async function send() {
    if (blockers.length > 0 || busy) return
    if (ws.version < 1) {
      setConfirming(false)
      return void toast.error("El expediente aún no se guardó: no hay una versión que revisar.")
    }
    setBusy(true)
    // `requireSaved: false`: quien revisa no edita el expediente, y guardar lo volvería «autor» de la última edición.
    const result = await ws.runServerAction(
      (version) => reviewPreventionIncidentRe20QualityAction({ incidentId: ws.incident.id, expectedWorkspaceVersion: version, ...qualityPayload(draft) }),
      { requireSaved: false },
    )
    setBusy(false)
    setConfirming(false)
    if (result?.ok) ws.setExtra(QUALITY_DRAFT_KEY, null)
  }

  return (
    <div>
      <Re20Block
        id={QUALITY_ID("block-criteria")}
        title="Los 13 criterios"
        summary={evaluated === RE20_QUALITY_CRITERIA.length ? "Todos evaluados" : `${evaluated} de ${RE20_QUALITY_CRITERIA.length} evaluados`}
        complete={evaluated === RE20_QUALITY_CRITERIA.length}
        defaultOpen
      >
        <ol className="divide-y divide-[var(--color-border)] border-y border-[var(--color-border)]">
          {RE20_QUALITY_CRITERIA.map((criterion, index) => {
            const entry = draft.criteria[criterion.id]
            const result = entry?.result ?? null
            const labelId = `${QUALITY_CRITERION_ID(criterion.id)}-label`
            const showNote = (result !== null && result !== "meets") || Boolean(entry?.observation) || notesOpen.has(criterion.id)
            return (
              <li key={criterion.id} id={QUALITY_CRITERION_ID(criterion.id)} className="space-y-3 py-4">
                <div className="min-w-0">
                  <p id={labelId} className="font-medium text-[var(--color-text)]">
                    <span className="mr-2 font-mono text-xs tabular-nums text-[var(--color-text-subtle)]">{index + 1}</span>
                    {criterion.criterion}
                  </p>
                  <p className="mt-0.5 text-sm text-[var(--color-text-muted)]">{criterion.verification}</p>
                </div>
                <ChoiceCardGroup
                  aria-labelledby={labelId}
                  variant="compact"
                  required
                  options={RE20_QUALITY_RESULTS.map((option) => ({ value: option.id as QualityResult, title: option.label, tone: RESULT_TONES[option.id] }))}
                  value={result}
                  onChange={(next) => setResult(criterion.id, next)}
                />
                {showNote ? (
                  <Re20TextArea
                    id={QUALITY_ID(`note-${criterion.id}`)}
                    label={result === "meets" || result === null ? "Nota" : "Qué debe corregir el equipo"}
                    rows={2}
                    maxLength={1000}
                    value={entry?.observation}
                    onChange={(value) => setNote(criterion.id, value)}
                  />
                ) : (
                  <Button type="button" variant="ghost" size="sm" onClick={() => setNotesOpen(new Set([...notesOpen, criterion.id]))}>
                    Agregar una nota
                  </Button>
                )}
              </li>
            )
          })}
        </ol>
      </Re20Block>

      <Re20Block
        id={QUALITY_ID("block-decision")}
        title="Decisión"
        summary={draft.decision ? RE20_REVIEW_DECISIONS.find((item) => item.id === draft.decision)?.label : "Sin elegir"}
        complete={draft.decision !== null && blockers.length === 0}
        defaultOpen
      >
        <div id={QUALITY_ID("decision")} className="space-y-2">
          <p id={QUALITY_ID("decision-label")} className="text-sm font-medium text-[var(--color-text)]">La decisión la tomas tú; no se calcula con los resultados</p>
          <ChoiceCardGroup
            aria-labelledby={QUALITY_ID("decision-label")}
            required
            options={RE20_REVIEW_DECISIONS.map((option) => ({ value: option.id as QualityDecision, title: option.label, description: DECISION_RULES[option.id] }))}
            value={draft.decision}
            onChange={(next) => save({ ...draft, decision: next })}
          />
        </div>
        <Re20TextArea
          id={QUALITY_ID("observation")}
          label="Observación final"
          required={needsObservation}
          rows={4}
          maxLength={5000}
          value={draft.observation}
          onChange={(value) => save({ ...draft, observation: value })}
          helper={needsObservation ? "Obligatoria: es lo que el equipo lee primero." : "Opcional al aprobar sin reparos."}
        />
      </Re20Block>

      <div className="space-y-2 pt-3">
        {blockers.length > 0 && (
          <div>
            <p className="text-sm text-[var(--color-text-muted)]">Para registrar la revisión falta:</p>
            <ul className="mt-1 space-y-0.5">
              {blockers.slice(0, 5).map((item) => (
                <li key={`${item.fieldId}-${item.label}`}>
                  <Button type="button" variant="link" className="text-left text-sm" onClick={() => ws.focusField(item.fieldId)}>{item.label}</Button>
                </li>
              ))}
              {blockers.length > 5 && <li className="text-xs text-[var(--color-text-subtle)]">y {blockers.length - 5} más</li>}
            </ul>
          </div>
        )}
        <Button
          type="button"
          disabled={blockers.length > 0 || busy}
          loading={busy}
          onClick={() => (draft.decision === "changes_required" ? setConfirming(true) : void send())}
        >
          <PaperPlaneTilt aria-hidden className="size-4" />
          Registrar la revisión
        </Button>
      </div>

      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title="Pedir correcciones al equipo"
        description="Esto reabre el informe definitivo: el equipo investigador deberá corregirlo y volver a cerrarlo, y después la revisión se hace de nuevo. Tu observación queda registrada en el historial."
        confirmLabel="Pedir correcciones"
        onConfirm={() => void send()}
        loading={busy}
      />
    </div>
  )
}
