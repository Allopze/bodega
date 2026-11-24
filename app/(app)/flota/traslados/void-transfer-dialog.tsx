"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Field } from "@/components/ui/field"
import { Textarea } from "@/components/ui/textarea"
import { useOperation } from "@/lib/hooks/use-operation"
import { isValidReason, REASON_MAX_LENGTH, REASON_MIN_LENGTH } from "@/lib/validation/reason-thresholds"
import { toast } from "@/lib/toast"
import { voidTransferAction } from "./actions"

/**
 * Anular un traslado: los equipos vuelven a su faena de origen y el traslado queda en el historial como
 * anulado, con el motivo. Sólo se ofrece mientras cada equipo sigue en la estadía que ese traslado abrió
 * (`voidable`); el servidor lo vuelve a comprobar. El motivo es obligatorio (mismo umbral que el resto de
 * las anulaciones de la plataforma).
 */
export function VoidTransferDialog({ transfer, open, onOpenChange }: {
  transfer: { id: string; folio: string }
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const router = useRouter()
  const [reason, setReason] = React.useState("")
  const [touched, setTouched] = React.useState(false)
  const { pending, message, run } = useOperation()
  const invalid = touched && !isValidReason(reason)

  function submit() {
    setTouched(true)
    if (!isValidReason(reason)) return
    run(
      () => voidTransferAction({ transferId: transfer.id, reason }),
      (result) => {
        toast.success(result.message ?? "Traslado anulado.")
        onOpenChange(false)
        router.refresh()
      },
    )
  }

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!pending) onOpenChange(next) }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Anular traslado {transfer.folio}</DialogTitle>
          <DialogDescription>
            Los equipos vuelven a la faena de la que salieron. El traslado queda anulado en el historial, con el motivo.
          </DialogDescription>
        </DialogHeader>
        <Field
          label="Motivo de la anulación" required htmlFor={`void-reason-${transfer.id}`}
          error={invalid ? `Explica la anulación en al menos ${REASON_MIN_LENGTH} caracteres.` : undefined}
        >
          <Textarea
            id={`void-reason-${transfer.id}`} rows={3} maxLength={REASON_MAX_LENGTH} value={reason}
            onChange={(event) => setReason(event.target.value)} onBlur={() => setTouched(true)}
          />
        </Field>
        {message && <p role="alert" className="text-sm text-[var(--color-danger-ink)]">{message}</p>}
        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={pending}>Cancelar</Button>
          <Button variant="destructive" onClick={submit} loading={pending}>Anular traslado</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
