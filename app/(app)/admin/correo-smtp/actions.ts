"use server"

import { revalidatePath } from "next/cache"
import { requirePermission } from "@/lib/auth/can"
import { setEmailsEnabled } from "@/lib/services/system-settings"
import { testResendConnection } from "@/lib/services/smtp-settings"
import { recordAudit } from "@/lib/audit"
import type { ActionState } from "@/lib/validation/masters"

export async function setEmailsEnabledAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  let session
  try {
    session = await requirePermission("admin:smtp")
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
    session = await requirePermission("admin:smtp")
  } catch {
    return { ok: false, message: "Sin permisos" }
  }

  const to = session.user.email
  if (!to) {
    return { ok: false, message: "El usuario autenticado no tiene correo registrado" }
  }

  let result: Awaited<ReturnType<typeof testResendConnection>>
  try {
    result = await testResendConnection(to)
  } catch (error) {
    result = {
      ok: false,
      error: error instanceof Error ? error.message : "No se pudo contactar al proveedor de correo",
    }
  }
  try {
    await recordAudit({
      userId: session.user.id,
      userEmail: session.user.email ?? undefined,
      action: "update",
      entityType: "smtp_delivery_test",
      entityId: "resend",
      newState: {
        attemptedAt: new Date().toISOString(),
        recipient: to,
        result: result.ok ? "sent" : "failed",
        error: result.ok ? undefined : result.error,
      },
    })
  } catch {
    return {
      ok: false,
      message: result.ok
        ? "El correo de prueba fue enviado, pero no se pudo registrar la auditoría."
        : "La prueba falló y no se pudo registrar la auditoría.",
    }
  }
  if (result.ok) {
    return { ok: true, message: `Correo de prueba enviado a ${to}` }
  }
  return { ok: false, message: result.error }
}
