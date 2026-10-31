"use client"

import { useId, useState } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { ChoiceCardGroup } from "@/components/ui/choice-card-group"
import { Field } from "@/components/ui/field"
import { Textarea } from "@/components/ui/textarea"
import { decideFlaggedLoadsAction } from "@/app/(app)/combustibles/revisar/actions"
import { DECISION_QUICK_NOTES, decisionCopyFor, MAX_DECISION_NOTE_LENGTH, MIN_DECISION_NOTE_LENGTH, validateDecisionNote } from "@/lib/combustibles/inbox/reasons"
import { useOperation } from "@/lib/hooks/use-operation"
import { toast } from "@/lib/toast"

type Choice = "approve" | "reject"

/**
 * «Cuenta / No cuenta» para una o varias cargas por decidir, con los rótulos del
 * motivo (en una duplicada: «Son dos cargas distintas» / «Es la misma carga») y
 * el efecto de cada opción a la vista. La nota es obligatoria (10 a 500
 * caracteres) y queda en la auditoría. No pide confirmación: decidir es rutina y
 * se puede deshacer desde «Decididas».
 *
 * Lo usan la hoja de la bandeja y la ficha de la carga. `onDone` corre después
 * de registrar la decisión (cerrar la hoja, por ejemplo); la pantalla se
 * refresca sola.
 */
export function DecideLoadButtons({
  loadIds,
  reasonCodes,
  label,
  onDone,
}: {
  loadIds: string[]
  reasonCodes: readonly string[]
  /** «CA-14, 85 L»: a quién se refiere, para el nombre accesible. */
  label: string
  onDone?: () => void
}) {
  const router = useRouter()
  const noteId = useId()
  const copy = decisionCopyFor(reasonCodes)
  const [choice, setChoice] = useState<Choice | null>(null)
  const [note, setNote] = useState("")
  const { pending, message, run } = useOperation()
  const noteError = note.length > 0 ? validateDecisionNote(note) : null
  const ready = choice !== null && validateDecisionNote(note) === null

  function submit() {
    if (!choice || validateDecisionNote(note)) return
    const decision = choice
    run(
      () => decideFlaggedLoadsAction({ loadIds, decision, note: note.trim() }),
      (result) => {
        toast.success(result.message ?? "Decisión registrada")
        setNote("")
        setChoice(null)
        router.refresh()
        onDone?.()
      },
    )
  }

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <ChoiceCardGroup<Choice>
          label={`Tu decisión sobre ${label}`}
          required
          className="sm:grid-cols-2"
          value={choice}
          onChange={setChoice}
          disabled={pending}
          options={[
            { value: "approve", title: copy.yes, description: copy.yesEffect, tone: "positive" },
            { value: "reject", title: copy.no, description: copy.noEffect, tone: "negative" },
          ]}
        />
      </div>
      <Field
        label="Nota de la decisión"
        htmlFor={noteId}
        required
        helper={`Mínimo ${MIN_DECISION_NOTE_LENGTH} caracteres. Queda registrada con tu nombre.`}
        error={noteError ?? undefined}
      >
        <Textarea
          id={noteId}
          value={note}
          onChange={(event) => setNote(event.target.value)}
          rows={3}
          maxLength={MAX_DECISION_NOTE_LENGTH}
          placeholder="Por qué decides esto"
          error={Boolean(noteError)}
          disabled={pending}
        />
      </Field>
      <div className="flex flex-wrap gap-1.5" aria-label="Motivos de uso frecuente">
        {DECISION_QUICK_NOTES.map((quick) => (
          <button
            key={quick}
            type="button"
            disabled={pending}
            onClick={() => setNote((current) => (current.trim() ? `${current.trim()}. ${quick}` : quick).slice(0, MAX_DECISION_NOTE_LENGTH))}
            className="min-h-11 rounded-full border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-xs text-[var(--color-text-muted)] transition-colors hover:border-[var(--color-border-strong)] hover:text-[var(--color-text)] focus-visible:outline-2 focus-visible:outline-[var(--color-primary)] sm:min-h-8"
          >
            {quick}
          </button>
        ))}
      </div>
      {message ? <p role="alert" className="text-sm text-[var(--color-danger-ink)]">{message}</p> : null}
      <div className="flex justify-end">
        <Button type="button" variant="primary" onClick={submit} loading={pending} disabled={pending || !ready}>
          Confirmar decisión
        </Button>
      </div>
    </div>
  )
}
