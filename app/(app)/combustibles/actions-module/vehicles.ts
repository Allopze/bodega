"use server"

import { revalidatePath } from "next/cache"
import type { Session } from "next-auth"
import { db } from "@/db"
import { fuelVehicles } from "@/db/schema"
import { eq, inArray } from "drizzle-orm"
import { recordAudit } from "@/lib/audit"
import { requirePermission } from "@/lib/auth/can"
import { canAccessWorksite } from "@/lib/auth/scope"
import { validateFileBuffer, MimeType } from "@/lib/file-validation"
import { nanoid } from "@/lib/id"
import { parseFleetXlsx } from "@/lib/combustibles/fleet-xlsx-import"
import {
  createFuelVehicleSchema,
  updateFuelVehicleSchema,
} from "@/lib/combustibles/validation"
import { getFleetAdminSettings } from "@/lib/services/system-settings"
import type { ActionState } from "@/lib/validation/masters"
import { dbErrMsg } from "./loads"

const FLEET_CATALOG_PATH = "/admin/flota-catalogos/vehiculos"

function worksiteMatchKey(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().replace(/\s+/g, " ").trim()
}

function canManageFuelVehicleWorksite(session: Session, worksiteId: string): boolean {
  return canAccessWorksite(session, worksiteId)
}

export async function createFuelVehicleAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  let session
  try { session = await requirePermission("combustibles:manage_vehicles") }
  catch { return { ok: false, message: "Sin permisos" } }

  const parsed = createFuelVehicleSchema.safeParse({
    plate: formData.get("plate"),
    type: formData.get("type"),
    code: formData.get("code") || undefined,
    brand: formData.get("brand") || undefined,
    model: formData.get("model") || undefined,
    year: formData.get("year") || undefined,
    worksiteId: formData.get("worksiteId") || undefined,
    responsibleUserId: formData.get("responsibleUserId") || undefined,
    operationalStatus: formData.get("operationalStatus") || undefined,
    soapExpiresAt: formData.get("soapExpiresAt") || undefined,
    technicalReviewExpiresAt: formData.get("technicalReviewExpiresAt") || undefined,
    circulationPermitExpiresAt: formData.get("circulationPermitExpiresAt") || undefined,
    insurancePolicyNumber: formData.get("insurancePolicyNumber") || undefined,
    insuranceExpiresAt: formData.get("insuranceExpiresAt") || undefined,
    notes: formData.get("notes") || undefined,
  })

  if (!parsed.success) {
    return { ok: false, message: "Revisa los datos", fieldErrors: parsed.error.flatten().fieldErrors }
  }

  if (!canManageFuelVehicleWorksite(session, parsed.data.worksiteId)) {
    return { ok: false, message: "No puedes gestionar vehículos para esta faena" }
  }

  try {
    const id = nanoid()
    const operationalStatus = parsed.data.operationalStatus ?? (await getFleetAdminSettings()).defaultVehicleStatus
    await db.insert(fuelVehicles).values({ id, ...parsed.data, operationalStatus })
    revalidatePath(FLEET_CATALOG_PATH)
    return { ok: true, message: "Vehículo creado", data: { id } }
  } catch (e) {
    return { ok: false, message: await dbErrMsg(e, "Error al crear vehículo") }
  }
}

