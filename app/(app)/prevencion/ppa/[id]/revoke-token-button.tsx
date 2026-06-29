"use client"

import * as React from "react"
import { useActionState } from "react"
import { Prohibit } from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"
import {
  Dialog, DialogTrigger, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog"
import { revokePpaTokenAction } from "../actions"
import type { ActionState } from "@/lib/validation/ppa"

export function RevokeTokenButton({ ppaId, revoked }: { ppaId: string; revoked: boolean }) {
  const [open, setOpen] = React.useState(false)
  const [, action, pending] = useActionState<ActionState, FormData>(revokePpaTokenAction, { ok: false, message: "" })

  if (revoked) {
    return (
      <p className="mt-3 inline-flex items-center gap-1.5 rounded-md border border-[var(--color-warning)] bg-[var(--color-warning-tint)] px-3 py-1.5 text-xs text-[var(--color-warning-ink)]">
        <Prohibit size={14} /> Enlace público revocado
      </p>
    )
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="destructive" size="sm" className="mt-2">
          <Prohibit size={14} />
          Revocar acceso público
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>¿Revocar acceso público?</DialogTitle>
          <DialogDescription>
            El enlace compartido o QR dejará de mostrar el resultado. El caso
            permanece registrado internamente.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="secondary" size="sm" onClick={() => setOpen(false)}>Cancelar</Button>
          <form action={action}>
            <input type="hidden" name="id" value={ppaId} />
            <Button type="submit" variant="destructive" size="sm" disabled={pending}>
              {pending ? "Revocando..." : "Sí, revocar acceso"}
            </Button>
          </form>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
