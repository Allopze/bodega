"use client"

import { useId, useState } from "react"
import { useRouter } from "next/navigation"
import { ArrowCounterClockwise } from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"
import { Field } from "@/components/ui/field"
import { Textarea } from "@/components/ui/textarea"
import { reopenFlaggedDecisionAction } from "@/app/(app)/combustibles/revisar/actions"
import { MAX_DECISION_NOTE_LENGTH, MIN_DECISION_NOTE_LENGTH, validateDecisionNote } from "@/lib/combustibles/inbox/reasons"
import { useOperation } from "@/lib/hooks/use-operation"
import { toast } from "@/lib/toast"

/**
 * «Deshacer decisión»: la carga deja de estar decidida y la serie del equipo se
 * recalcula. Pide una nota (10 a 500 caracteres) que queda junto a la decisión
 * anterior en la auditoría, pero no una confirmación: el campo de la nota es un
 * formulario, no un diálogo, y deshacer es rutina (la carga puede volver a
 * decidirse en cualquier momento).
 *
 * Lo usan «Decididas» y la ficha de la carga. `onDone` corre después de deshacer.
 */
export function ReopenDecisionButton({ loadId, label, onDone }: { loadId: string; label: string; onDone?: () => void }) {
  const router = useRouter()
  const noteId = useId()
  const [open, setOpen] = useState(false)
  const [note, setNote] = useState("")
  const { pending, message, run } = useOperation()
  const noteError = note.length > 0 ? validateDecisionNote(note) : null

  function submit() {
    if (validateDecisionNote(note)) return
    run(
      () => reopenFlaggedDecisionAction({ loadId, note: note.trim() }),
      (result) => {
        toast.success(result.message ?? "Decisión deshecha")
        setNote("")
        setOpen(false)
        router.refresh()
        onDone?.()
      },
    )
  }

  if (!open) {
    return (
      <Button type="button" variant="secondary" size="sm" className="min-h-11 md:min-h-8" onClick={() => setOpen(true)} aria-label={`Deshacer la decisión sobre ${label}`}>
        <ArrowCounterClockwise size={14} aria-hidden />
        Deshacer decisión
      </Button>
    )
  }

  return (
    <div className="space-y-3 rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface-2)] p-3">
      <Field
        label="¿Por qué se deshace?"
        htmlFor={noteId}
        required
        helper={`Mínimo ${MIN_DECISION_NOTE_LENGTH} caracteres. La carga vuelve a calcularse con la serie del equipo y puede volver a «Pendientes».`}
        error={noteError ?? undefined}
      >
        <Textarea
          id={noteId}
          value={note}
          onChange={(event) => setNote(event.target.value)}
          rows={2}
          maxLength={MAX_DECISION_NOTE_LENGTH}
          error={Boolean(noteError)}
          disabled={pending}
        />
      </Field>
      {message ? <p role="alert" className="text-sm text-[var(--color-danger-ink)]">{message}</p> : null}
      <div className="flex flex-wrap justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={() => { setOpen(false); setNote("") }} disabled={pending}>Volver</Button>
        <Button type="button" variant="primary" size="sm" onClick={submit} loading={pending} disabled={pending || validateDecisionNote(note) !== null}>
          Deshacer decisión
        </Button>
      </div>
    </div>
  )
}
