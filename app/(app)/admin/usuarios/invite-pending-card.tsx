"use client"

import { Check, Copy, Envelope } from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"
import { SheetHeader, SheetBody, SheetFooter, SheetTitle, SheetDescription, SheetCloseButton } from "@/components/admin/sheet"
import type { PendingInvite } from "./user-form.helpers"

interface InvitePendingCardProps {
  pending: PendingInvite
  copied: boolean
  onCopy: () => void
  onDismiss: () => void
  onDismissAndClose: () => void
}

export function InvitePendingCard({ pending, copied, onCopy, onDismiss, onDismissAndClose }: InvitePendingCardProps) {
  return (
    <>
      <SheetHeader>
        <div>
          <SheetTitle>Invitación pendiente</SheetTitle>
          <SheetDescription>
            SMTP no está configurado. Comparte este enlace con {pending.email || "el usuario"} por un canal seguro.
          </SheetDescription>
        </div>
        <SheetCloseButton onClick={onDismissAndClose} />
      </SheetHeader>

      <SheetBody>
        <div
          role="status"
          aria-live="polite"
          className="rounded-[var(--radius)] border border-[var(--color-warning-line)] bg-[var(--color-warning-tint)] p-4"
        >
          <div className="flex items-start gap-2">
            <Envelope size={16} weight="bold" className="mt-0.5 text-[var(--color-warning)]" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-[var(--color-text)]">
                Enlace para crear contraseña
              </p>
              <p className="mt-1 text-xs text-[var(--color-text-muted)]">
                Caduca automáticamente. No lo pegues en canales públicos.
              </p>
              <div className="mt-3 flex items-stretch gap-2">
                <code className="flex-1 break-all rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1.5 text-xs font-mono text-[var(--color-text)]">
                  {pending.inviteUrl}
                </code>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={onCopy}
                  aria-label="Copiar enlace al portapapeles"
                >
                  {copied ? <Check size={14} /> : <Copy size={14} />}
                  {copied ? "Copiado" : "Copiar"}
                </Button>
              </div>
            </div>
          </div>
        </div>
      </SheetBody>

      <SheetFooter>
        <Button
          type="button"
          variant="primary"
          onClick={onDismiss}
        >
          Crear otro usuario
        </Button>
        <Button
          type="button"
          variant="secondary"
          onClick={onDismissAndClose}
        >
          Cerrar
        </Button>
      </SheetFooter>
    </>
  )
}
