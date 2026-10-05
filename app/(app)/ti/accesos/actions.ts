"use server"

import { revalidatePath } from "next/cache"
import { requirePermission } from "@/lib/auth/can"
import { serviceWorksiteScope } from "@/lib/auth/scope"
import { safeActionMessage } from "@/lib/action-error"
import { parseZ } from "@/lib/actions/parse-z"
import { logger } from "@/lib/logger"
import {
  createAccessSystem, toggleAccessSystem, upsertSystemAccess, getSystemAccess,
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
    }, serviceWorksiteScope(session))
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
    }, serviceWorksiteScope(session))
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
    // TIUX-02: antes `|| undefined` volvía "sin cambio" la nota vaciada, así
    // que borrar el texto nunca la borraba. Ahora la cadena vacía llega al
    // servicio y SÍ la limpia; solo un formulario sin el campo (`null`, p. ej.
    // "Revocar" desde un egreso) conserva la nota existente.
    notes: formData.get("notes"),
  }, "Revisa los datos del acceso")
  if (!parsed.ok) return parsed

  try {
    await upsertSystemAccess(parsed.data, {
      userId: session.user.id,
      userEmail: session.user.email ?? undefined,
    }, serviceWorksiteScope(session))
    revalidatePath("/ti/accesos")
    return { ok: true, message: "Acceso actualizado" }
  } catch (error) {
    logger.error("[ti:upsertSystemAccess]", error)
    return { ok: false, message: safeActionMessage(error, "Error al actualizar el acceso") }
  }
}

/**
 * Revoca un acceso (estado "baja") sin tocar sus notas. Es la acción en línea
 * del detalle de un egreso y de la revisión de inactivos (TIUX-19): pasa por
 * `upsertSystemAccess`, o sea las mismas guardas de faena que la hoja normal.
 */
export async function revokeSystemAccessAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  let session
  try { session = await requireTiAccess() }
  catch { return { ok: false, message: "Sin permisos para gestionar accesos" } }

  const systemId = String(formData.get("systemId") ?? "")
  const workerId = String(formData.get("workerId") ?? "")
  if (!systemId || !workerId) return { ok: false, message: "Acceso no especificado" }

  try {
    await upsertSystemAccess({ systemId, workerId, status: "baja" }, {
      userId: session.user.id,
      userEmail: session.user.email ?? undefined,
    }, serviceWorksiteScope(session))
    revalidatePath("/ti/accesos")
    revalidatePath("/ti")
    return { ok: true, message: "Acceso revocado" }
  } catch (error) {
    logger.error("[ti:revokeSystemAccess]", error)
    return { ok: false, message: safeActionMessage(error, "Error al revocar el acceso") }
  }
}

/**
 * Lectura del registro actual de un par (trabajador, sistema) para precargar
 * la hoja "Registrar acceso" con el estado y las notas reales (TIUX-02).
 */
export async function lookupSystemAccessAction(
  workerId: string,
  systemId: string,
): Promise<{ ok: boolean; access: { status: string; notes: string | null } | null }> {
  let session
  try { session = await requireTiAccess() }
  catch { return { ok: false, access: null } }
  if (!workerId || !systemId) return { ok: true, access: null }
  try {
    const row = await getSystemAccess(workerId, systemId, serviceWorksiteScope(session))
    return { ok: true, access: row ? { status: row.status, notes: row.notes } : null }
  } catch (error) {
    logger.error("[ti:lookupSystemAccess]", error)
    return { ok: false, access: null }
  }
}

export async function createChecklistAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  let session
  try { session = await requireTiAccess() }
  catch { return { ok: false, message: "Sin permisos para registrar ingresos y egresos" } }

  const parsed = parseZ(itChecklistSchema, {
    workerId: formData.get("workerId"),
    kind: formData.get("kind"),
    notes: formData.get("notes"),
  }, "Revisa los datos del ingreso o egreso")
  if (!parsed.ok) return parsed

  try {
    await createChecklist(parsed.data, {
      userId: session.user.id,
      userEmail: session.user.email ?? undefined,
    }, serviceWorksiteScope(session))
    revalidatePath("/ti/accesos")
    revalidatePath("/ti")
    return { ok: true, message: "Registro creado" }
  } catch (error) {
    logger.error("[ti:createChecklist]", error)
    return { ok: false, message: safeActionMessage(error, "Error al registrar el ingreso o egreso") }
  }
}

export async function toggleChecklistTaskAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  let session
  try { session = await requireTiAccess() }
  catch { return { ok: false, message: "Sin permisos" } }

  // Si el formulario no trae el campo de nota, se envía `undefined` para que el
  // servicio conserve la nota existente en vez de borrarla.
  const rawNotes = formData.get("notes")
  const parsed = parseZ(itChecklistTaskToggleSchema, {
    taskId: formData.get("taskId"),
    done: formData.get("done") === "on",
    notes: rawNotes === null ? undefined : rawNotes,
  }, "Revisa la tarea")
  if (!parsed.ok) return parsed

  try {
    await toggleChecklistTask(parsed.data, {
      userId: session.user.id,
      userEmail: session.user.email ?? undefined,
    }, serviceWorksiteScope(session))
    revalidatePath("/ti/accesos")
    revalidatePath("/ti")
    return { ok: true, message: parsed.data.done ? "Tarea completada" : "Tarea reabierta" }
  } catch (error) {
    logger.error("[ti:toggleChecklistTask]", error)
    return { ok: false, message: safeActionMessage(error, "Error al actualizar la tarea") }
  }
}
