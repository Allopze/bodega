"use client"

import * as React from "react"
import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { Eye, EyeSlash, Info, WarningCircle } from "@phosphor-icons/react"
import { Callout } from "@/components/ui/callout"
import { Field, FieldGroup, Label } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { useLogin, loginErrorKind, GENERIC_LOGIN_ERROR } from "@/lib/hooks/use-login"

const CONTROL_CLASS = "h-12 sm:h-12 px-3.5 text-base sm:text-base"

export function LoginForm() {
  const searchParams = useSearchParams()
  const callbackUrl = searchParams.get("callbackUrl")
  const login = useLogin()
  const [error, setError] = React.useState<string | null>(null)
  const [showPassword, setShowPassword] = React.useState(false)
  const [capsLock, setCapsLock] = React.useState(false)

  const showCallbackInfo = callbackUrl && callbackUrl !== "/" && callbackUrl !== "/dashboard"

  // El estado vive aquí (cliente); el <aside> del hero es hermano servidor.
  // En vez de un Context o de mutar `document.documentElement`, se publica en
  // el propio <form> y el grid lo lee con `:has()` (ver globals.css). `login.data?.ok`,
  // no `login.isSuccess`: `mutationFn` no lanza en credenciales inválidas, así
  // que `isSuccess` es `true` tanto en éxito como en error.
  const authState = login.isPending
    ? "pending"
    : error
      ? "error"
      : login.data?.ok
        ? "success"
        : "idle"

  const errorKind = error ? loginErrorKind(error) : null
  const fieldInvalid = errorKind === "credentials"

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)

    const formData = new FormData(e.currentTarget)
    const email    = String(formData.get("email") ?? "").trim().toLowerCase()
    const password = String(formData.get("password") ?? "").trim()

    // `mutateAsync` sí lanza cuando `signIn` falla por red (no cuando las
    // credenciales son inválidas: eso vuelve como `{ ok: false }`). Sin este
    // catch la promesa quedaba sin capturar y el formulario se quedaba mudo,
    // en "idle", como si el clic no hubiera ocurrido.
    try {
      const result = await login.mutateAsync({ email, password })
      if (!result.ok && result.error) {
        setError(result.error)
      }
    } catch {
      setError(GENERIC_LOGIN_ERROR)
    }
  }

  function clearError() {
    if (error) setError(null)
  }

  return (
    <form onSubmit={handleSubmit} noValidate data-auth-state={authState}>
      {showCallbackInfo && (
        <Callout
          tone="info"
          role="status"
          icon={<Info size={16} weight="fill" />}
          className="mb-4 animate-in fade-in duration-150"
        >
          Para ver esa página primero inicia sesión.
        </Callout>
      )}

      <FieldGroup>
        <Field label="Correo electrónico" htmlFor="email">
          <Input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            autoFocus
            required
            placeholder="nombre@chome.cl"
            className={CONTROL_CLASS}
            error={fieldInvalid}
            onChange={clearError}
          />
        </Field>

        {/* Fila propia (no `Field`): necesita el link "¿La olvidaste?" en la
            misma línea que el label, algo que `Field.label` (tipado `string`)
            no soporta. Reusa `Label` para mantener el mismo contrato visual y
            de accesibilidad que el resto de campos del sistema. */}
        <div className="flex flex-col gap-0">
          <div className="mb-1.5 flex items-center justify-between">
            <Label htmlFor="password" className="mb-0">Contraseña</Label>
            <Link href="/recuperar" className="text-xs text-[var(--color-primary-ink)] hover:underline">
              ¿La olvidaste?
            </Link>
          </div>
          <div className="relative">
            <Input
              id="password"
              name="password"
              type={showPassword ? "text" : "password"}
              autoComplete="current-password"
              required
              className={`${CONTROL_CLASS} pr-11`}
              error={fieldInvalid}
              aria-describedby={fieldInvalid ? "password-error" : capsLock ? "password-capslock" : undefined}
              onChange={clearError}
              onKeyUp={(e) => setCapsLock(e.getModifierState("CapsLock"))}
            />
            {/* Se nombra por lo que hace al campo y no "Mostrar contraseña":
                ese rótulo contenía "Contraseña" y, como `getByLabel` busca por
                subcadena, hacía que `getByLabel("Contraseña")` resolviera dos
                nodos — strict mode, y con él los ~99 specs que entran por
                `e2e/helpers.ts`. El helper ya usa `exact: true`, así que la
                colisión está cubierta por los dos lados; este rótulo mantiene
                el margen para cualquier consumidor que aún busque en modo laxo.
                Sin `aria-pressed` a propósito: cuando el rótulo ya describe la
                acción, la guía de ARIA (APG) pide no duplicar el estado. */}
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              aria-label={showPassword ? "Ocultar texto" : "Mostrar texto"}
              className="absolute inset-y-0 right-0 flex w-11 items-center justify-center text-[var(--color-text-subtle)] hover:text-[var(--color-text)]"
            >
              {showPassword ? <EyeSlash size={18} /> : <Eye size={18} />}
            </button>
          </div>
          {fieldInvalid ? (
            <p id="password-error" role="alert" className="mt-1.5 text-xs text-[var(--color-danger)] leading-tight">
              {error}
            </p>
          ) : capsLock ? (
            <p id="password-capslock" className="mt-1.5 text-xs text-[var(--color-text-subtle)] leading-tight">
              Bloq Mayús está activado.
            </p>
          ) : null}
        </div>
      </FieldGroup>

      {error && !fieldInvalid && (
        <Callout
          tone="danger"
          role="alert"
          icon={<WarningCircle size={16} weight="fill" />}
          className="mt-3 animate-in fade-in duration-150"
        >
          {error}
        </Callout>
      )}

      <Button
        type="submit"
        className="w-full mt-5 h-12 sm:h-12 text-base"
        size="lg"
        loading={login.isPending}
      >
        {login.isPending ? "Ingresando..." : "Ingresar"}
      </Button>
    </form>
  )
}
