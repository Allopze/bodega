"use client"

import * as React from "react"
import { Button } from "@/components/ui/button"
import { Callout } from "@/components/ui/callout"
import { DialogFooter } from "@/components/ui/dialog"
import { Field } from "@/components/ui/field"
import { Textarea } from "@/components/ui/textarea"
import { useOperation } from "@/lib/hooks/use-operation"
import { REASON_MIN_LENGTH } from "@/lib/validation/reason-thresholds"

/* ── Piezas comunes de los diálogos ───────────────────────────────────────── */

/**
 * Estado de un diálogo con formulario: abierto, la operación en curso y un
 * mensaje limpio cada vez que se abre. El error de un intento anterior no debe
 * esperar a quien vuelve a abrir el diálogo, que sigue montado.
 */
export function useFormDialog(onOpen?: () => void) {
  const [open, setOpen] = React.useState(false)
  const operation = useOperation()
  const changeOpen = (next: boolean) => {
    operation.setMessage("")
    if (next) onOpen?.()
    setOpen(next)
  }
  return { open, changeOpen, operation }
}

type OperationMessage = Pick<ReturnType<typeof useOperation>, "message" | "messageTone">

/** El error de una operación, dentro del diálogo y anunciado como alerta. */
export function OperationError({ operation }: { operation: OperationMessage }) {
  if (operation.messageTone !== "error" || !operation.message) return null
  return <Callout tone="danger" role="alert">{operation.message}</Callout>
}

/** El error de una acción que no vive en un diálogo (un botón de la fila, una casilla). */
export function InlineError({ operation, className }: { operation: OperationMessage; className?: string }) {
  if (operation.messageTone !== "error" || !operation.message) return null
  return <p role="alert" className={`text-xs text-[var(--color-danger-ink)] ${className ?? ""}`}>{operation.message}</p>
}

/** «Cancelar» siempre en el pie, y el botón de confirmar con su estado de carga. */
export function FormDialogFooter({ submitLabel, pending, disabled, variant, onCancel, className }: {
  submitLabel: string
  pending: boolean
  disabled?: boolean
  variant?: "primary" | "destructive"
  onCancel: () => void
  className?: string
}) {
  return (
    <DialogFooter className={className}>
      <Button type="button" variant="secondary" onClick={onCancel} disabled={pending}>Cancelar</Button>
      <Button type="submit" variant={variant} loading={pending} disabled={disabled}>{submitLabel}</Button>
    </DialogFooter>
  )
}

/**
 * El motivo de un acto que queda en el historial: obligatorio y de al menos
 * `REASON_MIN_LENGTH` caracteres, el mismo mínimo del servidor. La pista sólo
 * suma el mínimo cuando lo escrito todavía no alcanza.
 */
export function ReasonField({ label = "Motivo", maxLength = 2000, error }: { label?: string; maxLength?: number; error?: string }) {
  const [length, setLength] = React.useState(0)
  const tooShort = length > 0 && length < REASON_MIN_LENGTH
  return (
    <Field label={label} required hint={tooShort ? `Queda en el historial. Mínimo ${REASON_MIN_LENGTH} caracteres.` : "Queda en el historial."} error={error}>
      <Textarea name="reason" required minLength={REASON_MIN_LENGTH} maxLength={maxLength} onChange={(event) => setLength(event.target.value.trim().length)} />
    </Field>
  )
}
