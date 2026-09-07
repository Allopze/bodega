"use client"

import * as React from "react"
import { useActionState } from "react"
import { useRouter } from "next/navigation"
import { ArrowUUpLeft, Warning } from "@phosphor-icons/react"
import { toast } from "@/lib/toast"
import { INITIAL_STATE } from "@/lib/form-state"
import { Button } from "@/components/ui/button"
import { Field } from "@/components/ui/field"
import { Textarea } from "@/components/ui/textarea"
import { SubmitButton } from "@/components/ui/submit-button"
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog"
import type { ActionState } from "@/lib/validation/masters"
import { reverseRetirementAction } from "./actions"

/**
 * Revierte una baja equivocada. Igual que anular una entrega o una
 * mantención, el motivo es obligatorio y del mismo mínimo que exige el CHECK
 * de BD — pero acá además hay una regla de consistencia completa
 * (`retirementReverseBlocker`) que ya decidió que este botón puede mostrarse.
 */
export function ReverseRetirementDialog({
  retirementId,
  assetCode,
  date,
  reasonLabel,
  restoresToLabel,
  reopensAssignment,
}: {
  retirementId: string
  assetCode: string
  date: string
  reasonLabel: string
  restoresToLabel: string
  reopensAssignment: boolean
}) {
  const router = useRouter()
  const [open, setOpen] = React.useState(false)
  const [state, action] = useActionState<ActionState, FormData>(reverseRetirementAction, INITIAL_STATE)

  React.useEffect(() => {
    if (state.ok && state.message) {
      toast.success(state.message)
      setOpen(false)
      router.refresh()
    } else if (state.ok === false && state.message && state !== INITIAL_STATE) {
      toast.error(state.message)
    }
  }, [router, state])

  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        className="gap-1"
        onClick={() => setOpen(true)}
        aria-label={`Revertir baja de ${assetCode}`}
      >
        <ArrowUUpLeft size={12} aria-hidden />
        Revertir
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Revertir baja de {assetCode}</DialogTitle>
            <DialogDescription>
              La baja no se borra: queda marcada como revertida, con responsable y motivo.
              El activo vuelve a <span className="font-medium text-[var(--color-text)]">{restoresToLabel}</span>.
              {reopensAssignment && " Se reabre la asignación que esta baja cerró: el equipo vuelve a estar en custodia de su trabajador."}
            </DialogDescription>
          </DialogHeader>

          <form action={action} className="flex flex-col gap-4">
            <input type="hidden" name="retirementId" value={retirementId} />

            <p className="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface-2)] px-3 py-2 text-sm text-[var(--color-text-muted)]">
              Baja del <span className="font-medium text-[var(--color-text)]">{date}</span> por {reasonLabel}
            </p>

            <Field
              label="Motivo"
              htmlFor="reverseRetirementReason"
              required
              helper="Mínimo 10 caracteres. Queda en la línea de tiempo del activo."
              error={state.fieldErrors?.reason?.[0]}
            >
              <Textarea
                id="reverseRetirementReason"
                name="reason"
                rows={3}
                placeholder="Ej: se dio de baja el TI-NB-0042 por error; el equipo perdido era el TI-NB-0043"
                error={!!state.fieldErrors?.reason}
              />
            </Field>

            {state.ok === false && state.message && state !== INITIAL_STATE && (
              <p className="flex items-center gap-1.5 text-sm text-[var(--color-danger)]">
                <Warning size={15} /> {state.message}
              </p>
            )}

            <div className="flex justify-end gap-2 border-t border-[var(--color-border)] pt-4">
              <Button type="button" variant="secondary" onClick={() => setOpen(false)}>Cancelar</Button>
              <SubmitButton label="Revertir baja" loadingLabel="Revirtiendo…" variant="destructive" />
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}
