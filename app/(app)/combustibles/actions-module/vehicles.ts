"use server"

import { revalidatePath } from "next/cache"
import type { Session } from "next-auth"
import { db } from "@/db"
import { fuelEquipmentTypes, fuelProducts, fuelVehicleOperationalIntervals, fuelVehicleProducts, fuelVehicles } from "@/db/schema"
import { and, eq, inArray } from "drizzle-orm"
import { recordAudit } from "@/lib/audit"
import { requirePermission } from "@/lib/auth/can"
import { canAccessWorksite, worksiteScopeSql } from "@/lib/auth/scope"
import { validateFileBuffer, MimeType } from "@/lib/file-validation"
import { nanoid } from "@/lib/id"
import { setVehicleOperationalStatus } from "@/lib/services/fleet"
import { parseFleetXlsx } from "@/lib/combustibles/fleet-xlsx-import"
import { normalizePlate } from "@/lib/combustibles/xlsx-utils"
import {
  createFuelVehicleSchema,
  fuelEquipmentTypeSlug,
  updateFuelVehicleSchema,
} from "@/lib/combustibles/validation"
import { getFleetAdminSettings } from "@/lib/services/system-settings"
import type { ActionState } from "@/lib/validation/masters"
import { pluralize } from "@/lib/utils"
import { dbErrMsg } from "./loads"

/* El padrón se administra desde acá, y por eso las cinco acciones de esta
 * familia piden `admin:fleet_vehicles` y no `combustibles:manage_vehicles`.
 *
 * Ese permiso hacía dos trabajos incompatibles: mantener el padrón (dato
 * maestro, que hace administración o secretaría) y decidir sacar un equipo de
 * servicio por un hallazgo de inspección (decisión operativa de quien administra
 * la flota, ver `stopVehicleForFinding`). Quien digita una patente nueva no es
 * necesariamente quien puede detener un camión en faena. Los grants conservan a
 * todos los que ya administraban el padrón: la separación no quitó acceso. */
const FLEET_CATALOG_PATH = "/admin/flota-catalogos/vehiculos"

function worksiteMatchKey(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().replace(/\s+/g, " ").trim()
}

function canManageFuelVehicleWorksite(session: Session, worksiteId: string): boolean {
  return canAccessWorksite(session, worksiteId)
}

function vehicleFormData(formData: FormData, id?: string) {
  return {
    ...(id ? { id } : {}),
    plate: formData.get("plate") || undefined,
    equipmentTypeId: formData.get("equipmentTypeId") || undefined,
    meterType: formData.get("meterType") || undefined,
    performanceUnit: formData.get("performanceUnit") || undefined,
    tankCapacityLiters: formData.get("tankCapacityLiters") || undefined,
    comparisonGroup: formData.get("comparisonGroup") || undefined,
    usualFuelSupplierId: formData.get("usualFuelSupplierId") || undefined,
    compatibleProductIds: formData.getAll("compatibleProductIds"),
    operatingDays: formData.getAll("operatingDays"),
    operatingStart: formData.get("operatingStart") || undefined,
    operatingEnd: formData.get("operatingEnd") || undefined,
    operatingTimezone: formData.get("operatingTimezone") || undefined,
    code: formData.get("code") || undefined,
    brand: formData.get("brand") || undefined,
    model: formData.get("model") || undefined,
    year: formData.get("year") || undefined,
    worksiteId: formData.get("worksiteId") || undefined,
    responsibleUserId: formData.get("responsibleUserId") || undefined,
    operationalStatus: formData.get("operationalStatus") || undefined,
    operationalStatusReason: formData.get("operationalStatusReason") || undefined,
    soapExpiresAt: formData.get("soapExpiresAt") || undefined,
    technicalReviewExpiresAt: formData.get("technicalReviewExpiresAt") || undefined,
    circulationPermitExpiresAt: formData.get("circulationPermitExpiresAt") || undefined,
    insurancePolicyNumber: formData.get("insurancePolicyNumber") || undefined,
    insuranceExpiresAt: formData.get("insuranceExpiresAt") || undefined,
    notes: formData.get("notes") || undefined,
  }
}

