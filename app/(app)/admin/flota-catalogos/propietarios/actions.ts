"use server"

import { revalidatePath } from "next/cache"
import { db } from "@/db"
import { isUniqueViolation, safeActionMessage } from "@/lib/action-error"
import { requirePermission } from "@/lib/auth/can"
import type { ActionState } from "@/lib/form-state"
import { createFleetOwnerTx, setFleetOwnerActiveTx, updateFleetOwnerTx } from "@/lib/services/fleet-owners"
import { fleetOwnerSchema } from "@/lib/validation/fleet-owners"

/**
 * Catálogo de empresas propietarias (Administración › Catálogos de flota › Propietarios).
 * Todo exige `admin:fleet_catalog`; el alta en línea desde la ficha del equipo sigue con
 * `admin:fleet_vehicles` (`saveVehicleOwnershipAction`). Ninguna acción escribe la faena.
 */
const PERMISSION = "admin:fleet_catalog"
const DUPLICATE_NAME = "Ya existe una empresa con ese nombre."

function errorState(message: string, field?: "name" | "kind"): ActionState {
  return field ? { ok: false, message, fieldErrors: { [field]: [message] } } : { ok: false, message }
}

/** El nombre y el tipo se ven en la lista de flota y en cada pestaña de la ficha: se refresca todo `/flota`. */
function revalidateAll() {
  revalidatePath("/admin/flota-catalogos/propietarios")
  revalidatePath("/flota", "layout")
}

export async function createFleetOwnerCatalogAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  let session
  try { session = await requirePermission(PERMISSION) }
  catch { return errorState("Sin permisos") }

  const parsed = fleetOwnerSchema.safeParse({ name: formData.get("name"), kind: formData.get("kind") })
  if (!parsed.success) return { ok: false, message: "Revisa los datos", fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]> }

  try {
    const actor = { userId: session.user.id, email: session.user.email }
    const result = await db.transaction((tx) => createFleetOwnerTx(tx, actor, parsed.data))
    if (!result.ok) return errorState(result.message, result.field)
    // En la ficha, repetir un nombre reutiliza la empresa; aquí el usuario pidió una nueva, así que es un error.
    if (!result.data.created) return errorState(DUPLICATE_NAME, "name")
    revalidateAll()
    return { ok: true, message: result.message, data: { id: result.data.id } }
  } catch (error) {
    if (isUniqueViolation(error)) return errorState(DUPLICATE_NAME, "name")
    return errorState(safeActionMessage(error, "No se pudo crear la empresa"))
  }
}

export async function updateFleetOwnerCatalogAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  let session
  try { session = await requirePermission(PERMISSION) }
  catch { return errorState("Sin permisos") }

  const parsed = fleetOwnerSchema.safeParse({ id: formData.get("id") || undefined, name: formData.get("name"), kind: formData.get("kind") })
  if (!parsed.success) return { ok: false, message: "Revisa los datos", fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]> }
  const { id, name, kind } = parsed.data
  if (!id) return errorState("ID requerido")

  try {
    const actor = { userId: session.user.id, email: session.user.email }
    const result = await db.transaction((tx) => updateFleetOwnerTx(tx, actor, { id, name, kind }))
    if (!result.ok) return errorState(result.message, result.field)
    if (result.data.changed) revalidateAll()
    return { ok: true, message: result.message }
  } catch (error) {
    if (isUniqueViolation(error)) return errorState(DUPLICATE_NAME, "name")
    return errorState(safeActionMessage(error, "No se pudo actualizar la empresa"))
  }
}

/** Firma `(prev, formData)` porque la consume `useCatalogSheet`; lee `id` y `activate` del formulario oculto de la lista. */
export async function setFleetOwnerActiveAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  let session
  try { session = await requirePermission(PERMISSION) }
  catch { return errorState("Sin permisos") }

  const id = String(formData.get("id") ?? "")
  const activate = formData.get("activate") === "true"
  if (!id) return errorState("ID requerido")

  try {
    const actor = { userId: session.user.id, email: session.user.email }
    const result = await db.transaction((tx) => setFleetOwnerActiveTx(tx, actor, { id, isActive: activate }))
    if (!result.ok) return errorState(result.message)
    if (result.data.changed) revalidateAll()
    return { ok: true, message: result.message }
  } catch (error) {
    return errorState(safeActionMessage(error, "No se pudo cambiar el estado de la empresa"))
  }
}
