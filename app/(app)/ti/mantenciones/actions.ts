"use server"

import { revalidatePath } from "next/cache"
import { requirePermission } from "@/lib/auth/can"
import { serviceWorksiteScope } from "@/lib/auth/scope"
import { safeActionMessage } from "@/lib/action-error"
import { parseZ } from "@/lib/actions/parse-z"
import { logger } from "@/lib/logger"
import { createMaintenance, updateMaintenance, voidMaintenance } from "@/lib/services/ti/maintenance"
import { itMaintenanceSchema, itMaintenanceVoidSchema } from "@/lib/validation/ti"
import type { ActionState } from "@/lib/validation/masters"

export async function createMaintenanceAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  let session
  try { session = await requirePermission("ti:manage_maintenance") }
  catch { return { ok: false, message: "Sin permisos para registrar mantenciones" } }

  const parsed = parseZ(itMaintenanceSchema, {
    assetId: formData.get("assetId"),
    type: formData.get("type") || undefined,
    date: formData.get("date"),
    reportedIssue: formData.get("reportedIssue"),
    diagnosis: formData.get("diagnosis"),
    workDone: formData.get("workDone"),
    partsUsed: formData.get("partsUsed"),
    supplierId: formData.get("supplierId"),
    technicianName: formData.get("technicianName"),
    technicianUserId: formData.get("technicianUserId"),
    cost: formData.get("cost"),
    observations: formData.get("observations"),
  }, "Revisa los datos de la mantención")
  if (!parsed.ok) return parsed

  try {
    await createMaintenance(parsed.data, {
      userId: session.user.id,
      userEmail: session.user.email ?? undefined,
    }, serviceWorksiteScope(session))
    revalidatePath("/ti")
    revalidatePath("/ti/mantenciones")
    revalidatePath(`/ti/activos/${parsed.data.assetId}`)
    return { ok: true, message: "Mantención registrada" }
  } catch (error) {
    logger.error("[ti:createMaintenance]", error)
    return { ok: false, message: safeActionMessage(error, "Error al registrar la mantención") }
  }
}

export async function updateMaintenanceAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  let session
  try { session = await requirePermission("ti:manage_maintenance") }
  catch { return { ok: false, message: "Sin permisos para editar mantenciones" } }

  const parsed = parseZ(itMaintenanceSchema, {
    id: formData.get("id"),
    assetId: formData.get("assetId"),
    type: formData.get("type") || undefined,
    date: formData.get("date"),
    reportedIssue: formData.get("reportedIssue"),
    diagnosis: formData.get("diagnosis"),
    workDone: formData.get("workDone"),
    partsUsed: formData.get("partsUsed"),
    supplierId: formData.get("supplierId"),
    technicianName: formData.get("technicianName"),
    technicianUserId: formData.get("technicianUserId"),
    cost: formData.get("cost"),
    observations: formData.get("observations"),
  }, "Revisa los datos de la mantención")
  if (!parsed.ok) return parsed
  if (!parsed.data.id) return { ok: false, message: "Mantención no encontrada" }

  try {
    await updateMaintenance(parsed.data as typeof parsed.data & { id: string }, {
      userId: session.user.id,
      userEmail: session.user.email ?? undefined,
    }, serviceWorksiteScope(session))
    revalidatePath("/ti")
    revalidatePath("/ti/mantenciones")
    revalidatePath(`/ti/activos/${parsed.data.assetId}`)
    return { ok: true, message: "Mantención actualizada" }
  } catch (error) {
    logger.error("[ti:updateMaintenance]", error)
    return { ok: false, message: safeActionMessage(error, "Error al actualizar la mantención") }
  }
}

export async function voidMaintenanceAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  let session
  try { session = await requirePermission("ti:manage_maintenance") }
  catch { return { ok: false, message: "Sin permisos para anular mantenciones" } }

  const parsed = parseZ(itMaintenanceVoidSchema, {
    id: formData.get("id"),
    reason: formData.get("reason"),
  }, "Revisa el motivo de la anulación")
  if (!parsed.ok) return parsed

  try {
    const { assetId } = await voidMaintenance(parsed.data.id, parsed.data.reason, {
      userId: session.user.id,
      userEmail: session.user.email ?? undefined,
    }, serviceWorksiteScope(session))
    revalidatePath("/ti")
    revalidatePath("/ti/mantenciones")
    revalidatePath("/ti/reportes")
    revalidatePath("/ti/activos")
    revalidatePath("/ti/garantias")
    revalidatePath(`/ti/activos/${assetId}`)
    return { ok: true, message: "Mantención anulada" }
  } catch (error) {
    logger.error("[ti:voidMaintenance]", error)
    return { ok: false, message: safeActionMessage(error, "Error al anular la mantención") }
  }
}
