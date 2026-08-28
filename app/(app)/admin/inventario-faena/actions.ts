"use server"

import { revalidatePath } from "next/cache"
import { canAny, requireAuth } from "@/lib/auth/can"
import { serviceWorksiteScope } from "@/lib/auth/scope"
import { validateFileBuffer, MimeType } from "@/lib/file-validation"
import {
  createWorksiteResource,
  deleteWorksiteResource,
  importWorksiteResources,
  previewEmergencyInventoryImport,
  confirmEmergencyInventoryImport,
  exportEmergencyInventoryXlsx,
  assignEmergencyResource,
} from "@/lib/services/worksite-inventory"
import { todayInChile } from "@/lib/utils"

const PERMISSION = "admin:worksite_inventory" as const
const SERVICE_PERMISSION = "admin:worksite_inventory_service" as const
const BASE = "/admin/inventario-faena"

export interface InventoryActionState {
  ok: boolean
  message?: string
  /**
   * Resultado de la carga masiva: cuántas entraron y qué filas se rechazaron.
   * Tipado como registro plano para encajar en `OperationResult`, que es lo que
   * consume `useOperation`; el cliente lo reinterpreta como `ImportResult`.
   */
  data?: Record<string, unknown>
}

/**
 * El inventario se refleja en tres lugares: acá, en el plan de emergencias que
 * lo declara y en el picker de sujeto de una inspección nueva. Revalidar sólo
 * esta ruta dejaría a los otros dos mostrando un padrón viejo.
 */
function revalidateInventoryViews() {
  revalidatePath(BASE)
  revalidatePath("/prevencion/emergencias")
  revalidatePath("/prevencion/emergencias/[planId]", "page")
  revalidatePath("/prevencion/inspecciones")
}

async function run(operation: (access: {
  userId: string
  permissions: readonly string[]
  scope: readonly string[] | "all"
}) => Promise<unknown>, required: "master" | "service" | "either" = "master", revalidate = true): Promise<InventoryActionState> {
  let session
  try {
    session = await requireAuth()
    const permitted = required === "master"
      ? canAny(session, PERMISSION)
      : required === "service"
        ? canAny(session, SERVICE_PERMISSION)
        : canAny(session, PERMISSION, SERVICE_PERMISSION)
    if (!permitted) return { ok: false, message: "Sin permisos" }
  }
  catch { return { ok: false, message: "Sin permisos" } }

  try {
    const result = await operation({
      userId: session.user.id,
      permissions: session.user.permissions,
      scope: serviceWorksiteScope(session),
    })
    if (revalidate) revalidateInventoryViews()
    return { ok: true, data: (result ?? undefined) as Record<string, unknown> | undefined }
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "No se pudo completar la operación." }
  }
}

export async function createWorksiteResourceAction(input: unknown): Promise<InventoryActionState> {
  return run((access) => createWorksiteResource(input, access))
}

/**
 * Recibe la planilla como `FormData`: mismo camino que la importación de
 * vehículos, para que los dos padrones se carguen igual. El archivo se valida
 * por su contenido y no sólo por su extensión.
 */
export async function importWorksiteResourcesAction(formData: FormData): Promise<InventoryActionState> {
  const worksiteId = String(formData.get("worksiteId") ?? "")
  const file = formData.get("file")
  if (!worksiteId) return { ok: false, message: "Falta la faena." }
  if (!(file instanceof File) || file.size === 0) return { ok: false, message: "Selecciona un archivo Excel." }
  if (!file.name.toLowerCase().endsWith(".xlsx")) return { ok: false, message: "El archivo debe estar en formato .xlsx" }
  if (file.size > 6 * 1024 * 1024) return { ok: false, message: "El archivo no puede superar 6 MB." }

  const buffer = Buffer.from(await file.arrayBuffer())
  const validation = validateFileBuffer(buffer, file.size, MimeType.SPREADSHEET)
  if (validation.error) return { ok: false, message: validation.error }

  return run((access) => importWorksiteResources({ worksiteId, fileBuffer: buffer, fileName: file.name }, access))
}

async function validatedImportFile(formData: FormData) {
  const worksiteId = String(formData.get("worksiteId") ?? "")
  const file = formData.get("file")
  if (!worksiteId) return { error: "Falta la faena." } as const
  if (!(file instanceof File) || file.size === 0) return { error: "Selecciona un archivo Excel." } as const
  if (!file.name.toLowerCase().endsWith(".xlsx")) return { error: "El archivo debe estar en formato .xlsx" } as const
  if (file.size > 6 * 1024 * 1024) return { error: "El archivo no puede superar 6 MB." } as const
  const buffer = Buffer.from(await file.arrayBuffer())
  const validation = validateFileBuffer(buffer, file.size, MimeType.SPREADSHEET)
  if (validation.error) return { error: validation.error } as const
  return { worksiteId, file, buffer } as const
}

export async function previewEmergencyInventoryImportAction(formData: FormData): Promise<InventoryActionState> {
  const validated = await validatedImportFile(formData)
  if ("error" in validated) return { ok: false, message: validated.error }
  return run((access) => previewEmergencyInventoryImport({
    worksiteId: validated.worksiteId,
    fileBuffer: validated.buffer,
  }, access), "master", false)
}

export async function confirmEmergencyInventoryImportAction(formData: FormData): Promise<InventoryActionState> {
  const validated = await validatedImportFile(formData)
  if ("error" in validated) return { ok: false, message: validated.error }
  return run((access) => confirmEmergencyInventoryImport({
    worksiteId: validated.worksiteId,
    fileBuffer: validated.buffer,
    fileName: validated.file.name,
  }, access))
}

export async function exportEmergencyInventoryAction(): Promise<{
  ok: boolean
  data?: { base64: string; filename: string }
  message?: string
}> {
  let session
  try {
    session = await requireAuth()
    if (!canAny(session, PERMISSION)) return { ok: false, message: "Sin permisos" }
  }
  catch { return { ok: false, message: "Sin permisos" } }
  try {
    const buffer = await exportEmergencyInventoryXlsx({
      userId: session.user.id,
      permissions: session.user.permissions,
      scope: serviceWorksiteScope(session),
    })
    return {
      ok: true,
      data: {
        base64: buffer.toString("base64"),
        filename: `inventario_activos_emergencia_${todayInChile()}.xlsx`,
      },
    }
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "No se pudo exportar." }
  }
}

export async function deleteWorksiteResourceAction(input: unknown): Promise<InventoryActionState> {
  return run((access) => deleteWorksiteResource(input, access))
}

export async function assignEmergencyResourceAction(input: unknown): Promise<InventoryActionState> {
  return run((access) => assignEmergencyResource(input, access), "service")
}
