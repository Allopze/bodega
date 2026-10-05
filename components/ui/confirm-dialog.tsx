"use client"

import * as React from "react"
import {
  Dialog, DialogContent, DialogHeader, DialogFooter,
  DialogTitle, DialogDescription,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { isValidReason, REASON_MAX_LENGTH, REASON_MIN_LENGTH } from "@/lib/validation/reason-thresholds"

interface ConfirmDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description: string
  confirmLabel?: string
  cancelLabel?: string
  variant?: "destructive" | "warning" | "default"
  /**
   * Recibe el motivo escrito cuando el diálogo lo pide; vacío cuando no.
   */
  onConfirm: (reason: string) => void
  loading?: boolean
  /**
   * Patrones P5 y P6 de la auditoría 2026-09-14: un acto irreversible se
   * explica. Cuando se pasa una etiqueta, el diálogo muestra el campo y no deja
   * confirmar hasta que el motivo alcanza el umbral único del repositorio
   * (`lib/validation/reason-thresholds.ts`).
   */
  reasonLabel?: string
  reasonPlaceholder?: string
  /**
   * Motivo por el que la acción falló. Se muestra dentro del diálogo, que
   * sigue abierto, como `role="alert"`: el resultado no se pierde en un toast
   * que desaparece mientras la persona decide qué hacer.
   */
  error?: string
  /**
   * A dónde vuelve el foco al cerrar. Abierto desde un ítem de menú, Radix lo
   * devolvía al ítem —que ya no existe— y caía al `body`; el disparador del
   * menú es el lugar natural.
   */
  returnFocusRef?: React.RefObject<HTMLElement | null>
}

const variantConfig = {
  destructive: { buttonVariant: "destructive" as const, icon: "⚠️" },
  warning:     { buttonVariant: "signal" as const,     icon: "⚠️" },
  default:     { buttonVariant: "primary" as const,    icon: undefined },
}

/**
 * Reusable confirmation dialog for destructive or important actions.
 *
 * Replaces the ~6 inline confirmation dialogs scattered across pages.
 * Usage:
 *   <ConfirmDialog
 *     open={open}
 *     onOpenChange={setOpen}
 *     title="Cancelar solicitud"
 *     description="Esta acción no se puede deshacer."
 *     variant="destructive"
 *     onConfirm={handleCancel}
 *   />
 */
const ConfirmDialogInner = React.memo(function ConfirmDialogInner({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = "Confirmar",
  cancelLabel = "Cancelar",
  variant = "default",
  onConfirm,
  loading = false,
  reasonLabel,
  reasonPlaceholder,
  error,
  returnFocusRef,
}: ConfirmDialogProps) {
  const config = variantConfig[variant]
  const [reason, setReason] = React.useState("")

  // El campo se vacía al cerrar: reabrir no debe heredar el motivo de un acto
  // anterior, que es justo el modo de que alguien confirme algo con la
  // explicación equivocada.
  React.useEffect(() => { if (!open) setReason("") }, [open])

  const reasonOk = !reasonLabel || isValidReason(reason)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent onCloseAutoFocus={returnFocusRef ? (event) => { event.preventDefault(); returnFocusRef.current?.focus() } : undefined}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && (
            <DialogDescription>{description}</DialogDescription>
          )}
        </DialogHeader>
        {reasonLabel && (
          <div className="px-1 pb-2">
            <label htmlFor="confirm-reason" className="mb-1 block text-xs font-medium text-[var(--color-text-muted)]">
              {reasonLabel}
            </label>
            <textarea
              id="confirm-reason"
              rows={3}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder={reasonPlaceholder}
              maxLength={REASON_MAX_LENGTH}
              className="w-full rounded-(--radius-md) border border-[var(--color-border)] bg-[var(--color-surface)] p-2 text-sm"
            />
            {!reasonOk && (
              <p className="mt-1 text-xs text-[var(--color-text-subtle)]">
                Mínimo {REASON_MIN_LENGTH} caracteres.
              </p>
            )}
          </div>
        )}
        {error && <p role="alert" className="px-1 pb-2 text-sm text-[var(--color-danger-ink)]">{error}</p>}
        <DialogFooter>
          <Button
            variant="secondary"
            onClick={() => onOpenChange(false)}
            disabled={loading}
          >
            {cancelLabel}
          </Button>
          <Button
            variant={config.buttonVariant}
            onClick={() => onConfirm(reason.trim())}
            loading={loading}
            disabled={!reasonOk}
          >
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
})

export const ConfirmDialog = ConfirmDialogInner
