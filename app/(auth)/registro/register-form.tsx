"use client"

import * as React from "react"
import Link from "next/link"
import { useActionState } from "react"
import { CheckCircle } from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"
import { Field, FieldGroup } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { INITIAL_STATE, type ActionState } from "@/components/admin/form-state"
import { registerUser } from "./actions"

interface RegisterFormProps {
  token: string
  mode: "bootstrap" | "invite"
  initialName?: string
  initialEmail?: string
  inviteError?: string
}

export function RegisterForm({ token, mode, initialName, initialEmail, inviteError }: RegisterFormProps) {
  const [state, formAction] = useActionState<ActionState, FormData>(registerUser, INITIAL_STATE)
  const isSuccess = state.ok
  const tokenError = state.fieldErrors?.token?.[0] ?? inviteError
  const disabledByInvite = mode === "invite" && !!inviteError

  if (isSuccess) {
    return (
      <div className="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
        <div className="flex items-start gap-3">
          <CheckCircle size={22} weight="fill" className="mt-0.5 shrink-0 text-[var(--color-primary)]" />
          <div>
            <h1 className="font-display text-lg font-semibold text-[var(--color-text)]">Cuenta creada</h1>
            <p className="mt-1 text-sm text-[var(--color-text-muted)]">
              {state.message ?? "Ya puedes iniciar sesión con tus credenciales."}
            </p>
            <Button asChild className="mt-4" size="sm">
              <Link href="/login">Ir al inicio de sesión</Link>
            </Button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <form action={formAction} noValidate>
      <input type="hidden" name="token" value={token} />

      {tokenError && (
        <p className="mb-4 rounded-[var(--radius)] border border-[var(--color-danger-100)] bg-[var(--color-danger-50)] px-3 py-2 text-sm text-[var(--color-danger)]">
          {tokenError}
        </p>
      )}

      <FieldGroup>
        <Field label="Nombre completo" htmlFor="name" required error={state.fieldErrors?.name?.[0]}>
          <Input
            id="name"
            name="name"
            defaultValue={initialName ?? ""}
            autoComplete="name"
            required
            placeholder="Nombre Apellido"
            error={!!state.fieldErrors?.name}
            disabled={disabledByInvite}
          />
        </Field>

        <Field label="Correo electrónico" htmlFor="email" required error={state.fieldErrors?.email?.[0]}>
          <Input
            id="email"
            name="email"
            type="email"
            defaultValue={initialEmail ?? ""}
            autoComplete="email"
            required
            placeholder="nombre@chome.cl"
            error={!!state.fieldErrors?.email}
            disabled={disabledByInvite}
          />
        </Field>

        <Field label="Contraseña" htmlFor="password" required error={state.fieldErrors?.password?.[0]}>
          <Input
            id="password"
            name="password"
            type="password"
            autoComplete="new-password"
            required
            placeholder="Mínimo 8 caracteres"
            error={!!state.fieldErrors?.password}
            disabled={disabledByInvite}
          />
        </Field>

        <Field
          label="Confirmar contraseña"
          htmlFor="confirmPassword"
          required
          error={state.fieldErrors?.confirmPassword?.[0]}
        >
          <Input
            id="confirmPassword"
            name="confirmPassword"
            type="password"
            autoComplete="new-password"
            required
            placeholder="Repite tu contraseña"
            error={!!state.fieldErrors?.confirmPassword}
            disabled={disabledByInvite}
          />
        </Field>
      </FieldGroup>

      {state.message && !state.ok && !state.fieldErrors && (
        <p className="mt-3 text-sm text-[var(--color-danger)]" role="alert">
          {state.message}
        </p>
      )}

      <Button type="submit" className="mt-5 w-full" size="lg" disabled={disabledByInvite}>
        {mode === "bootstrap" ? "Crear administrador" : "Crear cuenta"}
      </Button>

      <p className="mt-4 text-center text-xs text-[var(--color-text-subtle)]">
        {mode === "bootstrap"
          ? "Esta cuenta recibirá el rol Administrador y podrá invitar al resto del equipo."
          : "La invitación define tus roles y accesos iniciales."}
      </p>
    </form>
  )
}
