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

function authErrorMessage(error: string) {
  // U-02: surface rate-limit reasons (custom codes from lib/auth/auth.ts)
  if (error === "ip_rate_limited") {
    return "Demasiados intentos desde tu dirección. Espera 15 minutos antes de intentarlo de nuevo."
  }
  if (error === "email_rate_limited") {
    return "Esta cuenta ha sido bloqueada temporalmente. Espera 15 minutos antes de intentarlo de nuevo."
  }
  if (error === "CredentialsSignin") {
    return "Correo o contraseña incorrectos."
  }

  return "No pudimos iniciar sesión. Intenta nuevamente."
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
