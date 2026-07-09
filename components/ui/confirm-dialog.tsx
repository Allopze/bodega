"use client"

import * as React from "react"
import {
  Dialog, DialogContent, DialogHeader, DialogFooter,
  DialogTitle, DialogDescription,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"

interface ConfirmDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description: string
  confirmLabel?: string
  cancelLabel?: string
  variant?: "destructive" | "warning" | "default"
  onConfirm: () => void
  loading?: boolean
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
}: ConfirmDialogProps) {
  const config = variantConfig[variant]

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && (
            <DialogDescription>{description}</DialogDescription>
          )}
        </DialogHeader>
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
            onClick={onConfirm}
            loading={loading}
          >
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
})

export const ConfirmDialog = ConfirmDialogInner
