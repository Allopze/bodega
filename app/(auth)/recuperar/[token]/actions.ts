"use server"

import { applyPasswordReset } from "@/lib/services/password-reset"
import type { ActionState } from "@/lib/validation/masters"
import { z } from "zod"

const resetSchema = z
  .object({
    token:           z.string().min(1, "Token inválido"),
    password:        z.string().min(8, "La contraseña debe tener al menos 8 caracteres"),
    confirmPassword: z.string(),
  })
  .refine((d) => d.password === d.confirmPassword, {
    message: "Las contraseñas no coinciden",
    path: ["confirmPassword"],
  })

export async function resetPasswordAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const raw = {
    token:           formData.get("token"),
    password:        formData.get("password"),
    confirmPassword: formData.get("confirmPassword"),
  }

  const parsed = resetSchema.safeParse(raw)
  if (!parsed.success) {
    return { ok: false, fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]> }
  }

  const result = await applyPasswordReset(parsed.data.token, parsed.data.password)
  if (!result.ok) {
    return { ok: false, message: result.error ?? "No se pudo restablecer la contraseña." }
  }

  return { ok: true, message: "Contraseña actualizada. Ya puedes iniciar sesión." }
}
