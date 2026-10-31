"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { CheckCircle } from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Field } from "@/components/ui/field"
import { Textarea } from "@/components/ui/textarea"
import { useOperation } from "@/lib/hooks/use-operation"
import { reviewTaeSubmissionAction } from "@/app/(app)/combustibles/tae/actions"

type TaeStatus = "submitted" | "observed" | "validated" | "voided"

const OBSERVATION_MIN = 4

/**
 * Validar, dejar con observación o anular un registro en terreno. Va en la
 * cabecera de la ficha.
 *
 * - **Validar** no pide motivo y no pide confirmación: es lo rutinario.
 * - **Con observación** pide la nota de lo que hay que corregir.
 * - **Anular** es lo único que no se deshace: pide motivo y confirmación.
 *
 * Los estados a los que se puede pasar son los de la máquina de estados del
 * servidor (`isTaeReviewTransitionAllowed`); aquí sólo se esconden los botones
 * que no corresponden.
 */
export function LoadReviewControls({ id, status }: { id: string; status: TaeStatus }) {
  const router = useRouter()
  const [observeOpen, setObserveOpen] = React.useState(false)
  const [voidOpen, setVoidOpen] = React.useState(false)
  const [note, setNote] = React.useState("")
  const validate = useOperation({ feedback: "toast", onSuccess: () => router.refresh() })
  const observe = useOperation({ onSuccess: () => router.refresh() })
  const voidOp = useOperation({ onSuccess: () => router.refresh() })

  if (status === "voided") return null

  function closeObserve(next: boolean) {
    setObserveOpen(next)
    if (!next) { setNote(""); observe.setMessage("") }
  }

  function submitObservation() {
    if (note.trim().length < OBSERVATION_MIN) { observe.setMessage(`Cuenta qué debe corregirse, en al menos ${OBSERVATION_MIN} caracteres.`, "error"); return }
    observe.run(
      () => reviewTaeSubmissionAction({ id, expectedStatus: status, status: "observed", reviewNote: note.trim() }),
      () => closeObserve(false),
    )
  }

  return (
    <>
      {status !== "validated" && (
        <Button
          type="button"
          variant="primary"
          size="sm"
          loading={validate.pending}
          onClick={() => validate.run(() => reviewTaeSubmissionAction({ id, expectedStatus: status, status: "validated" }))}
        >
          <CheckCircle size={14} aria-hidden />
          Validar
        </Button>
      )}
      {status !== "observed" && (
        <Button type="button" variant="secondary" size="sm" onClick={() => setObserveOpen(true)}>Con observación</Button>
      )}
      <Button type="button" variant="secondary" size="sm" onClick={() => setVoidOpen(true)}>Anular</Button>

      <Dialog open={observeOpen} onOpenChange={closeObserve}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Dejar la carga con observación</DialogTitle>
            <DialogDescription>
              La carga sigue contando, pero queda marcada hasta que se valide o se anule. Anota qué hay que corregir.
            </DialogDescription>
          </DialogHeader>
          <Field label="¿Qué hay que corregir?" required>
            <Textarea value={note} onChange={(event) => setNote(event.target.value)} rows={4} maxLength={1000} placeholder="Ej: falta la foto del sello retirado." />
          </Field>
          {observe.message && <p role="alert" className="mt-3 text-sm text-[var(--color-danger-ink)]">{observe.message}</p>}
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => closeObserve(false)} disabled={observe.pending}>Cancelar</Button>
            <Button type="button" variant="primary" onClick={submitObservation} loading={observe.pending} disabled={note.trim().length < OBSERVATION_MIN}>Dejar con observación</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={voidOpen}
        onOpenChange={(next) => { setVoidOpen(next); if (!next) voidOp.setMessage("") }}
        title="Anular la carga"
        description="Una carga anulada deja de sumar sus litros y no se puede volver a activar. Queda en el historial con tu motivo."
        confirmLabel="Anular carga"
        variant="destructive"
        reasonLabel="Motivo de la anulación"
        reasonPlaceholder="Ej: se cargó por error en otro equipo."
        loading={voidOp.pending}
        error={voidOp.message || undefined}
        onConfirm={(reason) => voidOp.run(
          () => reviewTaeSubmissionAction({ id, expectedStatus: status, status: "voided", reviewNote: reason }),
          () => setVoidOpen(false),
        )}
      />
    </>
  )
}
