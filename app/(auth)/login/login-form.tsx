"use client"

import * as React from "react"
import { signIn } from "next-auth/react"
import { useRouter, useSearchParams } from "next/navigation"
import { Field, FieldGroup } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"

export function LoginForm() {
  const router       = useRouter()
  const searchParams = useSearchParams()
  const callbackUrl  = searchParams.get("callbackUrl") ?? "/dashboard"

  const [error,   setError]   = React.useState<string | null>(null)
  const [loading, setLoading] = React.useState(false)

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    setLoading(true)

    const formData = new FormData(e.currentTarget)
    const email    = String(formData.get("email") ?? "").trim().toLowerCase()
    const password = String(formData.get("password") ?? "").trim()

    const result = await signIn("credentials", {
      email,
      password,
      redirect: false,
    })

    setLoading(false)

    if (result?.error) {
      setError("Correo o contraseña incorrectos. Intenta nuevamente.")
      return
    }

    router.push(callbackUrl)
    router.refresh()
  }

  return (
    <form onSubmit={handleSubmit} noValidate>
      <FieldGroup>
        <Field label="Correo electrónico" htmlFor="email" required>
          <Input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            autoFocus
            required
            placeholder="nombre@chome.cl"
            error={!!error}
          />
        </Field>
        <Field label="Contraseña" htmlFor="password" required>
          <Input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
            placeholder="••••••••"
            error={!!error}
          />
        </Field>
      </FieldGroup>

      {error && (
        <p className="mt-3 text-sm text-[var(--color-danger)]" role="alert">
          {error}
        </p>
      )}

      <Button
        type="submit"
        className="w-full mt-5"
        size="lg"
        loading={loading}
      >
        Ingresar
      </Button>

      <p className="mt-4 text-center text-xs text-[var(--color-text-subtle)]">
        Sistema de uso interno. Si no tienes acceso, contacta al administrador.
      </p>
    </form>
  )
}
