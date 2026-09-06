"use server"

import { revalidatePath } from "next/cache"
import { requirePermission } from "@/lib/auth/can"
import { safeActionMessage } from "@/lib/action-error"
import type { ActionState } from "@/lib/validation/masters"
import {
  clearCloudreveSettings,
  readEnvSstBackend,
  saveCloudreveSettings,
  CloudreveSettingsError,
  type SstBackendSetting,
} from "@/lib/services/cloudreve/settings"
import { invalidateSstBackendCache } from "@/lib/storage/sst-backend"
import { probeCloudreveConnection } from "@/lib/services/cloudreve/client"

const REVALIDATE = "/admin/almacenamiento"

function formText(formData: FormData, name: string): string | undefined {
  const value = formData.get(name)
  return typeof value === "string" ? value.trim() : undefined
}

/** Sin trim: la contraseña es opaca y los espacios pueden ser parte del secreto. */
function formTextRaw(formData: FormData, name: string): string | undefined {
  const value = formData.get(name)
  return typeof value === "string" ? value : undefined
}

function parseBackend(formData: FormData): SstBackendSetting | undefined {
  const raw = formText(formData, "backend")
  if (raw === "filesystem" || raw === "cloudreve") return raw
  return undefined
}

/** Los errores tipificados del servicio tienen un texto propio y accionable. */
function settingsErrorMessage(code: CloudreveSettingsError["code"]): string {
  switch (code) {
    case "CLOUDREVE_KEYRING_REQUIRED":
      return "No hay keyring de cifrado activo en el servidor (DTE_SETTINGS_KEYRING): no se guardan credenciales en texto plano."
    case "CLOUDREVE_CREDENTIALS_REQUIRED":
      return "Para activar el backend Cloudreve hacen falta URL, usuario y contraseña. Complételos en este mismo formulario y guarde una sola vez."
  }
}

/**
 * Guarda la configuración del almacenamiento Cloudreve. Los campos sensibles
 * vacíos conservan su valor y cada borrado es explícito por checkbox.
 */
export async function saveCloudreveStorageAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  let session
  try {
    session = await requirePermission("admin:storage")
  } catch {
    return { ok: false, message: "No tiene permisos para configurar el almacenamiento." }
  }

  const backend = parseBackend(formData)
  if (formData.get("backend") !== null && backend === undefined) {
    return { ok: false, message: "Backend de almacenamiento inválido." }
  }

  // Vacío sin checkbox = conservar lo guardado (contrato de los campos que no
  // se exponen), así que sólo se envía la ruta cuando trae texto.
  const sstPathRaw = formText(formData, "sstPath")

  try {
    await saveCloudreveSettings(
      {
        baseUrl: formText(formData, "baseUrl"),
        username: formText(formData, "username"),
        password: formTextRaw(formData, "password"),
        sstPath: sstPathRaw !== "" ? sstPathRaw : undefined,
        backend,
        clearUsername: formData.get("clearUsername") === "on",
        clearPassword: formData.get("clearPassword") === "on",
        clearSstPath: formData.get("clearSstPath") === "on",
      },
      { userId: session.user.id, userEmail: session.user.email ?? undefined },
    )
  } catch (error) {
    if (error instanceof CloudreveSettingsError) {
      return { ok: false, message: settingsErrorMessage(error.code) }
    }
    // El motivo real (URL inválida, ruta con traversal, escribir y borrar el
    // mismo campo) es accionable y no revela nada: aplastarlo en un genérico
    // dejaba a la persona sin saber qué corregir.
    return {
      ok: false,
      message: safeActionMessage(error, "No fue posible guardar la configuración de Cloudreve."),
    }
  }

  // El toggle de backend aplica al guardar: purgar la caché del lector.
  if (backend !== undefined) invalidateSstBackendCache()

  revalidatePath(REVALIDATE)
  return { ok: true, message: "Configuración de almacenamiento guardada." }
}

/** Prueba la conexión con la configuración vigente (sin guardar nada). */
export async function testCloudreveConnectionAction(): Promise<{ ok: boolean; message: string }> {
  try {
    await requirePermission("admin:storage")
  } catch {
    return { ok: false, message: "No tiene permisos para probar la conexión." }
  }

  // Fuera del try de permisos: un fallo del probe no puede reportarse como
  // «no tiene permisos», que era exactamente lo que pasaba con una URL mal
  // escrita (el `new URL` lanzaba y caía en ese catch).
  try {
    return await probeCloudreveConnection()
  } catch (error) {
    return { ok: false, message: safeActionMessage(error, "No fue posible probar la conexión con Cloudreve.") }
  }
}

/** Borra toda la configuración persistida: el backend vuelve al fallback (env/default). */
export async function clearCloudreveStorageAction(): Promise<{ ok: boolean; message: string }> {
  let session
  try {
    session = await requirePermission("admin:storage")
  } catch {
    return { ok: false, message: "No tiene permisos para configurar el almacenamiento." }
  }

  try {
    await clearCloudreveSettings({ userId: session.user.id, userEmail: session.user.email ?? undefined })
  } catch (error) {
    return { ok: false, message: safeActionMessage(error, "No fue posible borrar la configuración de Cloudreve.") }
  }

  invalidateSstBackendCache()
  revalidatePath(REVALIDATE)

  // Borrar también borra la key del backend, así que manda el `.env`: prometer
  // «vuelve a filesystem» era falso —y peligroso— en un servidor con
  // SST_STORAGE_BACKEND=cloudreve, que queda apuntando a Cloudreve sin credenciales.
  return readEnvSstBackend() === "cloudreve"
    ? {
        ok: true,
        message: "Configuración de Cloudreve eliminada. Atención: el servidor tiene SST_STORAGE_BACKEND=cloudreve, así que la biblioteca SST sigue apuntando a Cloudreve y ahora sin credenciales guardadas.",
      }
    : {
        ok: true,
        message: "Configuración de Cloudreve eliminada; el almacenamiento vuelve al filesystem local.",
      }
}
