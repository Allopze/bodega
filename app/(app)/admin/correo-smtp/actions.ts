"use server"

import { safeActionMessage } from "@/lib/action-error"

import { revalidatePath } from "next/cache"
import { requirePermission } from "@/lib/auth/can"
import { setEmailsEnabled } from "@/lib/services/system-settings"
import { testResendConnection } from "@/lib/services/smtp-settings"
import { clearResendSettings, saveResendSettings } from "@/lib/services/resend-settings"
import { EncryptedSettingsError } from "@/lib/services/encrypted-settings"
import { recordAudit } from "@/lib/audit"
import type { ActionState } from "@/lib/validation/masters"

const REVALIDATE = "/admin/correo-smtp"

/** Tope razonable: las claves reales de Resend miden unas decenas de caracteres. */
const API_KEY_MAX_LENGTH = 256

/** Los errores tipificados del helper de ajustes tienen un texto propio y accionable. */
function resendSettingsErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof EncryptedSettingsError) {
    switch (error.code) {
      case "SETTINGS_KEYRING_REQUIRED":
        return "No hay llavero de cifrado activo en el servidor (DTE_SETTINGS_KEYRING): no se guardan claves en texto plano. Mientras tanto se sigue usando la clave del servidor (.env)."
      case "SETTINGS_FIELD_CONFLICT":
        return "Escribe una clave nueva o marca «Borrar», no ambas cosas a la vez."
    }
  }
  return safeActionMessage(error, fallback)
}

/**
 * Guarda (o borra) la clave de API de Resend. Es de solo escritura: vacío
 * conserva la guardada y borrar es explícito (`clearApiKey`). La clave nunca
 * vuelve en la respuesta.
 */
export async function saveResendApiKeyAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  let session
  try {
    session = await requirePermission("admin:smtp")
  } catch {
    return { ok: false, message: "Sin permisos para configurar el correo" }
  }

  const rawKey = formData.get("apiKey")
  // Se recorta: una clave pegada con un salto de línea final es el error más común.
  const apiKey = typeof rawKey === "string" ? rawKey.trim() : ""
  const clearApiKey = formData.get("clearApiKey") === "on"

  if (apiKey && (/\s/.test(apiKey) || apiKey.length > API_KEY_MAX_LENGTH)) {
    return { ok: false, message: "La clave de API no tiene un formato válido: no debe llevar espacios." }
  }
  if (!apiKey && !clearApiKey) {
    return { ok: true, message: "No hay cambios que guardar" }
  }

  try {
    const result = await saveResendSettings(
      { apiKey, clearApiKey },
      { userId: session.user.id, userEmail: session.user.email ?? undefined },
    )
    revalidatePath(REVALIDATE)
    if (!result.changed) return { ok: true, message: "No hay cambios que guardar" }
    return {
      ok: true,
      message: clearApiKey
        ? "Clave de Resend borrada; se usa la del servidor (.env) si existe"
        : "Clave de Resend guardada",
    }
  } catch (error) {
    return { ok: false, message: resendSettingsErrorMessage(error, "No fue posible guardar la clave de Resend.") }
  }
}

/** Borra lo guardado en la plataforma: el envío vuelve a la clave del `.env`, si hay. */
export async function restoreResendSettingsAction(): Promise<{ ok: boolean; message: string }> {
  let session
  try {
    session = await requirePermission("admin:smtp")
  } catch {
    return { ok: false, message: "Sin permisos para configurar el correo" }
  }

  try {
    await clearResendSettings({ userId: session.user.id, userEmail: session.user.email ?? undefined })
  } catch (error) {
    return { ok: false, message: resendSettingsErrorMessage(error, "No fue posible restaurar la configuración del servidor.") }
  }

  revalidatePath(REVALIDATE)
  return { ok: true, message: "Se restauró la configuración del servidor: el envío usa la clave del .env, si existe" }
}

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

  revalidatePath(REVALIDATE)
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
      error: safeActionMessage(error, "No se pudo contactar al proveedor de correo"),
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
