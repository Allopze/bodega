"use server"

import { revalidatePath } from "next/cache"
import { requirePermission } from "@/lib/auth/can"
import { setEmailsEnabled } from "@/lib/services/system-settings"
import { setSmtpConfig, testSmtpConnection } from "@/lib/services/smtp-settings"
import { z } from "zod"
import type { ActionState } from "@/lib/validation/masters"

export async function setEmailsEnabledAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  let session
  try {
    session = await requirePermission("admin:config")
  } catch {
    return { ok: false, message: "Sin permisos para configurar el sistema" }
  }

  const enabled = formData.get("emailsEnabled") === "on"

  try {
    await setEmailsEnabled(enabled, session.user.id, session.user.email ?? undefined)
  } catch {
    return { ok: false, message: "No se pudo actualizar la configuración" }
  }

  revalidatePath("/admin/correo-smtp")
  return { ok: true, message: enabled ? "Correos activados" : "Correos desactivados" }
}

// ── SMTP ─────────────────────────────────────────────────────────────────────

const fromAddressSchema = z
  .string()
  .trim()
  .min(1, "El remitente es requerido")
  .max(255, "Máximo 255 caracteres")
  .refine((value) => {
    const match = value.match(/<([^>]+)>\s*$/)
    const email = match?.[1]?.trim() ?? value
    return z.string().email().safeParse(email).success
  }, "Correo inválido. Usa un correo o el formato: Nombre <correo@dominio>")

const smtpSchema = z.object({
  smtpHost:   z.string().trim().min(1, "El host es requerido").max(255, "Máximo 255 caracteres"),
  smtpPort:   z.coerce.number().int("Debe ser un número entero").positive("Debe ser positivo").max(65535, "Puerto inválido"),
  smtpSecure: z.string().optional(),
  smtpUser:   z.string().trim().min(1, "El usuario es requerido").max(255, "Máximo 255 caracteres"),
  smtpPass:   z.string().trim().optional(),
  smtpFrom:   fromAddressSchema,
})

export async function updateSmtpConfigAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  let session
  try {
    session = await requirePermission("admin:config")
  } catch {
    return { ok: false, message: "Sin permisos para configurar el sistema" }
  }

  const raw = {
    smtpHost:   formData.get("smtpHost"),
    smtpPort:   formData.get("smtpPort"),
    smtpSecure: formData.get("smtpSecure"),
    smtpUser:   formData.get("smtpUser"),
    smtpPass:   formData.get("smtpPass") || undefined,
    smtpFrom:   formData.get("smtpFrom"),
  }

  const parsed = smtpSchema.safeParse(raw)
  if (!parsed.success) {
    return {
      ok: false,
      fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
    }
  }

  const { smtpHost, smtpPort, smtpSecure, smtpUser, smtpPass, smtpFrom } = parsed.data

  try {
    await setSmtpConfig(
      {
        host:   smtpHost,
        port:   smtpPort,
        secure: smtpSecure === "on" || smtpSecure === "true",
        user:   smtpUser,
        pass:   smtpPass ?? "",
        from:   smtpFrom,
      },
      session.user.id,
      session.user.email ?? undefined,
    )
  } catch {
    return { ok: false, message: "No se pudo guardar la configuración SMTP" }
  }

  revalidatePath("/admin/correo-smtp")
  return { ok: true, message: "Configuración SMTP guardada con éxito" }
}

export async function testSmtpAction(
  _prev: ActionState | null,
  formData: FormData,
): Promise<ActionState & { details?: string }> {
  let session
  try {
    session = await requirePermission("admin:config")
  } catch {
    return { ok: false, message: "Sin permisos" }
  }

  const to = session.user.email
  if (!to) {
    return { ok: false, message: "El usuario autenticado no tiene correo registrado" }
  }

  const raw = {
    smtpHost:   formData.get("smtpHost"),
    smtpPort:   formData.get("smtpPort"),
    smtpSecure: formData.get("smtpSecure"),
    smtpUser:   formData.get("smtpUser"),
    smtpPass:   formData.get("smtpPass") || undefined,
    smtpFrom:   formData.get("smtpFrom"),
  }

  const parsed = smtpSchema.safeParse(raw)
  if (!parsed.success) {
    return { ok: false, message: "Corrige los errores del formulario antes de probar" }
  }

  const { smtpHost, smtpPort, smtpSecure, smtpUser, smtpPass, smtpFrom } = parsed.data

  try {
    await setSmtpConfig(
      {
        host:   smtpHost,
        port:   smtpPort,
        secure: smtpSecure === "on" || smtpSecure === "true",
        user:   smtpUser,
        pass:   smtpPass ?? "",
        from:   smtpFrom,
      },
      session.user.id,
      session.user.email ?? undefined,
    )
  } catch {
    return { ok: false, message: "No se pudo guardar la config para la prueba" }
  }

  const result = await testSmtpConnection(to)
  if (result.ok) {
    return { ok: true, message: "Correo de prueba enviado correctamente" }
  }
  return { ok: false, message: result.error }
}
