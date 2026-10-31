"use client"

import { useId, useState } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Field } from "@/components/ui/field"
import { Textarea } from "@/components/ui/textarea"
import { resolveReviewRequestAction } from "@/app/(app)/combustibles/revisar/actions"
import { DECISION_QUICK_NOTES, MAX_DECISION_NOTE_LENGTH, MIN_DECISION_NOTE_LENGTH, validateDecisionNote } from "@/lib/combustibles/inbox/reasons"
import { useOperation } from "@/lib/hooks/use-operation"
import { toast } from "@/lib/toast"

/** Marca un pedido de revisión como revisado, con la nota de quien lo revisó. Quien lo pidió recibe el aviso. */
export function ResolveRequestForm({ markId, onDone }: { markId: string; onDone?: () => void }) {
  const router = useRouter()
  const noteId = useId()
  const [note, setNote] = useState("")
  const { pending, message, run } = useOperation()
  const noteError = note.length > 0 ? validateDecisionNote(note) : null

  function submit() {
    if (validateDecisionNote(note)) return
    run(
      () => resolveReviewRequestAction({ markId, note: note.trim() }),
      (result) => {
        toast.success(result.message ?? "Pedido revisado")
        setNote("")
        router.refresh()
        onDone?.()
      },
    )
  }

  return (
    <div className="space-y-3">
      <Field
        label="Nota de la revisión"
        htmlFor={noteId}
        required
        helper={`Mínimo ${MIN_DECISION_NOTE_LENGTH} caracteres. Quien pidió la revisión recibe el aviso con tu nota.`}
        error={noteError ?? undefined}
      >
        <Textarea id={noteId} value={note} onChange={(event) => setNote(event.target.value)} rows={3} maxLength={MAX_DECISION_NOTE_LENGTH} error={Boolean(noteError)} disabled={pending} />
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
        <Button type="button" variant="primary" onClick={submit} loading={pending} disabled={pending || validateDecisionNote(note) !== null}>
          Ya se revisó
        </Button>
      </div>
    </div>
  )
}
