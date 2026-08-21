"use server"

import { revalidatePath } from "next/cache"
import { requirePermission } from "@/lib/auth/can"
import { createMaintenanceRecord, transitionMaintenanceRecord, updateMaintenanceRecord } from "@/lib/services/maintenance"
import { createMaintenanceRecordSchema, transitionMaintenanceRecordSchema, updateMaintenanceRecordSchema } from "@/lib/validation/maintenance"
import type { ActionState } from "@/lib/validation/masters"
import { logger } from "@/lib/logger"

export async function createMaintenanceRecordAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  let session
  try { session = await requirePermission("mantenciones:create") }
  catch { return { ok: false, message: "Sin permisos para registrar mantenciones" } }

  const parsed = createMaintenanceRecordSchema.safeParse({
    vehicleId: formData.get("vehicleId"),
    supplierId: formData.get("supplierId") || undefined,
    costCenterId: formData.get("costCenterId") || undefined,
    maintenanceDate: formData.get("maintenanceDate"),
    maintenanceType: formData.get("maintenanceType"),
    status: formData.get("status") || "scheduled",
    odometerReading: formData.get("odometerReading") || null,
    hourMeterReading: formData.get("hourMeterReading") || null,
    netAmount: formData.get("netAmount") || 0,
    taxAmount: formData.get("taxAmount") || 0,
    totalAmount: formData.get("totalAmount") || 0,
    documentNumber: formData.get("documentNumber") || undefined,
    documentName: formData.get("documentName") || undefined,
    notes: formData.get("notes") || undefined,
  })

  if (!parsed.success) {
    return { ok: false, message: "Revisa los datos", fieldErrors: parsed.error.flatten().fieldErrors }
  }

  try {
    const id = await createMaintenanceRecord(session, parsed.data)
    revalidatePath("/mantenciones")
    revalidatePath("/flota")
    revalidatePath("/analitica")
    return { ok: true, message: "Mantención registrada", data: { id } }
  } catch (error) {
    logger.error("createMaintenanceRecordAction", { error })
    return { ok: false, message: error instanceof Error ? error.message : "Error al registrar mantención" }
  }
}

export async function updateMaintenanceRecordAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  let session
  try { session = await requirePermission("mantenciones:edit") }
  catch { return { ok: false, message: "Sin permisos para editar mantenciones" } }

  const parsed = updateMaintenanceRecordSchema.safeParse({
    id: formData.get("id"),
    vehicleId: formData.get("vehicleId"),
    supplierId: formData.get("supplierId") || undefined,
    costCenterId: formData.get("costCenterId") || undefined,
    maintenanceDate: formData.get("maintenanceDate"),
    maintenanceType: formData.get("maintenanceType"),
    odometerReading: formData.get("odometerReading") || null,
    hourMeterReading: formData.get("hourMeterReading") || null,
    netAmount: formData.get("netAmount") || 0,
    taxAmount: formData.get("taxAmount") || 0,
    totalAmount: formData.get("totalAmount") || 0,
    documentNumber: formData.get("documentNumber") || undefined,
    documentName: formData.get("documentName") || undefined,
    notes: formData.get("notes") || undefined,
  })

  if (!parsed.success) {
    return { ok: false, message: "Revisa los datos", fieldErrors: parsed.error.flatten().fieldErrors }
  }

  try {
    const { id, ...input } = parsed.data
    await updateMaintenanceRecord(session, id, input)
    revalidatePath("/mantenciones")
    revalidatePath("/flota")
    revalidatePath("/analitica")
    return { ok: true, message: "Mantención actualizada" }
  } catch (error) {
    logger.error("updateMaintenanceRecordAction", { error })
    return { ok: false, message: error instanceof Error ? error.message : "Error al actualizar mantención" }
  }
}

export async function transitionMaintenanceRecordAction(rawInput: unknown): Promise<ActionState> {
  let session
  try { session = await requirePermission("mantenciones:edit") }
  catch { return { ok: false, message: "Sin permisos para cambiar el estado de mantenciones" } }

  const parsed = transitionMaintenanceRecordSchema.safeParse(rawInput)
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Transición inválida" }

  try {
    const result = await transitionMaintenanceRecord(session, parsed.data)
    revalidatePath("/mantenciones")
    revalidatePath("/flota")
    revalidatePath("/analitica")
    revalidatePath("/prevencion/capa")
    return { ok: true, message: "Estado de mantención actualizado", data: result }
  } catch (error) {
    logger.error("transitionMaintenanceRecordAction", { error })
    return { ok: false, message: error instanceof Error ? error.message : "Error al cambiar el estado de la mantención" }
  }
}

export async function cancelMaintenanceRecordAction(id: string, expectedStatus: string, reason: string): Promise<ActionState> {
  return transitionMaintenanceRecordAction({ id, expectedStatus, reason, transition: "cancel" })
}
