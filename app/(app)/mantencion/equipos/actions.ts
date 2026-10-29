"use server"

import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"
import { z } from "zod"
import { actionErrorResult } from "@/lib/actions/action-error-result"
import { guardPermission } from "@/lib/auth/can"
import type { ExportActionResult } from "@/components/ui/export-button"
import { createEquipment, updateEquipment, type EquipmentInput, type EquipmentResult } from "@/lib/services/mantencion/equipment"
import { buildEquipmentTemplate, commitEquipmentImport, IMPORT_MAX_BYTES, previewEquipmentImport, type ImportPreview, type ImportSummary } from "@/lib/services/mantencion/equipment-import"
import { exportEquipment } from "@/lib/services/mantencion/export-equipment"
import type { MantActionResult } from "@/lib/services/mantencion/result"
import type { ActionState } from "@/lib/validation/operations"

/**
 * Acciones de «Equipos». Cada una pide su permiso del §6 EN el servidor
 * (`mant:equipment:manage` para escribir, `mant:export` para el Excel); ocultar
 * un botón no es control de acceso. Los servicios devuelven los errores por
 * campo ya redactados en español.
 */

const PATH = "/mantencion/equipos"

/** Después de un cambio de equipos se refrescan la lista, la ficha, el panel y las pautas (cuentan equipos). */
function revalidateEquipment(vehicleId?: string) {
  revalidatePath(PATH)
  if (vehicleId) revalidatePath(`${PATH}/${vehicleId}`)
  revalidatePath("/mantencion/panel")
  revalidatePath("/mantencion/pautas")
}

const text = (formData: FormData, key: string, max = 200) => String(formData.get(key) ?? "").trim().slice(0, max)

/** «40.312» o «5.400,5» → número; vacío → null; basura → NaN (el servicio la rechaza con su mensaje). */
function numberOrNull(value: string): number | null {
  if (!value) return null
  const normalized = value.includes(",") ? value.replace(/\./g, "").replace(",", ".") : value.replace(/\.(?=\d{3}(\D|$))/g, "")
  return /^\d+(\.\d+)?$/.test(normalized) ? Number(normalized) : Number.NaN
}

function readEquipmentForm(formData: FormData): EquipmentInput {
  const year = text(formData, "year", 6)
  return {
    code: text(formData, "code", 40),
    plate: text(formData, "plate", 20),
    noPlate: formData.get("noPlate") === "1",
    equipmentTypeId: text(formData, "equipmentTypeId", 64),
    brandId: text(formData, "brandId", 64),
    model: text(formData, "model", 120),
    year: year ? (/^\d{4}$/.test(year) ? Number(year) : Number.NaN) : null,
    worksiteId: text(formData, "worksiteId", 64),
    newWorksiteName: text(formData, "newWorksiteName", 120),
    scheduleId: text(formData, "scheduleId", 64) || null,
    initialReading: numberOrNull(text(formData, "initialReading", 20)),
    initialReadingDate: text(formData, "initialReadingDate", 10) || null,
  }
}

function toState<T>(result: EquipmentResult<T>): ActionState {
  if (result.ok) return { ok: true, message: result.message }
  const fieldErrors = Object.fromEntries(Object.entries(result.fieldErrors).map(([key, message]) => [key, [message]]))
  return { ok: false, message: result.message, fieldErrors }
}

export async function createEquipmentAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const guard = await guardPermission("mant:equipment:manage", PATH)
  if (guard.error) return guard.error
  let vehicleId: string
  try {
    const result = await createEquipment({ userId: guard.session.user.id, email: guard.session.user.email ?? null }, readEquipmentForm(formData))
    if (!result.ok) return toState(result)
    vehicleId = result.data.vehicleId
  } catch (error) {
    return actionErrorResult(error, "No se pudo crear el equipo. Inténtalo de nuevo.")
  }
  revalidateEquipment(vehicleId)
  // Cae en la ficha del equipo recién creado, ya en modo lectura.
  redirect(`${PATH}/${vehicleId}?creado=1`)
}

