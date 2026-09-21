"use server"

import { revalidatePath } from "next/cache"
import { requirePermission } from "@/lib/auth/can"
import { safeActionMessage } from "@/lib/action-error"
import type { ActionState } from "@/lib/form-state"
import {
  createEmergencyScenarioType,
  setEmergencyScenarioTypeActive,
  updateEmergencyScenarioType,
} from "@/lib/services/prevention-emergency-catalog"

const PATH = "/admin/escenarios-emergencia"
const PERMISSION = "admin:emergency_scenario_catalog"

function errorState(error: unknown, fallback: string): ActionState {
  if (error instanceof Error && /unique|duplicate/i.test(error.message)) {
    return { ok: false, message: "Ya existe un tipo de escenario con ese nombre." }
  }
  return { ok: false, message: safeActionMessage(error, fallback) }
}

function revalidateCatalog() {
  revalidatePath(PATH)
}

export async function createEmergencyScenarioTypeAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  let session
  try { session = await requirePermission(PERMISSION) }
  catch { return { ok: false, message: "No tienes permisos para administrar este catálogo." } }

  try {
    const created = await createEmergencyScenarioType({
      label: formData.get("label"),
      sortOrder: formData.get("sortOrder") ?? "1000",
    }, { userId: session.user.id, userEmail: session.user.email ?? undefined })
    revalidateCatalog()
    return { ok: true, message: `Tipo «${created.label}» creado` }
  } catch (error) {
    return errorState(error, "No se pudo crear el tipo de escenario.")
  }
}

export async function updateEmergencyScenarioTypeAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  let session
  try { session = await requirePermission(PERMISSION) }
  catch { return { ok: false, message: "No tienes permisos para administrar este catálogo." } }

  const code = String(formData.get("code") ?? "").trim()
  if (!code) return { ok: false, message: "No se recibió el tipo que quieres actualizar." }
  try {
    const updated = await updateEmergencyScenarioType(code, {
      label: formData.get("label"),
      sortOrder: formData.get("sortOrder") ?? "1000",
    }, { userId: session.user.id, userEmail: session.user.email ?? undefined })
    revalidateCatalog()
    return { ok: true, message: `Tipo «${updated.label}» actualizado` }
  } catch (error) {
    return errorState(error, "No se pudo actualizar el tipo de escenario.")
  }
}

export async function setEmergencyScenarioTypeActiveAction(code: string, isActive: boolean): Promise<ActionState> {
  let session
  try { session = await requirePermission(PERMISSION) }
  catch { return { ok: false, message: "No tienes permisos para administrar este catálogo." } }

  if (typeof code !== "string" || !code.trim() || code.length > 120 || typeof isActive !== "boolean") {
    return { ok: false, message: "Los datos del tipo de escenario no son válidos." }
  }
  try {
    const updated = await setEmergencyScenarioTypeActive(code, isActive, {
      userId: session.user.id,
      userEmail: session.user.email ?? undefined,
    })
    revalidateCatalog()
    return { ok: true, message: isActive ? `Tipo «${updated.label}» activado` : `Tipo «${updated.label}» desactivado` }
  } catch (error) {
    return errorState(error, "No se pudo cambiar el estado del tipo de escenario.")
  }
}
