"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"
import { db } from "@/db"
import type { ExportActionResult } from "@/components/ui/export-button"
import { actionErrorResult } from "@/lib/actions/action-error-result"
import { guardPermission } from "@/lib/auth/can"
import { createSparePartTx, setSparePartActive, updateSparePart } from "@/lib/services/spare-parts-catalog"
import type { ActionState } from "@/lib/validation/masters"
import { exportSpareParts } from "./export-spare-parts"
import { fieldForServiceMessage, parseSparePartForm } from "./spare-part-form"

/**
 * Acciones del catálogo de repuestos. Cada una exige `repuestos:catalog` EN el
 * servidor (el menú y los botones sólo lo reflejan) y delega en
 * `lib/services/spare-parts-catalog.ts`, que valida y audita.
 *
 * `createSparePartAction` y `updateSparePartAction` son para `useActionState`
 * con el `<form>` del Sheet (`CatalogFormSheet`); la edición recibe el id en un
 * campo oculto `id`.
 */

const PATH = "/mantencion/repuestos"
const PERMISSION = "repuestos:catalog" as const

/** Un error de negocio del servicio bajo su campo (N° de parte repetido, unidad inactiva…) y no sólo en un aviso. */
function failure(error: unknown, fallback: string): ActionState {
  const result = actionErrorResult(error, fallback)
  const field = result.fieldErrors ? null : fieldForServiceMessage(result.message)
  return field ? { ...result, fieldErrors: { [field]: [result.message] } } : result
}

function revalidateCatalog(id?: string) {
  revalidatePath(PATH)
  if (id) revalidatePath(`${PATH}/${id}`)
}

export async function createSparePartAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const guard = await guardPermission(PERMISSION, PATH)
  if (guard.error) return guard.error

  const parsed = parseSparePartForm(formData)
  if (!parsed.ok) return parsed

  try {
    const created = await db.transaction((tx) => createSparePartTx(tx, { ...parsed.data, createdByUserId: guard.session.user.id }))
    revalidateCatalog()
    return { ok: true, message: `Repuesto ${created.sku} creado` }
  } catch (error) {
    return failure(error, "No se pudo crear el repuesto. Inténtalo de nuevo.")
  }
}

export async function updateSparePartAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const guard = await guardPermission(PERMISSION, PATH)
  if (guard.error) return guard.error

  const id = String(formData.get("id") ?? "").trim()
  if (!id) return { ok: false, message: "No se reconoce el repuesto." }
  const parsed = parseSparePartForm(formData)
  if (!parsed.ok) return parsed

  try {
    const updated = await updateSparePart(id, parsed.data, guard.session.user.id)
    revalidateCatalog(id)
    return { ok: true, message: `Repuesto ${updated.sku} actualizado` }
  } catch (error) {
    return failure(error, "No se pudo guardar el repuesto. Inténtalo de nuevo.")
  }
}

const activeSchema = z.object({ id: z.string().trim().min(1).max(64), active: z.boolean() })

/** Activar o desactivar: un repuesto inactivo deja de ofrecerse en el buscador, pero conserva su historial. */
export async function setSparePartActiveAction(input: { id: string; active: boolean }): Promise<ActionState> {
  const guard = await guardPermission(PERMISSION, PATH)
  if (guard.error) return guard.error

  const parsed = activeSchema.safeParse(input)
  if (!parsed.success) return { ok: false, message: "No se reconoce el repuesto." }

  try {
    await setSparePartActive(parsed.data.id, parsed.data.active, guard.session.user.id)
    revalidateCatalog(parsed.data.id)
    return { ok: true, message: parsed.data.active ? "Repuesto activado" : "Repuesto desactivado" }
  } catch (error) {
    return actionErrorResult(error, "No se pudo cambiar el estado del repuesto. Inténtalo de nuevo.")
  }
}

const exportSchema = z.object({ scope: z.enum(["activos", "inactivos"]) })

/** Excel del catálogo, activos o inactivos según la pestaña. Mismo contrato que `ExportButton` (base64). */
export async function exportSparePartsAction(filters: { scope: "activos" | "inactivos" }): Promise<ExportActionResult> {
  const guard = await guardPermission(PERMISSION, PATH)
  if (guard.error) return guard.error

  const parsed = exportSchema.safeParse(filters)
  if (!parsed.success) return { ok: false, message: "Los filtros de la exportación no son válidos." }

  try {
    const { base64, filename } = await exportSpareParts(guard.session, parsed.data.scope)
    return { ok: true, data: { base64, filename } }
  } catch (error) {
    return actionErrorResult(error, "No se pudo generar el Excel. Inténtalo de nuevo.")
  }
}
