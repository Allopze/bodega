"use client"

import * as React from "react"
import { Prohibit } from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { useOperation } from "@/lib/hooks/use-operation"
import { revokePpaTokenAction } from "../actions"

export function RevokeTokenButton({ ppaId, revoked }: { ppaId: string; revoked: boolean }) {
  const [open, setOpen] = React.useState(false)
  // Invocación imperativa desde un diálogo de confirmación, no un `<form action>`:
  // corresponde `useOperation`. Antes usaba `useActionState` con el resultado
  // descartado (`const [, action]`), así que un fallo al revocar era silencioso.
  const { pending, message, run } = useOperation()

  if (revoked) {
    return (
      <p className="mt-3 inline-flex items-center gap-1.5 rounded-md border border-[var(--color-warning)] bg-[var(--color-warning-tint)] px-3 py-1.5 text-xs text-[var(--color-warning-ink)]">
        <Prohibit size={14} /> Enlace público revocado
      </p>
    )
  }

  function handleConfirm() {
    const formData = new FormData()
    formData.set("id", ppaId)
    run(
      () => revokePpaTokenAction({ ok: false, message: "" }, formData),
      () => setOpen(false),
    )
  }

  return (
    <>
      <Button variant="destructive" size="sm" className="mt-2" onClick={() => setOpen(true)} disabled={pending}>
        <Prohibit size={14} className="mr-1" />
        Revocar acceso público
      </Button>

      {message && (
        <p className="mt-2 text-xs text-[var(--color-text-muted)]" role="status">{message}</p>
      )}

      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title="¿Revocar acceso público?"
        description="El enlace compartido o QR dejará de mostrar el resultado. El caso permanece registrado internamente."
        confirmLabel="Sí, revocar acceso"
        variant="destructive"
        loading={pending}
        onConfirm={handleConfirm}
      />
    </>
  )
}
