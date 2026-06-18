"use client"

import * as React from "react"
import Link from "next/link"
import { useActionState } from "react"
import { WarningCircle, CheckCircle } from "@phosphor-icons/react"
import { Field, FieldGroup } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { resetPasswordAction } from "./actions"

const initialState = { ok: false as boolean, message: undefined as string | undefined }

export function ResetPasswordForm({ token }: { token: string }) {
  const [state, formAction, isPending] = useActionState(resetPasswordAction, initialState)

  if (state.ok) {
    return (
      <div className="flex flex-col items-center gap-4 py-4">
        <CheckCircle size={40} weight="fill" className="text-success" />
        <p className="text-center text-sm text-text-subtle">{state.message}</p>
        <Link
          href="/login"
          className="mt-2 text-sm font-medium text-[var(--color-primary-ink)] hover:underline"
        >
          Ir al inicio de sesión
        </Link>
      </div>
    )
  }

  const fieldErrors = (state as { fieldErrors?: Record<string, string[]> }).fieldErrors ?? {}

  return (
    <form action={formAction} noValidate>
      <input type="hidden" name="token" value={token} />
      <FieldGroup>
        <Field
          label="Nueva contraseña"
          htmlFor="password"
          required
          error={fieldErrors["password"]?.[0]}
        >
          <Input
            id="password"
            name="password"
            type="password"
            autoComplete="new-password"
            autoFocus
            required
            placeholder="Mínimo 8 caracteres"
          />
        </Field>
        <Field
          label="Confirmar contraseña"
          htmlFor="confirmPassword"
          required
          error={fieldErrors["confirmPassword"]?.[0]}
        >
          <Input
            id="confirmPassword"
            name="confirmPassword"
            type="password"
            autoComplete="new-password"
            required
            placeholder="Repite la contraseña"
          />
        </Field>
      </FieldGroup>

      {state.message && !state.ok && (
        <div role="alert" className="mt-3 flex items-start gap-2 rounded-(--radius) bg-[var(--color-danger-tint)] border border-[var(--color-danger-line)] px-3 py-2.5 animate-in fade-in duration-150">
          <WarningCircle size={16} weight="fill" className="mt-0.5 shrink-0 text-danger" />
          <p className="text-sm text-[var(--color-danger-ink)]">{state.message}</p>
        </div>
      )}

      <Button
        type="submit"
        className="w-full mt-5"
        size="lg"
        loading={isPending}
      >
        {isPending ? "Guardando..." : "Establecer nueva contraseña"}
      </Button>

      <div className="mt-6 pt-5 border-t border-border text-center">
        <Link href="/login" className="text-xs text-text-subtle hover:text-text">
          ← Volver al inicio de sesión
        </Link>
      </div>
    </form>
  )
}
