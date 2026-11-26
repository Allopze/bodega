"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Field } from "@/components/ui/field"
import { Textarea } from "@/components/ui/textarea"
import { useOperation, type OperationResult } from "@/lib/hooks/use-operation"
import { toast } from "@/lib/toast"
import { NOTE_REASON_MAX, NOTE_REASON_MIN } from "./parts-notes-format"

/**
 * Diálogo de una acción que pide un motivo escrito (rechazar una línea, anular una nota, liberar una reserva,
 * conciliar «sin movimiento»): queda en el historial. Se monta sólo mientras está abierto, así el motivo no
 * sobrevive a la acción anterior. El error del servidor queda dentro, con lo escrito; el éxito avisa con un
 * toast, cierra y refresca la página. `extra` es un campo propio de la acción (p. ej. la cantidad a liberar).
 */
export function NoteReasonDialog({
  onOpenChange, title, description, label = "Motivo", submitLabel, destructive = false, extra, extraValid = true, action, successMessage,
}: {
  onOpenChange: (open: boolean) => void
  title: string
  description: string
  label?: string
  submitLabel: string
  destructive?: boolean
  extra?: React.ReactNode
  /** `false` mantiene deshabilitado el botón mientras el campo extra no sea válido. */
  extraValid?: boolean
  /** Llama a la acción de servidor con el motivo ya recortado. */
  action: (reason: string) => Promise<OperationResult>
  successMessage: string
}) {
  const router = useRouter()
  const op = useOperation()
  const [reason, setReason] = React.useState("")
  const trimmed = reason.trim()
  const valid = trimmed.length >= NOTE_REASON_MIN && trimmed.length <= NOTE_REASON_MAX

  function submit(event: React.FormEvent) {
    event.preventDefault()
    if (!valid || !extraValid) return
    op.run(
      () => action(trimmed),
      (result) => {
        toast.success(result.message ?? successMessage)
        onOpenChange(false)
        router.refresh()
      },
      (result) => {
        // Si otra persona resolvió la línea antes, la página se refresca para mostrar el estado vigente.
        if (/otra persona|otra sesi[oó]n|ya no/i.test(result.message ?? "")) router.refresh()
      },
    )
  }

  return (
    <Dialog open onOpenChange={(next) => { if (!op.pending) onOpenChange(next) }}>
      <DialogContent>
        <form onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>{description}</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-4">
            {extra}
            <Field label={label} htmlFor="np-reason" required helper={`Al menos ${NOTE_REASON_MIN} caracteres.`}>
              <Textarea id="np-reason" value={reason} rows={3} maxLength={NOTE_REASON_MAX} autoFocus onChange={(event) => setReason(event.target.value)} />
            </Field>
          </div>
          {op.message && <p role="alert" className="mt-2 text-sm text-[var(--color-danger-ink)]">{op.message}</p>}
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => onOpenChange(false)} disabled={op.pending}>Cancelar</Button>
            <Button type="submit" variant={destructive ? "destructive" : "primary"} loading={op.pending} disabled={!valid || !extraValid}>{submitLabel}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
