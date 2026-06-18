"use client"

import { useActionState, useEffect } from "react"
import { toast } from "@/lib/toast"
import { Button } from "@/components/ui/button"
import { updateEmailNotifications } from "./actions"

const INITIAL = { ok: false as boolean, message: undefined as string | undefined }

export function EmailNotificationsForm({ enabled }: { enabled: boolean }) {
  const [state, formAction, isPending] = useActionState(updateEmailNotifications, INITIAL)

  useEffect(() => {
    if (state.message) {
      if (state.ok) toast.success(state.message)
      else toast.error(state.message)
    }
  }, [state])

  return (
    <form action={formAction} className="flex items-center justify-between gap-4">
      <div>
        <p className="text-sm font-medium text-[var(--color-text)]">Notificaciones por correo</p>
        <p className="mt-0.5 text-xs text-[var(--color-text-subtle)]">
          Recibe un correo cuando una solicitud cambie de estado.
        </p>
      </div>
      <div className="flex items-center gap-3 shrink-0">
        <span className="text-xs text-[var(--color-text-subtle)]">
          {enabled ? "Activadas" : "Desactivadas"}
        </span>
        <input type="hidden" name="emailNotifications" value={enabled ? "false" : "true"} />
        <Button type="submit" variant="secondary" size="sm" loading={isPending}>
          {enabled ? "Desactivar" : "Activar"}
        </Button>
      </div>
    </form>
  )
}