function vehicleValues<T extends {
  operatingDays?: number[]
  operatingStart?: string
  operatingEnd?: string
  operatingTimezone?: string
  compatibleProductIds?: string[]
  operationalStatusReason?: string
}>(data: T, typeSlug: string) {
  const { operatingDays, operatingStart, operatingEnd, operatingTimezone, compatibleProductIds, operationalStatusReason, ...values } = data
  return {
    ...values,
    type: typeSlug,
    operatingSchedule: operatingDays?.length && operatingStart && operatingEnd
      ? { timezone: operatingTimezone ?? "America/Santiago", days: [...new Set(operatingDays)].sort(), start: operatingStart, end: operatingEnd }
      : null,
    compatibleProductIds: compatibleProductIds ?? [],
    operationalStatusReason,
  }
}

export async function createFuelVehicleAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  let session
  try { session = await requirePermission("admin:fleet_vehicles", FLEET_CATALOG_PATH) }
  catch { return { ok: false, message: "Sin permisos" } }

  const parsed = createFuelVehicleSchema.safeParse(vehicleFormData(formData))

  if (!parsed.success) {
    return { ok: false, message: "Revisa los datos", fieldErrors: parsed.error.flatten().fieldErrors }
  }

  if (!canManageFuelVehicleWorksite(session, parsed.data.worksiteId)) {
    return { ok: false, message: "No puedes gestionar vehículos para esta faena" }
  }

  try {
    const id = nanoid()
    const equipmentType = await db.query.fuelEquipmentTypes.findFirst({ where: eq(fuelEquipmentTypes.id, parsed.data.equipmentTypeId) })
    if (!equipmentType?.isActive) return { ok: false, message: "El tipo de equipo no existe o está inactivo" }
    const operationalStatus = parsed.data.operationalStatus ?? (await getFleetAdminSettings()).defaultVehicleStatus
    const { compatibleProductIds, operationalStatusReason: _, ...values } = vehicleValues({ ...parsed.data, operationalStatus }, equipmentType.slug)
    const validProducts = await db.query.fuelProducts.findMany({ where: inArray(fuelProducts.id, compatibleProductIds) })
    if (validProducts.length !== compatibleProductIds.length || validProducts.some((product) => !product.isActive)) return { ok: false, message: "Hay productos compatibles inexistentes o inactivos" }
    await db.transaction(async (tx) => {
      await tx.insert(fuelVehicles).values({ id, ...values })
      await tx.insert(fuelVehicleOperationalIntervals).values({
        id: nanoid(),
        vehicleId: id,
        status: operationalStatus,
        startedAt: new Date().toISOString(),
        reason: "Alta inicial del equipo",
        changedBy: session.user.id,
      })
      await tx.insert(fuelVehicleProducts).values(compatibleProductIds.map((productId) => ({ vehicleId: id, productId })))
      await recordAudit({
        userId: session.user.id,
        userEmail: session.user.email ?? undefined,
        action: "create",
        entityType: "fuel_vehicle",
        entityId: id,
        newState: { ...values, compatibleProductIds },
      }, tx)
    })
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
  try { session = await requirePermission("admin:fleet_vehicles", FLEET_CATALOG_PATH) }
  catch { return { ok: false, message: "Sin permisos" } }

  const id = String(formData.get("id") ?? "")
  if (!id) return { ok: false, message: "ID requerido" }

  const parsed = updateFuelVehicleSchema.safeParse(vehicleFormData(formData, id))

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
    const equipmentTypeId = parsed.data.equipmentTypeId ?? existing.equipmentTypeId
    const equipmentType = await db.query.fuelEquipmentTypes.findFirst({ where: eq(fuelEquipmentTypes.id, equipmentTypeId) })
    if (!equipmentType) return { ok: false, message: "El tipo de equipo no existe" }
    const { id: _, ...parsedData } = parsed.data
    const { compatibleProductIds, operationalStatusReason, ...data } = vehicleValues(parsedData, equipmentType.slug)
    const statusChanged = data.operationalStatus !== undefined && data.operationalStatus !== existing.operationalStatus
    if (statusChanged && !operationalStatusReason) {
      return { ok: false, message: "Debes indicar el motivo del cambio de estado", fieldErrors: { operationalStatusReason: ["Motivo requerido al cambiar el estado"] } }
    }
    const validProducts = await db.query.fuelProducts.findMany({ where: inArray(fuelProducts.id, compatibleProductIds) })
    if (validProducts.length !== compatibleProductIds.length || validProducts.some((product) => !product.isActive)) return { ok: false, message: "Hay productos compatibles inexistentes o inactivos" }
    const nextState = { ...data, updatedAt: new Date().toISOString() }
    await db.transaction(async (tx) => {
      await tx.update(fuelVehicles).set(nextState).where(eq(fuelVehicles.id, id))
      if (statusChanged) {
        await setVehicleOperationalStatus(tx, {
          vehicleId: id,
          status: data.operationalStatus!,
          reason: operationalStatusReason!,
          actorUserId: session.user.id,
        })
      }
      await tx.delete(fuelVehicleProducts).where(eq(fuelVehicleProducts.vehicleId, id))
      await tx.insert(fuelVehicleProducts).values(compatibleProductIds.map((productId) => ({ vehicleId: id, productId })))
      await recordAudit({
        userId: session.user.id,
        userEmail: session.user.email ?? undefined,
        action: "update",
        entityType: "fuel_vehicle",
        entityId: id,
        oldState: existing,
        newState: { ...nextState, compatibleProductIds, operationalStatusReason },
      }, tx)
    })
    revalidatePath(FLEET_CATALOG_PATH)
    return { ok: true, message: "Vehículo actualizado" }
  } catch (e) {
    return { ok: false, message: await dbErrMsg(e, "Error al actualizar") }
  }
}

