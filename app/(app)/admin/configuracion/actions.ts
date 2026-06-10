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
