"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useActionState, useEffect } from "react"
import { CheckCircle } from "@phosphor-icons/react"
import { signIn } from "next-auth/react"
import { Button } from "@/components/ui/button"
import { Callout } from "@/components/ui/callout"
import { Field, FieldGroup } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { INITIAL_STATE, type ActionState } from "@/lib/form-state"
import { registerUser } from "./actions"

interface RegisterFormProps {
  token: string
  mode: "bootstrap" | "invite"
  initialName?: string
  initialEmail?: string
  inviteError?: string
  inviteNotice?: string
}

export function RegisterForm({ token, mode, initialName, initialEmail, inviteError, inviteNotice }: RegisterFormProps) {
  const router = useRouter()
  const [state, formAction] = useActionState<ActionState, FormData>(registerUser, INITIAL_STATE)
  const isSuccess = state.ok
  const tokenError = state.fieldErrors?.token?.[0] ?? inviteError
  const disabledByInvite = mode === "invite" && (!!inviteError || !!inviteNotice)

  // Credenciales capturadas antes del submit para auto-login
  const credentialsRef = React.useRef<{ email: string; password: string } | null>(null)

  // Auto-login después de registro exitoso
  useEffect(() => {
    if (!isSuccess || !credentialsRef.current) return
    const { email, password } = credentialsRef.current
    signIn("credentials", { email, password, redirect: false }).then((result) => {
      if (result?.ok) {
        router.push("/dashboard")
        router.refresh()
      }
    })
  }, [isSuccess, router])

  if (isSuccess) {
    return (
      <div className="flex flex-col items-center gap-4 py-4 text-center">
        <CheckCircle size={40} weight="fill" className="text-success" />
        <p className="text-sm text-text-subtle">Cuenta creada. Iniciando sesión automáticamente...</p>
        <Link href="/login" className="text-sm text-[var(--color-primary-ink)] hover:underline">
          Ir al inicio de sesión
        </Link>
      </div>
    )
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    const formData = new FormData(e.currentTarget)
    credentialsRef.current = {
      email: String(formData.get("email") ?? "").trim().toLowerCase(),
      password: String(formData.get("password") ?? ""),
    }
  }

  return (
    <form action={formAction} noValidate onSubmit={handleSubmit}>
      <input type="hidden" name="token" value={token} />

      {tokenError && (
        <Callout tone="danger" role="alert" className="mb-4">
          {tokenError}
        </Callout>
      )}
      {!tokenError && inviteNotice && (
        <Callout tone="info" role="status" className="mb-4">
          {inviteNotice}
        </Callout>
      )}

      <FieldGroup>
        <Field label="Nombre completo" htmlFor="name" error={state.fieldErrors?.name?.[0]}>
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

        <Field label="Correo electrónico" htmlFor="email" error={state.fieldErrors?.email?.[0]}>
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

        <Field label="Contraseña" htmlFor="password" error={state.fieldErrors?.password?.[0]}>
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
        <Callout tone="danger" role="alert" className="mt-3">
          {state.message}
        </Callout>
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
