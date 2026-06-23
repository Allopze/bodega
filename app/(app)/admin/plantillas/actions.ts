"use server"

import { revalidatePath } from "next/cache"
import { requirePermission } from "@/lib/auth/can"
import { updateTemplate, resetTemplate, seedDefaultTemplates } from "@/lib/services/email-templates"
import { z } from "zod"
import type { ActionState } from "@/lib/validation/masters"

const templateSchema = z.object({
  subject:  z.string().trim().min(1, "El asunto es requerido").max(255, "Máximo 255 caracteres"),
  bodyHtml: z.string().trim().min(1, "El HTML es requerido"),
})

export async function updateTemplateAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  let session
  try { session = await requirePermission("admin:email_templates") }
  catch { return { ok: false, message: "Sin permisos" } }

  const key = formData.get("key")?.toString()
  if (!key) return { ok: false, message: "Falta la clave de la plantilla" }

  const raw = {
    subject:  formData.get("subject"),
    bodyHtml: formData.get("bodyHtml"),
  }

  const parsed = templateSchema.safeParse(raw)
  if (!parsed.success) {
    return {
      ok: false,
      fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
    }
  }

  try {
    await updateTemplate(key, parsed.data, session.user.id, session.user.email ?? undefined)
  } catch {
    return { ok: false, message: "No se pudo actualizar la plantilla" }
  }

  revalidatePath("/admin/plantillas")
  return { ok: true, message: "Plantilla actualizada" }
}

export async function resetTemplateAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  let session
  try { session = await requirePermission("admin:email_templates") }
  catch { return { ok: false, message: "Sin permisos" } }

  const key = formData.get("key")?.toString()
  if (!key) return { ok: false, message: "Falta la clave de la plantilla" }

  try {
    await resetTemplate(key, session.user.id, session.user.email ?? undefined)
  } catch {
    return { ok: false, message: "No se pudo restaurar la plantilla" }
  }

  revalidatePath("/admin/plantillas")
  return { ok: true, message: "Plantilla restaurada a su valor por defecto" }
}

export async function seedTemplatesAction(): Promise<ActionState> {
  try { await requirePermission("admin:email_templates") }
  catch { return { ok: false, message: "Sin permisos" } }

  try { await seedDefaultTemplates() }
  catch { return { ok: false, message: "No se pudieron sembrar las plantillas" } }

  revalidatePath("/admin/plantillas")
  return { ok: true, message: "Plantillas por defecto creadas" }
}
