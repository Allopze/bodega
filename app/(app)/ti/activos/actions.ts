"use server"

import { revalidatePath } from "next/cache"
import { requirePermission } from "@/lib/auth/can"
import { safeActionMessage } from "@/lib/action-error"
import { parseZ } from "@/lib/actions/parse-z"
import { logger } from "@/lib/logger"
import { createAsset, updateAsset, softDeleteAsset, changeAssetStatus } from "@/lib/services/ti/assets"
import { itAssetCreateSchema, itAssetUpdateSchema, itAssetStatusChangeSchema, type ItAssetFormData } from "@/lib/validation/ti"
import type { ActionState } from "@/lib/validation/masters"
import type { z } from "zod"

function requireTiManage() {
  return requirePermission("ti:manage_assets")
}

function parseAssetForm(formData: FormData, schema: typeof itAssetCreateSchema | typeof itAssetUpdateSchema) {
  const raw: Record<string, unknown> = {}
  for (const key of ["code", "assetTypeId", "brand", "model", "serialNumber", "status", "worksiteId", "location", "purchaseDate", "supplierId", "purchaseDocType", "purchaseDocRef", "cost", "warrantyEndDate", "processor", "ram", "storage", "os", "observations", "id"]) {
    const value = formData.get(key)
    raw[key] = value
  }
  return parseZ(schema as z.ZodType<ItAssetFormData & { id?: string }>, raw, "Revisa los datos del activo")
}

function formToInput(data: ItAssetFormData) {
  return {
    code: data.code,
    assetTypeId: data.assetTypeId,
    brand: data.brand || null,
    model: data.model || null,
    serialNumber: data.serialNumber || null,
    status: data.status,
    worksiteId: data.worksiteId || null,
    location: data.location || null,
    purchaseDate: data.purchaseDate || null,
    supplierId: data.supplierId || null,
    purchaseDocType: data.purchaseDocType || null,
    purchaseDocRef: data.purchaseDocRef || null,
    cost: data.cost ?? null,
    warrantyEndDate: data.warrantyEndDate || null,
    processor: data.processor || null,
    ram: data.ram || null,
    storage: data.storage || null,
    os: data.os || null,
    observations: data.observations || null,
  }
}

export async function createAssetAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  let session
  try { session = await requireTiManage() }
  catch { return { ok: false, message: "Sin permisos para crear activos" } }

  const parsed = parseAssetForm(formData, itAssetCreateSchema)
  if (!parsed.ok) return parsed

  try {
    const id = await createAsset(formToInput(parsed.data), {
      userId: session.user.id,
      userEmail: session.user.email ?? undefined,
    })
    revalidatePath("/ti")
    revalidatePath("/ti/activos")
    revalidatePath(`/ti/activos/${id}`)
    return { ok: true, message: `Activo ${parsed.data.code} creado`, data: { id } }
  } catch (error) {
    logger.error("[ti:createAsset]", error)
    return { ok: false, message: safeActionMessage(error, "Error al crear el activo") }
  }
}

export async function updateAssetAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  let session
  try { session = await requireTiManage() }
  catch { return { ok: false, message: "Sin permisos para editar activos" } }

  const parsed = parseAssetForm(formData, itAssetUpdateSchema)
  if (!parsed.ok) return parsed

  const { id, ...rest } = parsed.data as ItAssetFormData & { id: string }
  try {
    await updateAsset({ ...formToInput(rest as ItAssetFormData), id }, {
      userId: session.user.id,
      userEmail: session.user.email ?? undefined,
    })
    revalidatePath("/ti")
    revalidatePath("/ti/activos")
    revalidatePath(`/ti/activos/${id}`)
    return { ok: true, message: `Activo ${rest.code} actualizado` }
  } catch (error) {
    logger.error("[ti:updateAsset]", error)
    return { ok: false, message: safeActionMessage(error, "Error al actualizar el activo") }
  }
}

export async function deleteAssetAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  let session
  try { session = await requireTiManage() }
  catch { return { ok: false, message: "Sin permisos para eliminar activos" } }

  const assetId = String(formData.get("assetId") ?? "")
  if (!assetId) return { ok: false, message: "Activo no especificado" }

  try {
    await softDeleteAsset(assetId, { userId: session.user.id, userEmail: session.user.email ?? undefined })
    revalidatePath("/ti")
    revalidatePath("/ti/activos")
    return { ok: true, message: "Activo eliminado del inventario (su historial se conserva)" }
  } catch (error) {
    logger.error("[ti:deleteAsset]", error)
    return { ok: false, message: safeActionMessage(error, "Error al eliminar el activo") }
  }
}

export async function changeAssetStatusAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  let session
  try { session = await requireTiManage() }
  catch { return { ok: false, message: "Sin permisos para cambiar el estado" } }

  const parsed = parseZ(itAssetStatusChangeSchema, {
    assetId: formData.get("assetId"),
    status: formData.get("status"),
    reason: formData.get("reason"),
  }, "Revisa el cambio de estado")
  if (!parsed.ok) return parsed

  try {
    await changeAssetStatus(parsed.data, { userId: session.user.id, userEmail: session.user.email ?? undefined })
    revalidatePath("/ti")
    revalidatePath("/ti/activos")
    revalidatePath(`/ti/activos/${parsed.data.assetId}`)
    return { ok: true, message: "Estado actualizado y registrado en el historial" }
  } catch (error) {
    logger.error("[ti:changeAssetStatus]", error)
    return { ok: false, message: safeActionMessage(error, "Error al cambiar el estado") }
  }
}