/** Mismo umbral que `operationalStatusReason` (validation.ts) y que las
 *  transiciones de mantención: motivo explicable, no un click vacío. */
const MIN_REASON_LENGTH = 5
const REASON_TOO_SHORT: ActionState = {
  ok: false,
  message: "Debes indicar el motivo del cambio de estado",
  fieldErrors: { reason: ["Explica el motivo en al menos 5 caracteres"] },
}

export async function toggleFuelVehicleActiveAction(id: string, activate: boolean, reason: string): Promise<ActionState> {
  let session
  try { session = await requirePermission("admin:fleet_vehicles", FLEET_CATALOG_PATH) }
  catch { return { ok: false, message: "Sin permisos" } }

  const trimmedReason = reason.trim()
  if (trimmedReason.length < MIN_REASON_LENGTH) return REASON_TOO_SHORT

  const existing = await db.query.fuelVehicles.findFirst({ where: eq(fuelVehicles.id, id) })
  if (!existing) return { ok: false, message: "Vehículo no encontrado" }
  if (!canManageFuelVehicleWorksite(session, existing.worksiteId)) {
    return { ok: false, message: "No puedes gestionar vehículos para esta faena" }
  }

  try {
    // Control optimista (mismo patrón que loads.ts): el estado esperado viaja
    // en el WHERE, no sólo en la lectura previa — CO-025/CO-028 pedía además
    // que la baja quedara auditada, cosa que antes no pasaba en absoluto.
    const updated = await db.transaction(async (tx) => {
      const [row] = await tx.update(fuelVehicles)
        .set({ isActive: activate, updatedAt: new Date().toISOString() })
        .where(and(eq(fuelVehicles.id, id), eq(fuelVehicles.isActive, existing.isActive)))
        .returning({ id: fuelVehicles.id })
      if (!row) return null

      await recordAudit({
        userId: session.user.id,
        userEmail: session.user.email ?? undefined,
        action: "update",
        entityType: "fuel_vehicle",
        entityId: id,
        oldState: { isActive: existing.isActive },
        newState: { isActive: activate, reason: trimmedReason },
      }, tx)
      return row
    })
    if (!updated) {
      return { ok: false, message: "El vehículo cambió en otra sesión. Recarga antes de continuar." }
    }
    revalidatePath(FLEET_CATALOG_PATH)
    return { ok: true, message: activate ? "Vehículo activado" : "Vehículo desactivado" }
  } catch (e) {
    return { ok: false, message: await dbErrMsg(e, activate ? "Error al activar" : "Error al desactivar") }
  }
}

export async function bulkToggleFuelVehicleActiveAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  let session
  try { session = await requirePermission("admin:fleet_vehicles", FLEET_CATALOG_PATH) }
  catch { return { ok: false, message: "Sin permisos" } }

  const idsRaw = formData.get("ids") as string
  const activate = formData.get("activate") === "true"
  const reason = String(formData.get("reason") ?? "").trim()
  if (!idsRaw) return { ok: false, message: "IDs requeridos" }
  if (reason.length < MIN_REASON_LENGTH) return REASON_TOO_SHORT

  const ids = [...new Set(idsRaw.split(",").map((s) => s.trim()).filter(Boolean))]
  if (ids.length === 0) return { ok: false, message: "Selecciona al menos un vehículo" }
  if (ids.length > 100) return { ok: false, message: "Máximo 100 vehículos por operación" }

  try {
    const now = new Date().toISOString()
    const scope = worksiteScopeSql(session, fuelVehicles.worksiteId)
    const where = scope ? and(inArray(fuelVehicles.id, ids), scope) : inArray(fuelVehicles.id, ids)
    const updated = await db.transaction(async (tx) => {
      const visible = await tx.select({ id: fuelVehicles.id, isActive: fuelVehicles.isActive }).from(fuelVehicles).where(where)
      if (visible.length !== ids.length) {
        throw new Error("Uno o más vehículos no existen o están fuera de tu alcance")
      }
      const rows = await tx.update(fuelVehicles)
        .set({ isActive: activate, updatedAt: now })
        .where(where)
        .returning({ id: fuelVehicles.id })
      // Una fila de auditoría por vehículo: un resumen agregado no dice cuál
      // cambió ni desde qué estado (CO-025/CO-028).
      for (const vehicle of visible) {
        await recordAudit({
          userId: session.user.id,
          userEmail: session.user.email ?? undefined,
          action: "update",
          entityType: "fuel_vehicle",
          entityId: vehicle.id,
          oldState: { isActive: vehicle.isActive },
          newState: { isActive: activate, reason },
        }, tx)
      }
      return rows
    })

    revalidatePath(FLEET_CATALOG_PATH)
    return { ok: true, message: `${pluralize(updated.length, "vehículo")} ${pluralize(updated.length, activate ? "activado" : "desactivado", activate ? "activados" : "desactivados")}` }
  } catch (e) {
    return { ok: false, message: await dbErrMsg(e, activate ? "Error al activar" : "Error al desactivar") }
  }
}

