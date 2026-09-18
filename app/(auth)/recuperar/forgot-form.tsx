"use client"

import * as React from "react"
import Link from "next/link"
import { useActionState } from "react"
import { WarningCircle, CheckCircle } from "@phosphor-icons/react"
import { Callout } from "@/components/ui/callout"
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
        {isPending ? "Enviando..." : "Enviar instrucciones"}
      </Button>
    </form>
  )
}
