"use server"

import { revalidatePath } from "next/cache"
import { requirePermission } from "@/lib/auth/can"
import { setEmailsEnabled } from "@/lib/services/system-settings"
import { testResendConnection } from "@/lib/services/smtp-settings"
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

export async function testResendAction(
  _prev: ActionState | null,
  _formData: FormData,
): Promise<ActionState> {
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

  const result = await testResendConnection(to)
  if (result.ok) {
    return { ok: true, message: `Correo de prueba enviado a ${to}` }
  }
  return { ok: false, message: result.error }
}
