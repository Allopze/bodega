"use server"

import { revalidatePath } from "next/cache"
import { requirePermission } from "@/lib/auth/can"
import { setPdfMaxSizeMb } from "@/lib/services/system-settings"
import { z } from "zod"
import type { ActionState } from "@/lib/validation/masters"

const configSchema = z.object({
  pdfMaxSizeMb: z.coerce
    .number()
    .int("Debe ser un número entero")
    .positive("Debe ser un valor positivo")
    .max(500, "El límite máximo permitido es 500 MB"),
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
    pdfMaxSizeMb: formData.get("pdfMaxSizeMb"),
  }

  const parsed = configSchema.safeParse(raw)
  if (!parsed.success) {
    return {
      ok: false,
      fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
    }
  }

  const { pdfMaxSizeMb } = parsed.data

  try {
    await setPdfMaxSizeMb(
      pdfMaxSizeMb,
      session.user.id,
      session.user.email ?? undefined,
    )
  } catch (_error) {
    return {
      ok: false,
      message: "No se pudo actualizar la configuración en la base de datos",
    }
  }

  revalidatePath("/admin/configuracion")
  return { ok: true, message: "Configuración actualizada con éxito" }
}
