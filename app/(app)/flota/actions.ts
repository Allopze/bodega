"use server"

import { revalidatePath } from "next/cache"
import { promises as fs } from "node:fs"
import path from "node:path"
import { can, requirePermission } from "@/lib/auth/can"
import { serviceWorksiteScope } from "@/lib/auth/scope"
import { nanoid } from "@/lib/id"
import { logger } from "@/lib/logger"
import { uploadFleetDocument, deleteFleetDocument, getFleetOverview } from "@/lib/services/fleet"
import { getFleetAdminSettings } from "@/lib/services/system-settings"
import { createFleetDocumentPath, resolveFleetDir } from "@/lib/storage/config"
import { validateFileBuffer, MimeType } from "@/lib/file-validation"
import type { ActionState } from "@/lib/validation/operations"
import { fleetDocumentMetadataSchema } from "@/lib/validation/fleet-documents"
import { addDaysToPlainDate, todayInChile } from "@/lib/utils"
import { filterFleetOverviewRows, type FleetOverviewFilters } from "@/lib/fleet-overview-filters"
import { addExportMetadataSheet } from "@/lib/reports/export-metadata"
import { recordAudit } from "@/lib/audit"

const FLEET_EXPORT_LIMIT = 10_000

export async function uploadFleetDocumentAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  let session
  try { session = await requirePermission("flota:manage_documents") }
  catch { return { ok: false, message: "Sin permisos para subir documentos" } }

  // Tipo y vencimiento entraban crudos: cualquier string se guardaba como tipo
  // documental y una fecha inexistente quedaba en la columna que alimenta las
  // alertas de vencimiento.
  // `formData.get` devuelve `null` cuando el campo no viaja; se normaliza a ""
  // para que el mensaje sea el del esquema y no el genérico de Zod en inglés.
  const parsed = fleetDocumentMetadataSchema.safeParse({
    vehicleId: (formData.get("vehicleId") as string) ?? "",
    documentType: (formData.get("documentType") as string) ?? "",
    expiresAt: (formData.get("expiresAt") as string) || null,
  })
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Revisa los datos del documento" }
  }
  const { vehicleId, documentType, expiresAt } = parsed.data
  const file = formData.get("file") as File | null

  if (!file || file.size === 0) return { ok: false, message: "Archivo requerido" }

  const MAX_MB = 20
  if (file.size > MAX_MB * 1024 * 1024) {
    return { ok: false, message: `El archivo supera el límite de ${MAX_MB} MB` }
  }

  const fileBuf = new Uint8Array(await file.arrayBuffer())
  const validation = validateFileBuffer(fileBuf, file.size, MimeType.PROOF)
  if (validation.error) {
    return { ok: false, message: validation.error }
  }

  const safeName = (file.name || "documento")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120) || "documento"
  const storageName = `${Date.now()}-${nanoid()}-${safeName}`
  const storageDir = resolveFleetDir()
  const relativePath = createFleetDocumentPath(storageName)
  const absolutePath = path.join(storageDir, storageName)

  await fs.mkdir(storageDir, { recursive: true })
  await fs.writeFile(absolutePath, Buffer.from(fileBuf))

  try {
    const docId = await uploadFleetDocument({
      vehicleId,
      documentType,
      fileName: safeName,
      filePath: relativePath,
      fileSize: file.size,
      mimeType: validation.mimeType,
      expiresAt: expiresAt || null,
    }, session, serviceWorksiteScope(session))

    revalidatePath("/flota")
    revalidatePath(`/flota/${vehicleId}`)
    return { ok: true, message: "Documento subido", data: { id: docId } }
  } catch (e) {
    await fs.unlink(absolutePath).catch(() => undefined)
    logger.error("[uploadFleetDocumentAction]", e)
    return { ok: false, message: e instanceof Error ? e.message : "Error al subir documento" }
  }
}

export async function deleteFleetDocumentAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  let session
  try { session = await requirePermission("flota:manage_documents") }
  catch { return { ok: false, message: "Sin permisos para eliminar documentos" } }

  const documentId = formData.get("documentId") as string
  const vehicleId = formData.get("vehicleId") as string
  if (!documentId) return { ok: false, message: "Documento requerido" }

  try {
    await deleteFleetDocument(documentId, session, serviceWorksiteScope(session))
    revalidatePath("/flota")
    if (vehicleId) revalidatePath(`/flota/${vehicleId}`)
    return { ok: true, message: "Documento eliminado" }
  } catch (e) {
    logger.error("[deleteFleetDocumentAction]", e)
    return { ok: false, message: e instanceof Error ? e.message : "Error al eliminar documento" }
  }
}

