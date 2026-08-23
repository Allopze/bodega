"use server"

import { revalidatePath } from "next/cache"
import { requirePermission } from "@/lib/auth/can"
import {
  createWorksiteResource,
  deleteWorksiteResource,
  importWorksiteResources,
} from "@/lib/services/worksite-inventory"

const PERMISSION = "admin:worksite_inventory" as const
const BASE = "/admin/inventario-faena"

export interface InventoryActionState {
  ok: boolean
  message?: string
  /**
   * Resultado de la carga masiva: cuántas entraron y qué filas se rechazaron.
   * Tipado como registro plano para encajar en `OperationResult`, que es lo que
   * consume `useOperation`; el cliente lo reinterpreta como `ImportResult`.
   */
  data?: Record<string, unknown>
}

/**
 * El inventario se refleja en tres lugares: acá, en el plan de emergencias que
 * lo declara y en el picker de sujeto de una inspección nueva. Revalidar sólo
 * esta ruta dejaría a los otros dos mostrando un padrón viejo.
 */
function revalidateInventoryViews() {
  revalidatePath(BASE)
  revalidatePath("/prevencion/emergencias")
  revalidatePath("/prevencion/emergencias/[planId]", "page")
  revalidatePath("/prevencion/inspecciones")
}

async function run(operation: (actorUserId: string, permissions: readonly string[]) => Promise<unknown>): Promise<InventoryActionState> {
  let session
  try { session = await requirePermission(PERMISSION) }
  catch { return { ok: false, message: "Sin permisos" } }

  try {
    const result = await operation(session.user.id, session.user.permissions)
    revalidateInventoryViews()
    return { ok: true, data: (result ?? undefined) as Record<string, unknown> | undefined }
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "No se pudo completar la operación." }
  }
}

export async function createWorksiteResourceAction(input: unknown): Promise<InventoryActionState> {
  return run((userId, permissions) => createWorksiteResource(input, { userId, permissions }))
}

export async function importWorksiteResourcesAction(input: unknown): Promise<InventoryActionState> {
  return run((userId, permissions) => importWorksiteResources(input, { userId, permissions }))
}

export async function deleteWorksiteResourceAction(input: unknown): Promise<InventoryActionState> {
  return run((userId, permissions) => deleteWorksiteResource(input, { userId, permissions }))
}