export async function importFuelVehiclesFromXlsx(_prev: ActionState, formData: FormData): Promise<ActionState> {
  let session
  try { session = await requirePermission("admin:fleet_vehicles", FLEET_CATALOG_PATH) }
  catch { return { ok: false, message: "Sin permisos" } }

  const file = formData.get("file")
  if (!(file instanceof File) || file.size === 0) return { ok: false, fieldErrors: { file: ["Selecciona un archivo Excel"] } }
  if (!file.name.toLowerCase().endsWith(".xlsx")) return { ok: false, fieldErrors: { file: ["El archivo debe estar en formato .xlsx"] } }
  if (file.size > 6 * 1024 * 1024) return { ok: false, fieldErrors: { file: ["El archivo no puede superar 6 MB"] } }

  const buffer = Buffer.from(await file.arrayBuffer())
  const fileValidation = validateFileBuffer(buffer, file.size, MimeType.SPREADSHEET)
  if (fileValidation.error) return { ok: false, fieldErrors: { file: [fileValidation.error] } }

  const parsed = await parseFleetXlsx(buffer)
  if (parsed.rows.length === 0) {
    return { ok: false, message: parsed.errors[0]?.message ?? "La planilla no contiene vehículos válidos" }
  }

  const [availableWorksites, existingVehicles, equipmentTypes] = await Promise.all([
    db.query.worksites.findMany(),
    db.query.fuelVehicles.findMany(),
    db.query.fuelEquipmentTypes.findMany(),
  ])
  const worksiteByName = new Map(
    availableWorksites
      .filter((worksite) => canManageFuelVehicleWorksite(session, worksite.id))
      .map((worksite) => [worksiteMatchKey(worksite.name), worksite]),
  )
  const vehicleByPlate = new Map(existingVehicles.map((vehicle) => [normalizePlate(vehicle.plate), vehicle]))
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
    return [{ ...row, worksiteId: worksite.id, existing, equipmentTypeSlug: fuelEquipmentTypeSlug(row.type) }]
  })

  let created = 0
  let updated = 0
  try {
    await db.transaction(async (tx) => {
      const equipmentTypeBySlug = new Map(equipmentTypes.map((item) => [item.slug, item]))
      const missingTypes = [...new Map(importable
        .filter((row) => !equipmentTypeBySlug.has(row.equipmentTypeSlug))
        .map((row) => [row.equipmentTypeSlug, row.type])).entries()]
      if (missingTypes.length > 0) {
        const createdTypes = missingTypes.map(([slug, name], index) => ({
          id: `fet-${nanoid()}`,
          slug,
          name,
          category: "other",
          defaultMeterType: "none",
          defaultPerformanceUnit: "not_applicable",
          description: "Tipo creado desde importación Excel; requiere revisión administrativa.",
          sortOrder: 1000 + index,
        }))
        await tx.insert(fuelEquipmentTypes).values(createdTypes)
        for (const item of createdTypes) equipmentTypeBySlug.set(item.slug, { ...item, isSystem: false, isActive: true, createdAt: "", updatedAt: "" })
      }
      for (const row of importable) {
        const equipmentType = equipmentTypeBySlug.get(row.equipmentTypeSlug)!
        // Campos identificatorios: los únicos que trae la planilla y los únicos
        // que puede pisar una reimportación (contrato de fleet-xlsx-import.ts).
        const values = {
          plate: row.plate,
          code: row.code,
          type: equipmentType.slug,
          equipmentTypeId: equipmentType.id,
          brand: row.brand,
          model: row.model,
          year: row.year,
          worksiteId: row.worksiteId,
        }
        // Sólo semillas para el alta: `meterType` y `performanceUnit` son
        // editables por vehículo. Incluirlos en el UPDATE devolvía cada equipo
        // ajustado a mano al default de su tipo en cada reimportación, y con
        // `not_applicable` el vehículo desaparecía del costo por km/hora.
        const defaultsForNewVehicle = {
          meterType: equipmentType.defaultMeterType,
          performanceUnit: equipmentType.defaultPerformanceUnit,
        }
        if (row.existing) {
          updated++
          await tx.update(fuelVehicles).set({ ...values, updatedAt: new Date().toISOString() }).where(eq(fuelVehicles.id, row.existing.id))
        } else {
          created++
          const vehicleId = nanoid()
          const startedAt = new Date().toISOString()
          await tx.insert(fuelVehicles).values({ id: vehicleId, ...values, ...defaultsForNewVehicle })
          await tx.insert(fuelVehicleOperationalIntervals).values({
            id: nanoid(),
            vehicleId,
            status: "operativo",
            startedAt,
            reason: `Alta mediante importación Excel ${file.name}`,
            changedBy: session.user.id,
          })
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
