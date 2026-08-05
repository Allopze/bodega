"use server"

import { revalidatePath } from "next/cache"
import { requirePermission } from "@/lib/auth/can"
import { clearStoredDteSettings, saveDtePortalSettings } from "@/lib/services/dte-portal/settings"
import type { ActionState } from "@/lib/validation/masters"

const REVALIDATE = "/admin/dte"

function formText(formData: FormData, name: string): string | undefined {
  const value = formData.get(name)
  return typeof value === "string" ? value.trim() : undefined
}

/** Como formText pero sin trim: para la contraseña no se normaliza el texto. */
function formTextRaw(formData: FormData, name: string): string | undefined {
  const value = formData.get(name)
  return typeof value === "string" ? value : undefined
}

/**
 * Guarda la configuración del portal DTE desde Administración › Sincronización
 * DTE. Los campos en blanco borran el valor guardado (vuelven al .env); la
 * contraseña en blanco se conserva (solo se borra con el checkbox dedicado).
 */
export async function saveDteSettingsAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const session = await requirePermission("admin:dte_sync")

    const baseUrl = formText(formData, "baseUrl")
    if (baseUrl !== undefined && baseUrl !== "" && !/^https?:\/\/.+/i.test(baseUrl)) {
      return { ok: false, message: "La URL base debe ser una dirección http(s) válida" }
    }

    const delayRaw = formText(formData, "delayMs")
    let delayMs: number | undefined
    if (delayRaw !== undefined && delayRaw !== "") {
      const parsed = Number(delayRaw)
      if (!Number.isFinite(parsed) || parsed < 0 || parsed > 10_000) {
        return { ok: false, message: "El intervalo entre consultas debe estar entre 0 y 10.000 ms" }
      }
      delayMs = Math.trunc(parsed)
    }

    await saveDtePortalSettings(
      {
        baseUrl,
        rutUsr: formText(formData, "rutUsr"),
        rutEmp: formText(formData, "rutEmp"),
        codEmp: formText(formData, "codEmp"),
        clave: formTextRaw(formData, "clave"),
        clearClave: formData.get("clearClave") === "on",
        syncEnabled: formData.get("syncEnabled") === "on",
        delayMs,
        importerEmail: formText(formData, "importerEmail"),
      },
      { userId: session.user.id, userEmail: session.user.email ?? undefined },
    )

    revalidatePath(REVALIDATE)
    return { ok: true, message: "Credenciales del portal DTE guardadas" }
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : "Error al guardar las credenciales del portal DTE",
    }
  }
}

/**
 * Borra toda la configuración DTE guardada: desde ese momento la app vuelve a
 * leer solo las variables de entorno (DTE_PORTAL_*).
 */
export async function clearDteSettingsAction(): Promise<{ ok: boolean; message: string }> {
  try {
    const session = await requirePermission("admin:dte_sync")
    await clearStoredDteSettings({ userId: session.user.id, userEmail: session.user.email ?? undefined })
    revalidatePath(REVALIDATE)
    return { ok: true, message: "Configuración DTE restaurada a las variables de entorno" }
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : "Error al restaurar la configuración DTE",
    }
  }
}
