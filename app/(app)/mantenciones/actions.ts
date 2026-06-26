"use server"

import { revalidatePath } from "next/cache"
import { requirePermission } from "@/lib/auth/can"
import { createMaintenanceRecord } from "@/lib/services/maintenance"
import { createMaintenanceRecordSchema } from "@/lib/validation/maintenance"
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
    worksiteId: formData.get("worksiteId") || undefined,
    costCenterId: formData.get("costCenterId") || undefined,
    maintenanceDate: formData.get("maintenanceDate"),
    maintenanceType: formData.get("maintenanceType"),
    status: formData.get("status") || "completed",
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
