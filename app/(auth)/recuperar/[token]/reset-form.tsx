"use client"

import * as React from "react"
import Link from "next/link"
import { useActionState } from "react"
import { WarningCircle, CheckCircle } from "@phosphor-icons/react"
import { Callout } from "@/components/ui/callout"
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
        <Callout
          tone="danger"
          role="alert"
          icon={<WarningCircle size={16} weight="fill" />}
          className="mt-3 animate-in fade-in duration-150"
        >
          {state.message}
        </Callout>
      )}

      <Button
        type="submit"
        className="w-full mt-5"
        size="lg"
        loading={isPending}
      >
        {isPending ? "Guardando..." : "Establecer nueva contraseña"}
      </Button>
    </form>
  )
}
