"use server"

import { revalidatePath } from "next/cache"
import { requirePermission } from "@/lib/auth/can"
import { setCompanyProfile, setPdfMaxSizeMb } from "@/lib/services/system-settings"
import { z } from "zod"
import type { ActionState } from "@/lib/validation/masters"

const configSchema = z.object({
  pdfMaxSizeMb: z.coerce
    .number()
    .int("Debe ser un número entero")
    .positive("Debe ser un valor positivo")
    .max(500, "El límite máximo permitido es 500 MB"),
  companyName: z.string().trim().min(1, "Ingresa el nombre de la empresa").max(120, "Máximo 120 caracteres"),
  companyRut: z.string().trim().max(24, "Máximo 24 caracteres").optional(),
  companyBusinessActivity: z.string().trim().max(140, "Máximo 140 caracteres").optional(),
  companyAddress: z.string().trim().max(180, "Máximo 180 caracteres").optional(),
  companyBranchAddress: z.string().trim().max(180, "Máximo 180 caracteres").optional(),
  companyPhone: z.string().trim().max(40, "Máximo 40 caracteres").optional(),
  companyEmail: z
    .string()
    .trim()
    .max(120, "Máximo 120 caracteres")
    .optional()
    .refine((value) => !value || z.email().safeParse(value).success, "Correo inválido"),
  companyWebsite: z.string().trim().max(120, "Máximo 120 caracteres").optional(),
})

export async function updateSystemSettings(
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
    pdfMaxSizeMb:    formData.get("pdfMaxSizeMb"),
    companyName:     formData.get("companyName"),
    companyRut:      formData.get("companyRut")      || undefined,
    companyBusinessActivity: formData.get("companyBusinessActivity") || undefined,
    companyAddress:  formData.get("companyAddress")  || undefined,
    companyBranchAddress: formData.get("companyBranchAddress") || undefined,
    companyPhone:    formData.get("companyPhone")    || undefined,
    companyEmail:    formData.get("companyEmail")    || undefined,
    companyWebsite:  formData.get("companyWebsite")  || undefined,
  }

  const parsed = configSchema.safeParse(raw)
  if (!parsed.success) {
    return {
      ok: false,
      fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
    }
  }

  const {
    pdfMaxSizeMb,
    companyName,
    companyRut,
    companyBusinessActivity,
    companyAddress,
    companyBranchAddress,
    companyPhone,
    companyEmail,
    companyWebsite,
  } = parsed.data

  try {
    await Promise.all([
      setPdfMaxSizeMb(
        pdfMaxSizeMb,
        session.user.id,
        session.user.email ?? undefined,
      ),
      setCompanyProfile(
        {
          name:             companyName,
          rut:              companyRut              ?? "",
          businessActivity: companyBusinessActivity ?? "",
          address:          companyAddress          ?? "",
          branchAddress:    companyBranchAddress    ?? "",
          phone:            companyPhone            ?? "",
          email:            companyEmail            ?? "",
          website:          companyWebsite          ?? "",
        },
        session.user.id,
        session.user.email ?? undefined,
      ),
    ])
  } catch (_error) {
    return {
      ok: false,
      message: "No se pudo actualizar la configuración en la base de datos",
    }
  }

  revalidatePath("/admin/configuracion")
  return { ok: true, message: "Configuración actualizada con éxito" }
}

// ── SMTP Configuration ──────────────────────────────────────────────────────

import { setSmtpConfig, testSmtpConnection } from "@/lib/services/smtp-settings"

/**
 * El remitente (From) admite un correo simple (`correo@dominio`) o el
 * formato con nombre visible `Nombre <correo@dominio>` — este último es
 * el habitual y el que usan los proveedores como Brevo/SendGrid.
 */
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
  } catch (_error) {
    return {
      ok: false,
      message: "No se pudo guardar la configuración SMTP",
    }
  }

  revalidatePath("/admin/configuracion")
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

  // Optimistically update the SMTP config from the form data before testing
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

  // Save first so the test uses the latest config
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