export async function updateFuelVehicleAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  let session
  try { session = await requirePermission("combustibles:manage_vehicles") }
  catch { return { ok: false, message: "Sin permisos" } }

  const id = String(formData.get("id") ?? "")
  if (!id) return { ok: false, message: "ID requerido" }

  const parsed = updateFuelVehicleSchema.safeParse({
    id,
    plate: formData.get("plate") || undefined,
    type: formData.get("type") || undefined,
    code: formData.get("code") || undefined,
    brand: formData.get("brand") || undefined,
    model: formData.get("model") || undefined,
    year: formData.get("year") || undefined,
    worksiteId: formData.get("worksiteId") || undefined,
    responsibleUserId: formData.get("responsibleUserId") || undefined,
    operationalStatus: formData.get("operationalStatus") || undefined,
    soapExpiresAt: formData.get("soapExpiresAt") || undefined,
    technicalReviewExpiresAt: formData.get("technicalReviewExpiresAt") || undefined,
    circulationPermitExpiresAt: formData.get("circulationPermitExpiresAt") || undefined,
    insurancePolicyNumber: formData.get("insurancePolicyNumber") || undefined,
    insuranceExpiresAt: formData.get("insuranceExpiresAt") || undefined,
    notes: formData.get("notes") || undefined,
  })

  if (!parsed.success) {
    return { ok: false, message: "Revisa los datos", fieldErrors: parsed.error.flatten().fieldErrors }
  }

  const existing = await db.query.fuelVehicles.findFirst({ where: eq(fuelVehicles.id, id) })
  if (!existing) return { ok: false, message: "Vehículo no encontrado" }
  if (!canManageFuelVehicleWorksite(session, existing.worksiteId)) {
    return { ok: false, message: "No puedes gestionar vehículos para esta faena" }
  }
  if (parsed.data.worksiteId && !canManageFuelVehicleWorksite(session, parsed.data.worksiteId)) {
    return { ok: false, message: "No puedes gestionar vehículos para esta faena" }
  }

  try {
    const { id: _, ...data } = parsed.data
    await db.update(fuelVehicles).set({ ...data, updatedAt: new Date().toISOString() }).where(eq(fuelVehicles.id, id))
    revalidatePath(FLEET_CATALOG_PATH)
    return { ok: true, message: "Vehículo actualizado" }
  } catch (e) {
    return { ok: false, message: await dbErrMsg(e, "Error al actualizar") }
  }
}

export async function toggleFuelVehicleActiveAction(id: string, activate: boolean): Promise<ActionState> {
  let session
  try { session = await requirePermission("combustibles:manage_vehicles") }
  catch { return { ok: false, message: "Sin permisos" } }

  const existing = await db.query.fuelVehicles.findFirst({ where: eq(fuelVehicles.id, id) })
  if (!existing) return { ok: false, message: "Vehículo no encontrado" }
  if (!canManageFuelVehicleWorksite(session, existing.worksiteId)) {
    return { ok: false, message: "No puedes gestionar vehículos para esta faena" }
  }

  try {
    await db.update(fuelVehicles).set({ isActive: activate, updatedAt: new Date().toISOString() }).where(eq(fuelVehicles.id, id))
    revalidatePath(FLEET_CATALOG_PATH)
    return { ok: true, message: activate ? "Vehículo activado" : "Vehículo desactivado" }
  } catch (e) {
    return { ok: false, message: await dbErrMsg(e, activate ? "Error al activar" : "Error al desactivar") }
  }
}

export async function bulkToggleFuelVehicleActiveAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try { await requirePermission("combustibles:manage_vehicles") }
  catch { return { ok: false, message: "Sin permisos" } }

  const idsRaw = formData.get("ids") as string
  const activate = formData.get("activate") === "true"
  if (!idsRaw) return { ok: false, message: "IDs requeridos" }

  const ids = idsRaw.split(",").map((s) => s.trim()).filter(Boolean)
  if (ids.length === 0) return { ok: false, message: "Selecciona al menos un vehículo" }
  if (ids.length > 100) return { ok: false, message: "Máximo 100 vehículos por operación" }

  try {
    const now = new Date().toISOString()
    await db.update(fuelVehicles)
      .set({ isActive: activate, updatedAt: now })
      .where(inArray(fuelVehicles.id, ids))

    revalidatePath(FLEET_CATALOG_PATH)
    return { ok: true, message: `${ids.length} vehículo${ids.length === 1 ? "" : "s"} ${activate ? "activado" : "desactivado"}${ids.length === 1 ? "" : "s"}` }
  } catch (e) {
    return { ok: false, message: await dbErrMsg(e, activate ? "Error al activar" : "Error al desactivar") }
  }
}