export async function updateEquipmentAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const guard = await guardPermission("mant:equipment:manage", PATH)
  if (guard.error) return guard.error
  const vehicleId = text(formData, "vehicleId", 64)
  if (!vehicleId) return { ok: false, message: "No se reconoce el equipo." }
  const retired = formData.get("status") === "baja"
  try {
    const result = await updateEquipment(
      { userId: guard.session.user.id, email: guard.session.user.email ?? null },
      vehicleId,
      readEquipmentForm(formData),
      { active: !retired, retiredReason: text(formData, "retiredReason", 1000) },
    )
    if (result.ok) revalidateEquipment(vehicleId)
    return toState(result)
  } catch (error) {
    return actionErrorResult(error, "No se pudieron guardar los cambios. Inténtalo de nuevo.")
  }
}

const exportSchema = z.object({
  vehicleIds: z.array(z.string().min(1).max(64)).max(5000).nullable(),
  includeRetired: z.boolean(),
  /** Los filtros que la persona tenía puestos; sólo para la hoja de metadatos y la auditoría. */
  filters: z.record(z.string().max(60), z.union([z.string().max(200), z.boolean()])),
})

/** Excel de los equipos que se ven en la lista; el servidor los vuelve a cargar dentro del alcance de faenas. */
export async function exportEquipmentAction(input: z.input<typeof exportSchema>): Promise<ExportActionResult> {
  const guard = await guardPermission("mant:export", PATH)
  if (guard.error) return guard.error
  const parsed = exportSchema.safeParse(input)
  if (!parsed.success) return { ok: false, message: "No se pudo preparar la exportación." }
  try {
    const { base64, filename } = await exportEquipment(guard.session, parsed.data)
    return { ok: true, data: { base64, filename } }
  } catch (error) {
    return actionErrorResult(error, "No se pudo generar el Excel.")
  }
}

// ── Importación ──────────────────────────────────────────────────────────────

async function readUpload(formData: FormData): Promise<{ ok: true; buffer: ArrayBuffer; name: string } | { ok: false; message: string }> {
  const file = formData.get("file")
  if (!(file instanceof File) || file.size === 0) return { ok: false, message: "Elige la planilla de Excel que quieres importar." }
  if (file.size > IMPORT_MAX_BYTES) return { ok: false, message: "El archivo pesa más de 5 MB. Divide la planilla en partes." }
  if (!/\.xlsx$/i.test(file.name)) return { ok: false, message: "El archivo tiene que ser una planilla de Excel (.xlsx), como la plantilla." }
  return { ok: true, buffer: await file.arrayBuffer(), name: file.name }
}

export async function previewImportAction(formData: FormData): Promise<MantActionResult<ImportPreview>> {
  const guard = await guardPermission("mant:equipment:manage", PATH)
  if (guard.error) return guard.error
  const upload = await readUpload(formData)
  if (!upload.ok) return upload
  try {
    return await previewEquipmentImport(upload.buffer)
  } catch (error) {
    return actionErrorResult(error, "No se pudo revisar la planilla.")
  }
}

export async function commitImportAction(formData: FormData): Promise<MantActionResult<ImportSummary>> {
  const guard = await guardPermission("mant:equipment:manage", PATH)
  if (guard.error) return guard.error
  const upload = await readUpload(formData)
  if (!upload.ok) return upload
  try {
    // Se vuelve a leer y validar el archivo: la vista previa no es una promesa.
    const result = await commitEquipmentImport({ userId: guard.session.user.id, email: guard.session.user.email ?? null }, upload.buffer, upload.name)
    if (result.ok) revalidateEquipment()
    return result
  } catch (error) {
    return actionErrorResult(error, "No se pudo importar la planilla. No se guardó ningún cambio.")
  }
}

/** Plantilla `.xlsx` vacía, con las listas vigentes de tipos, marcas, faenas y pautas. */
export async function downloadTemplateAction(): Promise<ExportActionResult> {
  const guard = await guardPermission("mant:equipment:manage", PATH)
  if (guard.error) return guard.error
  try {
    return { ok: true, data: await buildEquipmentTemplate() }
  } catch (error) {
    return actionErrorResult(error, "No se pudo generar la plantilla.")
  }
}
