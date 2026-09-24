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
import { probeCloudreveConnection, probeCloudreveFolderKey } from "@/lib/services/cloudreve/client"
import { readCloudreveConfig } from "@/lib/services/cloudreve/settings"
import { getBackupConfig } from "@/lib/services/backups"
import { headers } from "next/headers"
import { canAccessWorksite } from "@/lib/auth/scope"
import { printCredentialFromCookieHeader } from "@/lib/pdf/render-print-page"
import { GeneratedArchiveRetryError, retryGeneratedDocument } from "@/lib/services/generated-documents/admin"
import { parseGeneratedArchiveLayout } from "@/lib/services/generated-documents/remote-key"
import {
  GeneratedArchiveSettingsError,
  readGeneratedArchiveSettings,
  saveGeneratedArchiveSettings,
} from "@/lib/services/generated-documents/settings"

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

// ── Documentos generados ─────────────────────────────────────────────────────

/** Carpetas de Cloudreve que la de documentos generados no puede pisar. */
async function reservedCloudreveFolders(): Promise<Array<{ path: string; label: string }>> {
  const [config, backups] = await Promise.all([readCloudreveConfig(), getBackupConfig()])
  return [
    { path: config.sstPath, label: "la biblioteca de Documentación" },
    { path: backups.cloudreveBackupsPath, label: "los respaldos" },
  ]
}

/** Enciende o apaga el archivado y fija dónde quedan los documentos. */
export async function saveGeneratedArchiveSettingsAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  let session
  try {
    session = await requirePermission("admin:storage")
  } catch {
    return { ok: false, message: "No tiene permisos para configurar el almacenamiento." }
  }
  const layout = parseGeneratedArchiveLayout(formText(formData, "layout"))
  if (!layout) return { ok: false, message: "Orden de carpetas inválido." }
  try {
    const config = await readCloudreveConfig()
    const saved = await saveGeneratedArchiveSettings(
      { enabled: formData.get("enabled") === "on", basePath: formText(formData, "basePath") ?? "", layout },
      { hasCredentials: config.hasCredentials, reservedFolders: await reservedCloudreveFolders() },
      { userId: session.user.id, userEmail: session.user.email ?? undefined },
    )
    revalidatePath(REVALIDATE)
    return {
      ok: true,
      message: saved.enabled
        ? `Archivado encendido: los documentos se guardan en «${saved.basePath}».`
        : "Configuración guardada. El archivado está apagado.",
    }
  } catch (error) {
    if (error instanceof GeneratedArchiveSettingsError) return { ok: false, message: error.message }
    return { ok: false, message: safeActionMessage(error, "No fue posible guardar la configuración de documentos generados.") }
  }
}

/** Verifica credenciales y carpeta guardadas, sin escribir nada. */
export async function testGeneratedArchiveFolderAction(): Promise<{ ok: boolean; message: string }> {
  try {
    await requirePermission("admin:storage")
  } catch {
    return { ok: false, message: "No tiene permisos para probar la conexión." }
  }
  try {
    const settings = await readGeneratedArchiveSettings()
    if (settings.basePathInvalid) return { ok: false, message: "La carpeta guardada no es válida: corríjala y guarde." }
    const probe = await probeCloudreveFolderKey(settings.basePath)
    const folder = `«${settings.basePath}»`
    switch (probe) {
      case "exists": return { ok: true, message: `Conexión verificada: la carpeta ${folder} existe.` }
      case "missing": return { ok: true, message: `Credenciales y URL correctas. La carpeta ${folder} se creará con el primer documento.` }
      case "auth": return { ok: false, message: "Cloudreve rechazó las credenciales: revíselas en la conexión de arriba." }
      case "unreachable": return { ok: false, message: "No se pudo conectar con Cloudreve: revise la URL y que el servidor sea alcanzable." }
      case "not_configured": return { ok: false, message: "Faltan credenciales de Cloudreve: configúrelas arriba." }
      default: return { ok: false, message: "Cloudreve respondió con un error al verificar la carpeta." }
    }
  } catch (error) {
    return { ok: false, message: safeActionMessage(error, "No fue posible probar la carpeta.") }
  }
}

/**
 * Reintenta archivar un documento. Un PDF se imprime con la sesión de quien
 * pulsa, así que además de `admin:storage` el servicio exige poder ver el
 * documento y su faena.
 */
export async function retryGeneratedDocumentAction(id: string): Promise<{ ok: boolean; message: string }> {
  let session
  try {
    session = await requirePermission("admin:storage")
  } catch {
    return { ok: false, message: "No tiene permisos para reintentar el archivado." }
  }
  if (typeof id !== "string" || !id) return { ok: false, message: "Documento no indicado." }
  try {
    const credential = printCredentialFromCookieHeader((await headers()).get("cookie"))
    const summary = await retryGeneratedDocument(id, {
      userId: session.user.id,
      permissions: session.user.permissions,
      canAccessWorksite: (worksiteId) => canAccessWorksite(session, worksiteId),
    }, credential)
    revalidatePath(REVALIDATE)
    if (summary.disabled) return { ok: false, message: "El archivado está apagado." }
    if (summary.uploaded > 0) return { ok: true, message: "Documento subido a Cloudreve." }
    if (summary.superseded > 0) return { ok: true, message: "El documento cambió después de este hito: la copia vigente es la del hito posterior." }
    if (summary.processed === 0) return { ok: false, message: "El documento se está procesando en este momento. Vuelva a mirar en unos minutos." }
    return { ok: false, message: "No se pudo archivar. El motivo quedó en la lista." }
  } catch (error) {
    if (error instanceof GeneratedArchiveRetryError) return { ok: false, message: error.message }
    return { ok: false, message: safeActionMessage(error, "No fue posible reintentar el archivado.") }
  }
}

