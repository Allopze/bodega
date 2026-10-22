"use client"

import { useId, useState } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Field } from "@/components/ui/field"
import { Textarea } from "@/components/ui/textarea"
import { useOperation } from "@/lib/hooks/use-operation"
import { toast } from "@/lib/toast"
import { approveFlaggedLoadAction, rejectFlaggedLoadAction } from "./actions"
import { MAX_DECISION_NOTE_LENGTH, MIN_DECISION_NOTE_LENGTH, validateDecisionNote } from "./review-helpers"

type Decision = "approve" | "reject"

const COPY: Record<Decision, { title: string; confirm: string; description: string; success: string }> = {
  approve: {
    title: "Aprobar carga",
    confirm: "Aprobar carga",
    description: "La carga entra a los promedios y desviaciones del equipo. Queda registrada tu decisión.",
    success: "Carga aprobada",
  },
  reject: {
    title: "Rechazar carga",
    confirm: "Rechazar carga",
    description: "La carga deja de contar en litros, promedios y desviaciones. No se borra: queda registrada con tu motivo.",
    success: "Carga rechazada",
  },
}

/**
 * Aprobar / Rechazar una carga marcada. La nota es obligatoria (≥10
 * caracteres) y se valida aquí y en el servidor. Al decidir, la fila sale de la
 * bandeja y el contador de la navegación se actualiza con el refresco.
 */
export function DecisionButtons({ loadId, label }: { loadId: string; label: string }) {
  const router = useRouter()
  const noteId = useId()
  const [decision, setDecision] = useState<Decision | null>(null)
  const [note, setNote] = useState("")
  const { pending, message, setMessage, run } = useOperation()
  const noteError = note.length > 0 ? validateDecisionNote(note) : null

  function open(next: Decision) {
    setNote("")
    setMessage("")
    setDecision(next)
  }

  function close() {
    if (!pending) setDecision(null)
  }

  function submit() {
    if (!decision || validateDecisionNote(note)) return
    const current = decision
    const action = current === "approve" ? approveFlaggedLoadAction : rejectFlaggedLoadAction
    run(
      async () => {
        const result = await action({ loadId, note: note.trim() })
        return { ...result, message: result.ok ? COPY[current].success : result.message }
      },
      (result) => {
        setDecision(null)
        toast.success(result.message ?? COPY[current].success)
        router.refresh()
      },
    )
  }

  const copy = decision ? COPY[decision] : null

  return (
    <>
      <div className="flex flex-wrap justify-end gap-2">
        <Button type="button" size="sm" variant="secondary" className="min-h-11 md:min-h-8" onClick={() => open("approve")} aria-label={`Aprobar carga de ${label}`}>
          Aprobar
        </Button>
        <Button type="button" size="sm" variant="destructive" className="min-h-11 md:min-h-8" onClick={() => open("reject")} aria-label={`Rechazar carga de ${label}`}>
          Rechazar
        </Button>
      </div>
      <Dialog open={decision !== null} onOpenChange={(next) => { if (!next) close() }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{copy?.title}</DialogTitle>
            <DialogDescription>{label}. {copy?.description}</DialogDescription>
          </DialogHeader>
          <Field
            label="Nota de la decisión"
            htmlFor={noteId}
            required
            helper={`Mínimo ${MIN_DECISION_NOTE_LENGTH} caracteres. Explica por qué la carga es correcta o por qué se descarta.`}
            error={noteError ?? undefined}
          >
            <Textarea
              id={noteId}
              value={note}
              onChange={(event) => setNote(event.target.value)}
              rows={3}
              maxLength={MAX_DECISION_NOTE_LENGTH}
              error={Boolean(noteError)}
            />
          </Field>
          {message ? <p role="alert" className="mt-2 text-sm text-[var(--color-danger-ink)]">{message}</p> : null}
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={close} disabled={pending}>Volver</Button>
            <Button
              type="button"
              variant={decision === "reject" ? "destructive" : "primary"}
              onClick={submit}
              loading={pending}
              disabled={pending || validateDecisionNote(note) !== null}
            >
              {copy?.confirm}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
