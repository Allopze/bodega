"use server"

import { revalidatePath } from "next/cache"
import { requirePermission } from "@/lib/auth/can"
import { serviceWorksiteScope } from "@/lib/auth/scope"
import { safeActionMessage } from "@/lib/action-error"
import { parseZ } from "@/lib/actions/parse-z"
import { logger } from "@/lib/logger"
import {
  createAssignment, recordAssignmentAcceptance, returnAssignment, transferAssignment,
} from "@/lib/services/ti/assignments"
import {
  itAssignmentAcceptanceSchema, itAssignmentCreateSchema, itAssignmentReturnSchema,
} from "@/lib/validation/ti"
import type { ActionState } from "@/lib/validation/masters"

function parseList(value: FormDataEntryValue | null): string[] {
  if (typeof value !== "string" || !value) return []
  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : []
  } catch {
    return []
  }
}

export async function createAssignmentAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  let session
  try { session = await requirePermission("ti:manage_assets") }
  catch { return { ok: false, message: "Sin permisos para entregar activos" } }

  const parsed = parseZ(itAssignmentCreateSchema, {
    assetId: formData.get("assetId"),
    workerId: formData.get("workerId"),
    worksiteId: formData.get("worksiteId"),
    kind: formData.get("kind") || undefined,
    deliveredAt: formData.get("deliveredAt"),
    physicalState: formData.get("physicalState"),
    observations: formData.get("observations"),
    accessoryNames: parseList(formData.get("accessoriesJson")),
    photoIds: parseList(formData.get("photoIdsJson")),
  }, "Revisa los datos de la entrega")
  if (!parsed.ok) return parsed

  try {
    const assignmentId = await createAssignment(parsed.data, {
      userId: session.user.id,
      userEmail: session.user.email ?? undefined,
    }, serviceWorksiteScope(session))
    revalidatePath("/ti")
    revalidatePath("/ti/asignaciones")
    revalidatePath(`/ti/activos/${parsed.data.assetId}`)
    revalidatePath(`/ti/actas/${assignmentId}/print`)
    return { ok: true, message: "Entrega registrada con su acta", data: { assignmentId } }
  } catch (error) {
    logger.error("[ti:createAssignment]", error)
    return { ok: false, message: safeActionMessage(error, "Error al registrar la entrega") }
  }
}

export async function returnAssignmentAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  let session
  try { session = await requirePermission("ti:manage_assets") }
  catch { return { ok: false, message: "Sin permisos para devolver activos" } }

  const parsed = parseZ(itAssignmentReturnSchema, {
    assignmentId: formData.get("assignmentId"),
    returnedAt: formData.get("returnedAt"),
    returnPhysicalState: formData.get("returnPhysicalState"),
    returnObservations: formData.get("returnObservations"),
    returnedAccessoryNames: parseList(formData.get("returnedAccessoriesJson")),
    nextStatus: formData.get("nextStatus") || undefined,
    photoIds: parseList(formData.get("photoIdsJson")),
  }, "Revisa los datos de la devolución")
  if (!parsed.ok) return parsed

  try {
    await returnAssignment(parsed.data, {
      userId: session.user.id,
      userEmail: session.user.email ?? undefined,
    }, serviceWorksiteScope(session))
    revalidatePath("/ti")
    revalidatePath("/ti/asignaciones")
    revalidatePath(`/ti/activos/${formData.get("assetId") || ""}`)
    revalidatePath(`/ti/actas/${parsed.data.assignmentId}/print`)
    return { ok: true, message: "Devolución registrada" }
  } catch (error) {
    logger.error("[ti:returnAssignment]", error)
    return { ok: false, message: safeActionMessage(error, "Error al registrar la devolución") }
  }
}

export async function transferAssignmentAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  let session
  try { session = await requirePermission("ti:manage_assets") }
  catch { return { ok: false, message: "Sin permisos para transferir activos" } }

  const parsed = parseZ(itAssignmentReturnSchema, {
    assignmentId: formData.get("assignmentId"),
    returnedAt: formData.get("returnedAt"),
    returnPhysicalState: formData.get("returnPhysicalState"),
    returnObservations: formData.get("returnObservations"),
    returnedAccessoryNames: [],
    nextStatus: "disponible",
    photoIds: [],
  }, "Revisa los datos de la devolución")
  if (!parsed.ok) return parsed

  const newAssignment = parseZ(itAssignmentCreateSchema, {
    assetId: formData.get("assetId"),
    workerId: formData.get("newWorkerId"),
    worksiteId: formData.get("newWorksiteId"),
    kind: "transfer",
    deliveredAt: formData.get("newDeliveredAt"),
    physicalState: formData.get("newPhysicalState"),
    observations: formData.get("newObservations"),
    accessoryNames: parseList(formData.get("newAccessoriesJson")),
    photoIds: parseList(formData.get("photoIdsJson")),
  }, "Revisa los datos de la nueva entrega")
  if (!newAssignment.ok) return newAssignment

  try {
    const newId = await transferAssignment({
      assignmentId: parsed.data.assignmentId,
      returnedAt: parsed.data.returnedAt,
      returnPhysicalState: parsed.data.returnPhysicalState,
      returnObservations: parsed.data.returnObservations,
      newWorkerId: newAssignment.data.workerId,
      newWorksiteId: newAssignment.data.worksiteId,
      newDeliveredAt: newAssignment.data.deliveredAt,
      newPhysicalState: newAssignment.data.physicalState,
      newObservations: newAssignment.data.observations,
      newAccessoryNames: newAssignment.data.accessoryNames,
      photoIds: newAssignment.data.photoIds,
    }, {
      userId: session.user.id,
      userEmail: session.user.email ?? undefined,
    }, serviceWorksiteScope(session))
    revalidatePath("/ti")
    revalidatePath("/ti/asignaciones")
    revalidatePath(`/ti/activos/${formData.get("assetId") || ""}`)
    revalidatePath(`/ti/actas/${newId}/print`)
    return { ok: true, message: "Transferencia registrada", data: { assignmentId: newId } }
  } catch (error) {
    logger.error("[ti:transferAssignment]", error)
    return { ok: false, message: safeActionMessage(error, "Error al transferir el activo") }
  }
}

/**
 * TIA-001 / TIA-002: el acuse del acta, que antes se marcaba solo al crearla.
 * Mismo permiso que el resto de la custodia; la segregación —que no sea quien
 * entregó— la aplica el servicio, no esta capa.
 */
export async function recordAssignmentAcceptanceAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  let session
  try { session = await requirePermission("ti:manage_assets") }
  catch { return { ok: false, message: "Sin permisos para registrar el acuse del acta" } }

  const parsed = parseZ(itAssignmentAcceptanceSchema, {
    assignmentId: formData.get("assignmentId"),
    outcome: formData.get("outcome"),
    note: formData.get("note"),
  }, "Revisa los datos del acuse")
  if (!parsed.ok) return parsed

  try {
    await recordAssignmentAcceptance(parsed.data, {
      userId: session.user.id,
      userEmail: session.user.email ?? undefined,
    }, serviceWorksiteScope(session))
    revalidatePath("/ti/asignaciones")
    revalidatePath(`/ti/actas/${parsed.data.assignmentId}/print`)
    return { ok: true, message: parsed.data.outcome === "aceptada"
      ? "Acuse registrado"
      : "Acta cerrada sin acuse, con su motivo" }
  } catch (error) {
    logger.error("[ti:recordAssignmentAcceptance]", error)
    return { ok: false, message: safeActionMessage(error, "Error al registrar el acuse") }
  }
}
