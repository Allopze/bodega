"use client"

import { useActionState, useEffect } from "react"
import { toast } from "@/lib/toast"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { changePasswordAction } from "./actions"

const INITIAL = { ok: false as boolean, message: undefined as string | undefined, fieldErrors: undefined as Record<string, string[]> | undefined }

export function PasswordChangeForm() {
  const [state, formAction, isPending] = useActionState(changePasswordAction, INITIAL)

  useEffect(() => {
    if (state.message) {
      if (state.ok) toast.success(state.message)
      else toast.error(state.message)
    }
  }, [state])

  return (
    <form action={formAction} className="space-y-4">
      <div className="flex flex-col gap-1.5">
        <label htmlFor="currentPassword" className="text-xs font-medium text-[var(--color-text-subtle)]">
          Contraseña actual
        </label>
        <Input
          id="currentPassword"
          name="currentPassword"
          type="password"
          autoComplete="current-password"
          required
        />
        {state.fieldErrors?.currentPassword && (
          <p className="text-xs text-[var(--color-signal-ink)]">{state.fieldErrors.currentPassword[0]}</p>
        )}
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="newPassword" className="text-xs font-medium text-[var(--color-text-subtle)]">
          Nueva contraseña
        </label>
        <Input
          id="newPassword"
          name="newPassword"
          type="password"
          autoComplete="new-password"
          required
          minLength={8}
        />
        {state.fieldErrors?.newPassword && (
          <p className="text-xs text-[var(--color-signal-ink)]">{state.fieldErrors.newPassword[0]}</p>
        )}
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="confirmPassword" className="text-xs font-medium text-[var(--color-text-subtle)]">
          Confirmar contraseña
        </label>
        <Input
          id="confirmPassword"
          name="confirmPassword"
          type="password"
          autoComplete="new-password"
          required
          minLength={8}
        />
        {state.fieldErrors?.confirmPassword && (
          <p className="text-xs text-[var(--color-signal-ink)]">{state.fieldErrors.confirmPassword[0]}</p>
        )}
      </div>

      <div className="flex justify-end">
        <Button type="submit" variant="secondary" size="sm" loading={isPending}>
          Cambiar contraseña
        </Button>
      </div>
    </form>
  )
}
