"use server"

import { requestPasswordReset } from "@/lib/services/password-reset"
import type { ActionState } from "@/lib/validation/masters"
import { checkRateLimit, recordFailure } from "@/lib/services/rate-limit"
import { headers } from "next/headers"

export async function forgotPasswordAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase()
  if (!email || !email.includes("@")) {
    return { ok: false, fieldErrors: { email: ["Ingresa un correo válido"] } }
  }

  let clientIp = "127.0.0.1"
  try {
    const h = await headers()
    clientIp = h.get("x-forwarded-for")?.split(",")[0]?.trim() || "127.0.0.1"
  } catch { /* headers unavailable in test */ }

  const key = `recuperar:ip:${clientIp}`
  const limit = await checkRateLimit(key)
  if (!limit.allowed) {
    return {
      ok: false,
      message: `Demasiados intentos. Espera ${Math.ceil(limit.waitTimeRemainingMs / 60000)} minutos.`,
    }
  }

  // Always succeeds to prevent user enumeration
  await requestPasswordReset(email)
  await recordFailure(key) // count each request (not a "failure", just rate tracking)

  return {
    ok: true,
    message: "Si el correo existe en el sistema, recibirás las instrucciones en los próximos minutos.",
  }
}