export async function exportFleetXlsxAction(filters: FleetOverviewFilters = {}) {
  let session
  try { session = await requirePermission("flota:view", "/flota") }
  catch { return { ok: false as const, message: "Sin permisos para exportar la flota" } }

  const [rows, settings] = await Promise.all([getFleetOverview(session), getFleetAdminSettings()])
  const today = todayInChile()
  const filtered = filterFleetOverviewRows(rows, filters, {
    today,
    warningWindowEnd: addDaysToPlainDate(today, settings.warningDays),
  })
  const truncated = filtered.length > FLEET_EXPORT_LIMIT
  const exportRows = filtered.slice(0, FLEET_EXPORT_LIMIT)
  const canViewCosts = can(session, "combustibles:view_costs")
  const canViewFuel = can(session, "combustibles:view")
  const canViewMaintenance = can(session, "mantenciones:view")
  const ExcelJS = await import("exceljs")
  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet("Flota")
  sheet.columns = [
    { header: "Patente", key: "plate", width: 16 },
    { header: "Tipo", key: "type", width: 22 },
    { header: "Marca", key: "brand", width: 18 },
    { header: "Modelo", key: "model", width: 18 },
    { header: "Año", key: "year", width: 10 },
    { header: "Faena", key: "worksite", width: 24 },
    { header: "Estado", key: "status", width: 18 },
    { header: "Responsable", key: "responsible", width: 24 },
    { header: "Próximo vencimiento", key: "expiry", width: 20 },
    ...(canViewFuel ? [
      { header: "Litros (12 meses)", key: "liters", width: 18 },
      { header: "Cargas (12 meses)", key: "loads", width: 18 },
    ] : []),
    ...(canViewMaintenance ? [
      { header: "Mantenciones (12 meses)", key: "maintenanceCount", width: 22 },
      { header: "Última mantención", key: "lastMaintenance", width: 18 },
    ] : []),
    ...(canViewCosts && canViewFuel ? [{ header: "Costo combustible", key: "fuelCost", width: 18 }] : []),
    ...(canViewCosts && canViewMaintenance ? [{ header: "Costo mantenciones", key: "maintenanceCost", width: 20 }] : []),
    ...(canViewCosts && canViewFuel && canViewMaintenance ? [{ header: "Costo operacional", key: "operationalCost", width: 20 }] : []),
  ]
  for (const row of exportRows) {
    sheet.addRow({
      plate: row.plate,
      type: row.type,
      brand: row.brand ?? "",
      model: row.model ?? "",
      year: row.year ?? "",
      worksite: row.worksiteName,
      status: row.isActive ? row.operationalStatus : "inactivo",
      responsible: row.responsibleName ?? "",
      expiry: row.nextExpiryDate ?? "",
      liters: row.totalLiters,
      loads: row.loadCount,
      maintenanceCount: row.maintenanceCount,
      lastMaintenance: row.lastMaintenanceDate,
      fuelCost: row.totalFuelAmount,
      maintenanceCost: row.totalMaintenanceAmount,
      operationalCost: row.totalOperationalCost,
    })
  }
  sheet.getRow(1).font = { bold: true }
  sheet.views = [{ state: "frozen", ySplit: 1 }]
  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: sheet.columns.length } }
  for (const key of ["fuelCost", "maintenanceCost", "operationalCost"]) {
    if (sheet.getColumn(key).number > 0) sheet.getColumn(key).numFmt = "$#,##0"
  }
  addExportMetadataSheet(workbook, session, { filters, rowCount: exportRows.length })
  const bytes = await workbook.xlsx.writeBuffer()
  await recordAudit({
    userId: session.user.id,
    userEmail: session.user.email ?? undefined,
    action: "export",
    entityType: "fleet_export",
    entityId: nanoid(),
    newState: { filters, rowCount: exportRows.length, truncated, includesCosts: canViewCosts },
  })
  return {
    ok: true as const,
    data: {
      base64: Buffer.from(bytes).toString("base64"),
      filename: `flota_${today}.xlsx`,
      truncated,
      rowLimit: FLEET_EXPORT_LIMIT,
    },
  }
}
