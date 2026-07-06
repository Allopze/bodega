"use client"

import { useState } from "react"
import { toast } from "@/lib/toast"
import { Check, Copy, Envelope } from "@phosphor-icons/react"
import { SheetHeader, SheetBody, SheetFooter, SheetTitle, SheetDescription, SheetCloseButton } from "@/components/admin/sheet"
import { Button } from "@/components/ui/button"
import type { PendingInvite } from "./user-invite-form.types"

interface PendingInvitePanelProps {
  pending: PendingInvite
  onCreateAnother: () => void
  onClose: () => void
}

export function PendingInvitePanel({ pending, onCreateAnother, onClose }: PendingInvitePanelProps) {
  const [copied, setCopied] = useState(false)

  async function copyInvite() {
    try {
      await navigator.clipboard.writeText(pending.inviteUrl)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      toast.error("No se pudo copiar al portapapeles")
    }
  }

  return (
    <>
      <SheetHeader>
        <div>
          <SheetTitle>Invitación pendiente</SheetTitle>
          <SheetDescription>
            SMTP no está configurado. Comparte este enlace con {pending.email || "el destinatario"} por un canal seguro.
          </SheetDescription>
        </div>
        <SheetCloseButton onClick={() => { onCreateAnother(); onClose() }} />
      </SheetHeader>

      <SheetBody>
        <div
          role="status"
          aria-live="polite"
          className="rounded-(--radius) border border-(--color-warning-line) bg-(--color-warning-tint) p-4"
        >
          <div className="flex items-start gap-2">
            <Envelope size={16} weight="bold" className="mt-0.5 text-(--color-warning)" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-(--color-text)">
                Enlace de registro
              </p>
              <p className="mt-1 text-xs text-(--color-text-muted)">
                Caduca automáticamente. No lo pegues en canales públicos.
              </p>
              <div className="mt-3 flex items-stretch gap-2">
                <code className="flex-1 break-all rounded-(--radius-sm) border border-(--color-border) bg-surface px-2 py-1.5 text-xs font-mono text-(--color-text)">
                  {pending.inviteUrl}
                </code>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={copyInvite}
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
          onClick={() => { onCreateAnother() }}
        >
          Crear otra invitación
        </Button>
        <Button
          type="button"
          variant="secondary"
          onClick={onClose}
        >
          Cerrar
        </Button>
      </SheetFooter>
    </>
  )
}
