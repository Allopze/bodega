"use server"

import { revalidatePath } from "next/cache"
import { requirePermission } from "@/lib/auth/can"
import {
  clearStoredDteSettings,
  convertLegacyDteSettings,
  rotateDteSettingsKeyring,
  saveDtePortalSettings,
} from "@/lib/services/dte-portal/settings"
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
 * DTE. Los campos sensibles vacíos preservan su valor: borrar siempre exige
 * un checkbox explícito, para que el navegador jamás reciba valores actuales.
 */
export async function saveDteSettingsAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const session = await requirePermission("admin:dte_sync")

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
        rutUsr: formText(formData, "rutUsr"),
        rutEmp: formText(formData, "rutEmp"),
        codEmp: formText(formData, "codEmp"),
        clave: formTextRaw(formData, "clave"),
        clearClave: formData.get("clearClave") === "on",
        clearRutUsr: formData.get("clearRutUsr") === "on",
        clearRutEmp: formData.get("clearRutEmp") === "on",
        clearCodEmp: formData.get("clearCodEmp") === "on",
        clearImporterEmail: formData.get("clearImporterEmail") === "on",
        clearDelayMs: formData.get("clearDelayMs") === "on",
        syncEnabled: formData.get("syncEnabled") === "on",
        delayMs,
        importerEmail: formText(formData, "importerEmail"),
      },
      { userId: session.user.id, userEmail: session.user.email ?? undefined },
    )

    revalidatePath(REVALIDATE)
    return { ok: true, message: "Credenciales del portal DTE guardadas" }
  } catch {
    return {
      ok: false,
      message: "No fue posible guardar la configuración DTE. Revise el estado del keyring y los datos ingresados.",
    }
  }
}

/**
 * Borra toda la configuración DTE guardada. En encrypted_only esto deja la
 * sincronización deshabilitada: nunca revive un secreto de entorno en texto.
 */
export async function clearDteSettingsAction(): Promise<{ ok: boolean; message: string }> {
  try {
    const session = await requirePermission("admin:dte_sync")
    await clearStoredDteSettings({ userId: session.user.id, userEmail: session.user.email ?? undefined })
    revalidatePath(REVALIDATE)
    return { ok: true, message: "Configuración DTE eliminada; la sincronización permanece deshabilitada hasta configurarla nuevamente." }
  } catch {
    return {
      ok: false,
      message: "No fue posible actualizar la configuración DTE.",
    }
  }
}

/** One-way, confirmed cutover to envelopes that preserves the portal credential values. */
export async function convertLegacyDteSettingsAction(): Promise<{ ok: boolean; message: string }> {
  try {
    const session = await requirePermission("admin:dte_sync")
    await convertLegacyDteSettings({ userId: session.user.id, userEmail: session.user.email ?? undefined })
    revalidatePath(REVALIDATE)
    return {
      ok: true,
      message: "Corte cifrado verificado con las mismas credenciales del portal. La sincronización quedó pausada hasta revisar y habilitarla.",
    }
  } catch {
    return { ok: false, message: "No fue posible completar la conversión cifrada. La sincronización quedó pausada; revise solicitudes activas al portal y el keyring del host." }
  }
}

/** Re-wraps the same credential plaintext only after a new active key is in app. */
export async function rotateDteSettingsKeyringAction(): Promise<{ ok: boolean; message: string }> {
  try {
    const session = await requirePermission("admin:dte_sync")
    const result = await rotateDteSettingsKeyring({ userId: session.user.id, userEmail: session.user.email ?? undefined })
    revalidatePath(REVALIDATE)
    return { ok: true, message: `Re-cifrado del keyring verificado en ${result.rewrapped} campo(s); las credenciales del portal no cambiaron. La sincronización quedó pausada para revisión.` }
  } catch {
    return { ok: false, message: "No fue posible completar el re-cifrado del keyring. La sincronización quedó pausada; conserve todas las claves del keyring y revise las solicitudes activas al portal." }
  }
}