export async function importFuelVehiclesFromXlsx(_prev: ActionState, formData: FormData): Promise<ActionState> {
  let session
  try { session = await requirePermission("combustibles:manage_vehicles") }
  catch { return { ok: false, message: "Sin permisos" } }

  const file = formData.get("file")
  if (!(file instanceof File) || file.size === 0) return { ok: false, fieldErrors: { file: ["Selecciona un archivo XLSX"] } }
  if (!file.name.toLowerCase().endsWith(".xlsx")) return { ok: false, fieldErrors: { file: ["El archivo debe estar en formato .xlsx"] } }
  if (file.size > 6 * 1024 * 1024) return { ok: false, fieldErrors: { file: ["El archivo no puede superar 6 MB"] } }

  const buffer = Buffer.from(await file.arrayBuffer())
  const fileValidation = validateFileBuffer(buffer, file.size, MimeType.SPREADSHEET)
  if (fileValidation.error) return { ok: false, fieldErrors: { file: [fileValidation.error] } }

  const parsed = await parseFleetXlsx(buffer)
  if (parsed.rows.length === 0) {
    return { ok: false, message: parsed.errors[0]?.message ?? "La planilla no contiene vehículos válidos" }
  }

  const [availableWorksites, existingVehicles] = await Promise.all([
    db.query.worksites.findMany(),
    db.query.fuelVehicles.findMany(),
  ])
  const worksiteByName = new Map(
    availableWorksites
      .filter((worksite) => canManageFuelVehicleWorksite(session, worksite.id))
      .map((worksite) => [worksiteMatchKey(worksite.name), worksite]),
  )
  const vehicleByPlate = new Map(existingVehicles.map((vehicle) => [vehicle.plate.toUpperCase().replace(/\s+/g, ""), vehicle]))
  const errors = [...parsed.errors]
  const importable = parsed.rows.flatMap((row) => {
    const worksite = worksiteByName.get(worksiteMatchKey(row.worksiteName))
    if (!worksite) {
      errors.push({ rowIndex: row.rowIndex, field: "FAENA", message: `No existe una faena administrable que coincida con “${row.worksiteName}”` })
      return []
    }
    const existing = vehicleByPlate.get(row.plate)
    if (existing && !canManageFuelVehicleWorksite(session, existing.worksiteId)) {
      errors.push({ rowIndex: row.rowIndex, field: "PATENTE", message: "El vehículo existente no puede ser administrado desde tu alcance" })
      return []
    }
    return [{ ...row, worksiteId: worksite.id, existing }]
  })

  let created = 0
  let updated = 0
  try {
    await db.transaction(async (tx) => {
      for (const row of importable) {
        const values = { plate: row.plate, code: row.code, type: row.type, brand: row.brand, model: row.model, year: row.year, worksiteId: row.worksiteId }
        if (row.existing) {
          updated++
          await tx.update(fuelVehicles).set({ ...values, updatedAt: new Date().toISOString() }).where(eq(fuelVehicles.id, row.existing.id))
        } else {
          created++
          await tx.insert(fuelVehicles).values({ id: nanoid(), ...values })
        }
      }
    })
  } catch (error) {
    return { ok: false, message: await dbErrMsg(error, "No se pudieron importar los vehículos") }
  }

  const skipped = errors.length
  await recordAudit({
    userId: session.user.id,
    userEmail: session.user.email ?? undefined,
    action: "update",
    entityType: "fuel_vehicle",
    entityId: "import_xlsx",
    newState: { fileName: file.name, created, updated, skipped },
  })
  revalidatePath(FLEET_CATALOG_PATH)
  return {
    ok: true,
    message: `Importados: ${created} creados, ${updated} actualizados, ${skipped} omitidos`,
    data: { created, updated, skipped, errors: errors.slice(0, 20).map((error) => `Fila ${error.rowIndex}, ${error.field}: ${error.message}`), totalErrors: errors.length },
  }
}
