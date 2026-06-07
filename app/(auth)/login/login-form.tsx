"use client"

import * as React from "react"
import Link from "next/link"
import { signIn } from "next-auth/react"
import { useRouter, useSearchParams } from "next/navigation"
import { WarningCircle } from "@phosphor-icons/react"
import { Field, FieldGroup } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"

export function LoginForm({ showBootstrap = false }: { showBootstrap?: boolean }) {
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
        <div role="alert" className="mt-3 flex items-start gap-2 rounded-(--radius) bg-danger-50 border border-danger-100 px-3 py-2.5 animate-in fade-in duration-150">
          <WarningCircle size={16} weight="fill" className="mt-0.5 shrink-0 text-danger" />
          <p className="text-sm text-danger-700">{error}</p>
        </div>
      )}

      <Button
        type="submit"
        className="w-full mt-5"
        size="lg"
        loading={loading}
      >
        Ingresar
      </Button>

      <div className="mt-6 pt-5 border-t border-border text-center text-xs text-text-subtle space-y-2">
        <p>Sistema de uso interno. Contacta al administrador si no tienes acceso.</p>
        {showBootstrap && (
          <p>
            Sin usuarios todavía.{" "}
            <Link href="/registro" className="text-primary-700 hover:underline">
              Crear primer administrador
            </Link>
          </p>
        )}
      </div>
    </form>
  )
}
