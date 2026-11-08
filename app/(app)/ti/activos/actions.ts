"use server"

import { revalidatePath } from "next/cache"
import { requirePermission } from "@/lib/auth/can"
import { serviceWorksiteScope, worksiteScopeSql } from "@/lib/auth/scope"
import { itAssets } from "@/db/schema"
import { safeActionMessage } from "@/lib/action-error"
import { parseZ } from "@/lib/actions/parse-z"
import { logger } from "@/lib/logger"
import { createAsset, updateAsset, changeAssetStatus, listAssets, type AssetListFilters } from "@/lib/services/ti/assets"
import { IT_ASSET_STATUS_META } from "@/lib/services/ti/constants"
import { buildXlsxBuffer } from "@/lib/reports/export-module/excel-builder"
import { recordAudit } from "@/lib/audit"
import { todayInChile } from "@/lib/utils"
import type { ExportActionResult } from "@/components/ui/export-button"
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
    }, serviceWorksiteScope(session))
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
    }, serviceWorksiteScope(session))
    revalidatePath("/ti")
    revalidatePath("/ti/activos")
    revalidatePath(`/ti/activos/${id}`)
    return { ok: true, message: `Activo ${rest.code} actualizado` }
  } catch (error) {
    logger.error("[ti:updateAsset]", error)
    return { ok: false, message: safeActionMessage(error, "Error al actualizar el activo") }
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
    await changeAssetStatus(parsed.data, { userId: session.user.id, userEmail: session.user.email ?? undefined }, serviceWorksiteScope(session))
    revalidatePath("/ti")
    revalidatePath("/ti/activos")
    revalidatePath(`/ti/activos/${parsed.data.assetId}`)
    return { ok: true, message: "Estado actualizado y registrado en el historial" }
  } catch (error) {
    logger.error("[ti:changeAssetStatus]", error)
    return { ok: false, message: safeActionMessage(error, "Error al cambiar el estado") }
  }
}

/** Filtros serializables que el inventario pasa al export (sin `scope` SQL). */
export interface InventoryExportFilters {
  typeId?: string
  status?: string
  workerId?: string
  worksiteId?: string
  supplierId?: string
  warrantyWindow?: AssetListFilters["warrantyWindow"]
  maxAgeYears?: number
  minAgeYears?: number
  repairStuck?: boolean
  search?: string
  order?: AssetListFilters["order"]
  includeRetired?: boolean
}

/**
 * Exporta el inventario con los filtros que el usuario tiene en pantalla, no
 * el catálogo completo de Reportes. El alcance de faena se resuelve de nuevo
 * desde la sesión: los filtros del cliente solo lo acotan.
 */
export async function exportInventoryAction(rawFilters?: InventoryExportFilters): Promise<ExportActionResult> {
  let session
  try { session = await requirePermission("ti:export") }
  catch { return { ok: false, message: "Sin permisos para exportar el inventario" } }

  const scope = worksiteScopeSql(session, itAssets.worksiteId)
  try {
    const rows = await listAssets({ ...rawFilters, scope })
    if (rows.length === 0) return { ok: false, message: "Sin activos para exportar con estos filtros" }

    const buffer = await buildXlsxBuffer({
      filenameBase: "Inventario TI",
      worksheetName: "Inventario",
      headers: [],
      rows: [],
      sheets: [{
        worksheetName: "Inventario",
        headers: [
          "Código", "Activo", "Serie", "Tipo", "Estado", "Faena", "Asignado a",
          "Fecha compra", "Costo", "Garantía", "Mantenciones", "Costo mantención", "Tickets",
        ],
        rows: rows.map((row) => [
          row.code,
          [row.brand, row.model].filter(Boolean).join(" "),
          row.serialNumber ?? "",
          row.typeName,
          IT_ASSET_STATUS_META[row.status]?.label ?? row.status,
          row.worksiteName ?? "",
          row.workerName ?? "",
          row.purchaseDate ?? "",
          row.cost != null ? Number(row.cost) : "",
          row.warrantyEndDate ?? "",
          row.maintenanceCount,
          row.maintenanceCost,
          row.ticketCount,
        ]),
      }],
    })

    await recordAudit({
      userId: session.user.id,
      userEmail: session.user.email ?? undefined,
      action: "export",
      entityType: "it_inventory",
      entityId: "inventario",
      newState: { filters: rawFilters ?? null, rows: rows.length },
    })

    return {
      ok: true,
      data: {
        base64: Buffer.from(buffer).toString("base64"),
        filename: `inventario-ti-${todayInChile()}.xlsx`,
      },
    }
  } catch (error) {
    logger.error("[ti:exportInventory]", error)
    return { ok: false, message: "Error al exportar el inventario" }
  }
}
