"use client"

import { useMutation } from "@tanstack/react-query"
import { signIn } from "next-auth/react"
import { useRouter, useSearchParams } from "next/navigation"
import { safeInternalPath } from "@/lib/navigation"

interface LoginInput {
  email:    string
  password: string
}

interface LoginResult {
  ok:    boolean
  error?: string
}

// Mensajes textuales, en constantes propias: `hooks-use-login.test.tsx` asserta
// `LoginResult` por igualdad exacta (`toEqual`), así que un campo `kind` en el
// resultado rompería 4 de sus 5 casos. `loginErrorKind` deriva el tipo de error
// del texto del mensaje en vez de ampliar la forma del resultado — el mensaje
// no cambia, el test no se toca.
const IP_RATE_LIMITED_MESSAGE = "Demasiados intentos desde tu dirección. Espera 15 minutos antes de intentarlo de nuevo."
const EMAIL_RATE_LIMITED_MESSAGE = "Esta cuenta ha sido bloqueada temporalmente. Espera 15 minutos antes de intentarlo de nuevo."
const CREDENTIALS_MESSAGE = "Correo o contraseña incorrectos."

/** También lo usa el formulario cuando `signIn` lanza (red caída): el mismo texto para el mismo desenlace. */
export const GENERIC_LOGIN_ERROR = "No pudimos iniciar sesión. Intenta nuevamente."

function authErrorMessage(error: string) {
  // U-02: surface rate-limit reasons (custom codes from lib/auth/auth.ts)
  if (error === "ip_rate_limited") {
    return IP_RATE_LIMITED_MESSAGE
  }
  if (error === "email_rate_limited") {
    return EMAIL_RATE_LIMITED_MESSAGE
  }
  if (error === "CredentialsSignin") {
    return CREDENTIALS_MESSAGE
  }

  return GENERIC_LOGIN_ERROR
}

export type LoginErrorKind = "credentials" | "rate_limited" | "unknown"

/**
 * Clasifica el mensaje de `LoginResult.error` para que la UI pueda distinguir
 * "corrige el campo" (credentials) de "espera" (rate_limited) sin pintar los
 * inputs en rojo cuando no hay nada que el usuario deba corregir en ellos.
 */
export function loginErrorKind(message: string): LoginErrorKind {
  if (message === CREDENTIALS_MESSAGE) return "credentials"
  if (message === IP_RATE_LIMITED_MESSAGE || message === EMAIL_RATE_LIMITED_MESSAGE) return "rate_limited"
  return "unknown"
}

/**
 * Handles credentials login with React Query.
 * Returns `{ ok, error }` — callers show the error message directly.
 */
export function useLogin() {
  const router       = useRouter()
  const searchParams = useSearchParams()
  const callbackUrl  = safeInternalPath(searchParams.get("callbackUrl"))

  return useMutation({
    mutationFn: async ({ email, password }: LoginInput): Promise<LoginResult> => {
      const result = await signIn("credentials", {
        email,
        password,
        redirect: false,
      })

      if (result?.error) {
        return { ok: false, error: authErrorMessage(result.error) }
      }

      router.push(callbackUrl)
      router.refresh()
      return { ok: true }
    },
  })
}
