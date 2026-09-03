"use server"

import { revalidatePath } from "next/cache"
import { requirePermission } from "@/lib/auth/can"
import { safeActionMessage } from "@/lib/action-error"
import { parseZ } from "@/lib/actions/parse-z"
import { logger } from "@/lib/logger"
import {
  createAccessSystem, toggleAccessSystem, upsertSystemAccess,
  createChecklist, toggleChecklistTask,
} from "@/lib/services/ti/access"
import {
  itAccessSystemSchema, itSystemAccessSchema, itChecklistSchema, itChecklistTaskToggleSchema,
} from "@/lib/validation/ti"
import type { ActionState } from "@/lib/validation/masters"

function requireTiAccess() {
  return requirePermission("ti:manage_access")
}

export async function createAccessSystemAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  let session
  try { session = await requireTiAccess() }
  catch { return { ok: false, message: "Sin permisos para gestionar accesos" } }

  const parsed = parseZ(itAccessSystemSchema, {
    name: formData.get("name"),
    description: formData.get("description"),
  }, "Revisa los datos del sistema")
  if (!parsed.ok) return parsed

  try {
    await createAccessSystem(parsed.data, {
      userId: session.user.id,
      userEmail: session.user.email ?? undefined,
    })
    revalidatePath("/ti/accesos")
    return { ok: true, message: "Sistema creado" }
  } catch (error) {
    logger.error("[ti:createAccessSystem]", error)
    return { ok: false, message: safeActionMessage(error, "Error al crear el sistema") }
  }
}

export async function toggleAccessSystemAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  let session
  try { session = await requireTiAccess() }
  catch { return { ok: false, message: "Sin permisos" } }

  const systemId = String(formData.get("systemId") ?? "")
  const isActive = formData.get("isActive") === "on"
  if (!systemId) return { ok: false, message: "Sistema no especificado" }

  try {
    await toggleAccessSystem(systemId, isActive, {
      userId: session.user.id,
      userEmail: session.user.email ?? undefined,
    })
    revalidatePath("/ti/accesos")
    return { ok: true, message: isActive ? "Sistema activado" : "Sistema desactivado" }
  } catch (error) {
    logger.error("[ti:toggleAccessSystem]", error)
    return { ok: false, message: safeActionMessage(error, "Error al actualizar el sistema") }
  }
}

export async function upsertSystemAccessAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  let session
  try { session = await requireTiAccess() }
  catch { return { ok: false, message: "Sin permisos para gestionar accesos" } }

  const parsed = parseZ(itSystemAccessSchema, {
    systemId: formData.get("systemId"),
    workerId: formData.get("workerId"),
    status: formData.get("status") || undefined,
    responsibleUserId: session.user.id,
    notes: formData.get("notes"),
  }, "Revisa los datos del acceso")
  if (!parsed.ok) return parsed

  try {
    await upsertSystemAccess(parsed.data, {
      userId: session.user.id,
      userEmail: session.user.email ?? undefined,
    })
    revalidatePath("/ti/accesos")
    return { ok: true, message: "Acceso actualizado" }
  } catch (error) {
    logger.error("[ti:upsertSystemAccess]", error)
    return { ok: false, message: safeActionMessage(error, "Error al actualizar el acceso") }
  }
}

export async function createChecklistAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  let session
  try { session = await requireTiAccess() }
  catch { return { ok: false, message: "Sin permisos para crear checklists" } }

  const parsed = parseZ(itChecklistSchema, {
    workerId: formData.get("workerId"),
    kind: formData.get("kind"),
    notes: formData.get("notes"),
  }, "Revisa los datos del checklist")
  if (!parsed.ok) return parsed

  try {
    await createChecklist(parsed.data, {
      userId: session.user.id,
      userEmail: session.user.email ?? undefined,
    })
    revalidatePath("/ti/accesos")
    return { ok: true, message: "Checklist creado" }
  } catch (error) {
    logger.error("[ti:createChecklist]", error)
    return { ok: false, message: safeActionMessage(error, "Error al crear el checklist") }
  }
}

export async function toggleChecklistTaskAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  let session
  try { session = await requireTiAccess() }
  catch { return { ok: false, message: "Sin permisos" } }

  const parsed = parseZ(itChecklistTaskToggleSchema, {
    taskId: formData.get("taskId"),
    done: formData.get("done") === "on",
    notes: formData.get("notes"),
  }, "Revisa la tarea")
  if (!parsed.ok) return parsed

  try {
    await toggleChecklistTask(parsed.data, {
      userId: session.user.id,
      userEmail: session.user.email ?? undefined,
    })
    revalidatePath("/ti/accesos")
    return { ok: true, message: parsed.data.done ? "Tarea completada" : "Tarea reabierta" }
  } catch (error) {
    logger.error("[ti:toggleChecklistTask]", error)
    return { ok: false, message: safeActionMessage(error, "Error al actualizar la tarea") }
  }
}
