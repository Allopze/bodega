"use client"

import * as React from "react"
import { useActionState, useTransition } from "react"
import { Prohibit } from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { revokePpaTokenAction } from "../actions"
import type { ActionState } from "@/lib/validation/ppa"

export function RevokeTokenButton({ ppaId, revoked }: { ppaId: string; revoked: boolean }) {
  const [open, setOpen] = React.useState(false)
  const [, action] = useActionState<ActionState, FormData>(revokePpaTokenAction, { ok: false, message: "" })
  const [pending, startTransition] = useTransition()

  if (revoked) {
    return (
      <p className="mt-3 inline-flex items-center gap-1.5 rounded-md border border-[var(--color-warning)] bg-[var(--color-warning-tint)] px-3 py-1.5 text-xs text-[var(--color-warning-ink)]">
        <Prohibit size={14} /> Enlace público revocado
      </p>
    )
  }

  function handleConfirm() {
    const fd = new FormData()
    fd.set("id", ppaId)
    startTransition(() => {
      action(fd)
      setOpen(false)
    })
  }

  return (
    <>
      <Button variant="destructive" size="sm" className="mt-2" onClick={() => setOpen(true)} disabled={pending}>
        <Prohibit size={14} className="mr-1" />
        Revocar acceso público
      </Button>

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
