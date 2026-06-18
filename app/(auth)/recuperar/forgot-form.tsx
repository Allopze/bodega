"use client"

import * as React from "react"
import Link from "next/link"
import { useActionState } from "react"
import { WarningCircle, CheckCircle } from "@phosphor-icons/react"
import { Field, FieldGroup } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { forgotPasswordAction } from "./actions"

const initialState = { ok: false as boolean, message: undefined as string | undefined }

export function ForgotPasswordForm() {
  const [state, formAction, isPending] = useActionState(forgotPasswordAction, initialState)

  if (state.ok) {
    return (
      <div className="flex flex-col items-center gap-4 py-4">
        <CheckCircle size={40} weight="fill" className="text-success" />
        <p className="text-center text-sm text-text-subtle">{state.message}</p>
        <Link
          href="/login"
          className="mt-2 text-sm text-[var(--color-primary-ink)] hover:underline"
        >
          Volver al inicio de sesión
        </Link>
      </div>
    )
  }

  return (
    <form action={formAction} noValidate>
      <FieldGroup>
        <Field
          label="Correo electrónico"
          htmlFor="email"
          required
          helper="Ingresa el correo asociado a tu cuenta."
        >
          <Input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            autoFocus
            required
            placeholder="nombre@chome.cl"
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
        {isPending ? "Enviando..." : "Enviar instrucciones"}
      </Button>

      <div className="mt-6 pt-5 border-t border-border text-center">
        <Link
          href="/login"
          className="text-xs text-text-subtle hover:text-text"
        >
          ← Volver al inicio de sesión
        </Link>
      </div>
    </form>
  )
}
