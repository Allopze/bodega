"use server"

import { safeActionMessage } from "@/lib/action-error"

import { revalidatePath } from "next/cache"
import { xlsxToBase64 } from "@/lib/reports/export-module/excel-builder"
import { promises as fs } from "node:fs"
import { can, requirePermission } from "@/lib/auth/can"
import { MAINTENANCE_EXPORT_LIMIT, addMaintenanceLabor, addMaintenancePart, addMaintenanceTask, createMaintenanceRecord, decideMaintenanceCostApproval, getMaintenanceExportData, materializeDueMaintenancePlans, saveMaintenanceDocumentPolicy, saveMaintenancePlan, setMaintenanceDocumentPolicyActive, setMaintenancePlanActive, setMaintenanceTaskStatus, transitionMaintenanceRecord, updateMaintenanceRecord, uploadMaintenanceDocument } from "@/lib/services/maintenance"
import { createMaintenanceRecordSchema, maintenanceCostApprovalSchema, maintenanceDocumentMetadataSchema, maintenanceDocumentPolicySchema, maintenanceLaborSchema, maintenancePartSchema, maintenancePlanSchema, maintenanceTaskSchema, transitionMaintenanceRecordSchema, updateMaintenanceRecordSchema } from "@/lib/validation/maintenance"
import type { ActionState } from "@/lib/validation/masters"
import { logger } from "@/lib/logger"
import { addExportMetadataSheet } from "@/lib/reports/export-metadata"
import { recordAudit } from "@/lib/audit"
import { nanoid } from "@/lib/id"
import { todayInChile } from "@/lib/utils"
import { validateFileBuffer, MimeType } from "@/lib/file-validation"
import { createMaintenanceDocumentPath, resolveMaintenanceDir, resolveStorageFile } from "@/lib/storage/config"

export async function createMaintenanceRecordAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  let session
  try { session = await requirePermission("mantenciones:create") }
  catch { return { ok: false, message: "Sin permisos para registrar mantenciones" } }

  const parsed = createMaintenanceRecordSchema.safeParse({
    vehicleId: formData.get("vehicleId"),
    supplierId: formData.get("supplierId") || undefined,
    costCenterId: formData.get("costCenterId") || undefined,
    maintenanceDate: formData.get("maintenanceDate"),
    maintenanceType: formData.get("maintenanceType"),
    status: formData.get("status") || "scheduled",
    odometerReading: formData.get("odometerReading") || null,
    hourMeterReading: formData.get("hourMeterReading") || null,
    netAmount: formData.get("netAmount") || 0,
    taxAmount: formData.get("taxAmount") || 0,
    totalAmount: formData.get("totalAmount") || 0,
    documentNumber: formData.get("documentNumber") || undefined,
    documentName: formData.get("documentName") || undefined,
    notes: formData.get("notes") || undefined,
    priority: formData.get("priority") || "normal",
    assignedToUserId: formData.get("assignedToUserId") || undefined,
    slaDueAt: formData.get("slaDueAt") || null,
    rootCause: formData.get("rootCause") || undefined,
    underWarranty: formData.get("underWarranty") === "on",
    operationalImpact: formData.get("operationalImpact") || "maintenance",
  })

  if (!parsed.success) {
    return { ok: false, message: "Revisa los datos", fieldErrors: parsed.error.flatten().fieldErrors }
  }

  try {
    const id = await createMaintenanceRecord(session, parsed.data)
    revalidatePath("/mantenciones")
    revalidatePath("/flota")
    revalidatePath("/analitica")
    return { ok: true, message: "Mantención registrada", data: { id } }
  } catch (error) {
    logger.error("createMaintenanceRecordAction", { error })
    return { ok: false, message: safeActionMessage(error, "Error al registrar mantención") }
  }
}

export async function updateMaintenanceRecordAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  let session
  try { session = await requirePermission("mantenciones:edit") }
  catch { return { ok: false, message: "Sin permisos para editar mantenciones" } }

  const parsed = updateMaintenanceRecordSchema.safeParse({
    id: formData.get("id"),
    vehicleId: formData.get("vehicleId"),
    supplierId: formData.get("supplierId") || undefined,
    costCenterId: formData.get("costCenterId") || undefined,
    maintenanceDate: formData.get("maintenanceDate"),
    maintenanceType: formData.get("maintenanceType"),
    odometerReading: formData.get("odometerReading") || null,
    hourMeterReading: formData.get("hourMeterReading") || null,
    netAmount: formData.get("netAmount") || 0,
    taxAmount: formData.get("taxAmount") || 0,
    totalAmount: formData.get("totalAmount") || 0,
    documentNumber: formData.get("documentNumber") || undefined,
    documentName: formData.get("documentName") || undefined,
    notes: formData.get("notes") || undefined,
    priority: formData.get("priority") || "normal",
    assignedToUserId: formData.get("assignedToUserId") || undefined,
    slaDueAt: formData.get("slaDueAt") || null,
    rootCause: formData.get("rootCause") || undefined,
    underWarranty: formData.get("underWarranty") === "on",
    operationalImpact: formData.get("operationalImpact") || "maintenance",
  })

  if (!parsed.success) {
    return { ok: false, message: "Revisa los datos", fieldErrors: parsed.error.flatten().fieldErrors }
  }

  try {
    const { id, ...input } = parsed.data
    await updateMaintenanceRecord(session, id, input)
    revalidatePath("/mantenciones")
    revalidatePath(`/mantenciones/${parsed.data.id}`)
    revalidatePath("/flota")
    revalidatePath("/analitica")
    return { ok: true, message: "Mantención actualizada" }
  } catch (error) {
    logger.error("updateMaintenanceRecordAction", { error })
    return { ok: false, message: safeActionMessage(error, "Error al actualizar mantención") }
  }
}

export async function transitionMaintenanceRecordAction(rawInput: unknown): Promise<ActionState> {
  let session
  try { session = await requirePermission("mantenciones:edit") }
  catch { return { ok: false, message: "Sin permisos para cambiar el estado de mantenciones" } }

  const parsed = transitionMaintenanceRecordSchema.safeParse(rawInput)
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Transición inválida" }

  try {
    const result = await transitionMaintenanceRecord(session, parsed.data)
    revalidatePath("/mantenciones")
    revalidatePath("/flota")
    revalidatePath("/analitica")
    revalidatePath("/prevencion/capa")
    revalidatePath("/prevencion/inspecciones")
    revalidatePath("/prevencion/inspecciones/seguimiento")
    revalidatePath("/prevencion/inspecciones/[runId]", "page")
    return { ok: true, message: "Estado de mantención actualizado", data: result }
  } catch (error) {
    logger.error("transitionMaintenanceRecordAction", { error })
    return { ok: false, message: safeActionMessage(error, "Error al cambiar el estado de la mantención") }
  }
}

export async function cancelMaintenanceRecordAction(id: string, expectedStatus: string, reason: string): Promise<ActionState> {
  return transitionMaintenanceRecordAction({ id, expectedStatus, reason, transition: "cancel" })
}

export async function saveMaintenancePlanAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  let session
  try { session = await requirePermission("mantenciones:edit") }
  catch { return { ok: false, message: "Sin permisos para gestionar planes preventivos" } }
  const parsed = maintenancePlanSchema.safeParse({
    id: formData.get("id") || undefined,
    vehicleId: formData.get("vehicleId"),
    name: formData.get("name"),
    maintenanceType: formData.get("maintenanceType"),
    strategy: formData.get("strategy"),
    intervalDays: formData.get("intervalDays") || null,
    intervalUnits: formData.get("intervalUnits") || null,
    advanceDays: formData.get("advanceDays") || 0,
    advanceUnits: formData.get("advanceUnits") || 0,
    nextDueDate: formData.get("nextDueDate") || null,
    nextDueReading: formData.get("nextDueReading") || null,
    assignedToUserId: formData.get("assignedToUserId") || undefined,
    supplierId: formData.get("supplierId") || undefined,
    costCenterId: formData.get("costCenterId") || undefined,
    instructions: formData.get("instructions") || undefined,
  })
  if (!parsed.success) return { ok: false, message: "Revisa los datos del plan", fieldErrors: parsed.error.flatten().fieldErrors }
  try {
    const expectedVersionRaw = formData.get("expectedVersion")
    const id = await saveMaintenancePlan(session, parsed.data, expectedVersionRaw ? Number(expectedVersionRaw) : undefined)
    revalidatePath("/mantenciones")
    revalidatePath("/mantenciones/planes")
    return { ok: true, message: "Plan preventivo guardado", data: { id } }
  } catch (error) {
    logger.error("saveMaintenancePlanAction", { error })
    return { ok: false, message: safeActionMessage(error, "No se pudo guardar el plan") }
  }
}

export async function setMaintenancePlanActiveAction(input: { id: string; active: boolean; expectedVersion: number }): Promise<ActionState> {
  let session
  try { session = await requirePermission("mantenciones:edit") }
  catch { return { ok: false, message: "Sin permisos para gestionar planes preventivos" } }
  try {
    await setMaintenancePlanActive(session, input.id, input.active, input.expectedVersion)
    revalidatePath("/mantenciones/planes")
    return { ok: true, message: input.active ? "Plan activado" : "Plan pausado" }
  } catch (error) {
    return { ok: false, message: safeActionMessage(error, "No se pudo actualizar el plan") }
  }
}

export async function materializeMaintenancePlansAction(): Promise<ActionState> {
  let session
  try { session = await requirePermission("mantenciones:create") }
  catch { return { ok: false, message: "Sin permisos para programar mantenciones" } }
  try {
    const result = await materializeDueMaintenancePlans(session)
    revalidatePath("/mantenciones")
    revalidatePath("/mantenciones/planes")
    return { ok: true, message: result.created === 1 ? "Se programó 1 orden" : `Se programaron ${result.created} órdenes`, data: result }
  } catch (error) {
    return { ok: false, message: safeActionMessage(error, "No se pudieron materializar los planes") }
  }
}

export async function addMaintenanceTaskAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  let session
  try { session = await requirePermission("mantenciones:edit") }
  catch { return { ok: false, message: "Sin permisos para editar la orden" } }
  const parsed = maintenanceTaskSchema.safeParse({ maintenanceId: formData.get("maintenanceId"), description: formData.get("description") })
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Tarea inválida", fieldErrors: parsed.error.flatten().fieldErrors }
  try {
    await addMaintenanceTask(session, parsed.data)
    revalidatePath(`/mantenciones/${parsed.data.maintenanceId}`)
    return { ok: true, message: "Tarea agregada" }
  } catch (error) { return { ok: false, message: safeActionMessage(error, "No se pudo agregar la tarea") } }
}

export async function setMaintenanceTaskStatusAction(input: { taskId: string; maintenanceId: string; completed: boolean }): Promise<ActionState> {
  let session
  try { session = await requirePermission("mantenciones:edit") }
  catch { return { ok: false, message: "Sin permisos para editar la orden" } }
  try {
    await setMaintenanceTaskStatus(session, input.taskId, input.completed)
    revalidatePath(`/mantenciones/${input.maintenanceId}`)
    return { ok: true, message: input.completed ? "Tarea completada" : "Tarea reabierta" }
  } catch (error) { return { ok: false, message: safeActionMessage(error, "No se pudo actualizar la tarea") } }
}

export async function addMaintenancePartAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  let session
  try { session = await requirePermission("mantenciones:edit") }
  catch { return { ok: false, message: "Sin permisos para editar la orden" } }
  const parsed = maintenancePartSchema.safeParse({
    maintenanceId: formData.get("maintenanceId"),
    productId: formData.get("productId") || undefined,
    description: formData.get("description"),
    partNumber: formData.get("partNumber") || undefined,
    quantity: formData.get("quantity"),
    unit: formData.get("unit") || "un",
    unitCost: formData.get("unitCost") || 0,
  })
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Repuesto inválido", fieldErrors: parsed.error.flatten().fieldErrors }
  try {
    await addMaintenancePart(session, parsed.data)
    revalidatePath(`/mantenciones/${parsed.data.maintenanceId}`)
    return { ok: true, message: "Repuesto agregado" }
  } catch (error) { return { ok: false, message: safeActionMessage(error, "No se pudo agregar el repuesto") } }
}

export async function uploadMaintenanceDocumentAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  let session
  try { session = await requirePermission("mantenciones:edit") }
  catch { return { ok: false, message: "Sin permisos para adjuntar documentos" } }
  const parsed = maintenanceDocumentMetadataSchema.safeParse({ maintenanceId: formData.get("maintenanceId"), documentType: formData.get("documentType") })
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Metadatos inválidos" }
  const file = formData.get("file") as File | null
  if (!file || file.size === 0) return { ok: false, message: "Archivo requerido" }
  if (file.size > 20 * 1024 * 1024) return { ok: false, message: "El archivo supera el límite de 20 MB" }
  const fileBuffer = new Uint8Array(await file.arrayBuffer())
  const validation = validateFileBuffer(fileBuffer, file.size, MimeType.PROOF)
  if (validation.error) return { ok: false, message: validation.error }
  const safeName = (file.name || "documento").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 120) || "documento"
  const storageName = `${Date.now()}-${nanoid()}-${safeName}`
  const storageDir = resolveMaintenanceDir()
  const absolutePath = resolveStorageFile(storageDir, storageName)
  await fs.mkdir(storageDir, { recursive: true })
  await fs.writeFile(absolutePath, Buffer.from(fileBuffer))
  try {
    const id = await uploadMaintenanceDocument(session, { ...parsed.data, fileName: safeName, filePath: createMaintenanceDocumentPath(storageName), fileSize: file.size, mimeType: validation.mimeType })
    revalidatePath(`/mantenciones/${parsed.data.maintenanceId}`)
    return { ok: true, message: "Documento adjuntado", data: { id } }
  } catch (error) {
    await fs.unlink(absolutePath).catch(() => undefined)
    logger.error("uploadMaintenanceDocumentAction", { error })
    return { ok: false, message: safeActionMessage(error, "No se pudo adjuntar el documento") }
  }
}

export async function addMaintenanceLaborAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  let session
  try { session = await requirePermission("mantenciones:edit") }
  catch { return { ok: false, message: "Sin permisos para editar la orden" } }
  const parsed = maintenanceLaborSchema.safeParse({ maintenanceId: formData.get("maintenanceId"), description: formData.get("description"), hours: formData.get("hours"), hourlyRate: formData.get("hourlyRate") || 0 })
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Mano de obra inválida", fieldErrors: parsed.error.flatten().fieldErrors }
  try {
    await addMaintenanceLabor(session, parsed.data)
    revalidatePath(`/mantenciones/${parsed.data.maintenanceId}`)
    return { ok: true, message: "Mano de obra agregada" }
  } catch (error) { return { ok: false, message: safeActionMessage(error, "No se pudo agregar la mano de obra") } }
}

export async function decideMaintenanceCostApprovalAction(input: unknown): Promise<ActionState> {
  const parsed = maintenanceCostApprovalSchema.safeParse(input)
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Decisión inválida" }
  let session
  try { session = await requirePermission(parsed.data.decision === "request" ? "mantenciones:edit" : "mantenciones:approve_costs") }
  catch { return { ok: false, message: "Sin permisos para esta decisión de costos" } }
  try {
    const result = await decideMaintenanceCostApproval(session, parsed.data)
    revalidatePath(`/mantenciones/${parsed.data.maintenanceId}`)
    return { ok: true, message: "Estado de aprobación actualizado", data: result }
  } catch (error) { return { ok: false, message: safeActionMessage(error, "No se pudo actualizar la aprobación") } }
}

export async function saveMaintenanceDocumentPolicyAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  let session
  try { session = await requirePermission("mantenciones:edit") }
  catch { return { ok: false, message: "Sin permisos para gestionar políticas documentales" } }
  const parsed = maintenanceDocumentPolicySchema.safeParse({ equipmentTypeId: formData.get("equipmentTypeId"), documentType: formData.get("documentType"), requiredAt: formData.get("requiredAt") })
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Política inválida", fieldErrors: parsed.error.flatten().fieldErrors }
  try {
    await saveMaintenanceDocumentPolicy(session, parsed.data)
    revalidatePath("/mantenciones/politicas-documentales")
    return { ok: true, message: "Política documental guardada" }
  } catch (error) { return { ok: false, message: safeActionMessage(error, "No se pudo guardar la política") } }
}

export async function setMaintenanceDocumentPolicyActiveAction(input: { id: string; active: boolean }): Promise<ActionState> {
  let session
  try { session = await requirePermission("mantenciones:edit") }
  catch { return { ok: false, message: "Sin permisos para gestionar políticas documentales" } }
  try {
    await setMaintenanceDocumentPolicyActive(session, input.id, input.active)
    revalidatePath("/mantenciones/politicas-documentales")
    return { ok: true, message: input.active ? "Política activada" : "Política pausada" }
  } catch (error) { return { ok: false, message: safeActionMessage(error, "No se pudo actualizar la política") } }
}

export async function exportMaintenanceXlsxAction(filters: {
  vehicleId?: string
  worksiteId?: string
  status?: string
  q?: string
} = {}) {
  let session
  try { session = await requirePermission("mantenciones:view", "/mantenciones") }
  catch { return { ok: false as const, message: "Sin permisos para exportar mantenciones" } }

  const canViewCosts = can(session, "combustibles:view_costs")
  const data = await getMaintenanceExportData(session, filters)
  const truncated = data.total > MAINTENANCE_EXPORT_LIMIT
  const ExcelJS = await import("exceljs")
  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet("Mantenciones")
  sheet.columns = [
    { header: "Fecha", key: "date", width: 13 },
    { header: "Vehículo", key: "vehicle", width: 16 },
    { header: "Faena", key: "worksite", width: 24 },
    { header: "Tipo", key: "type", width: 18 },
    { header: "Estado", key: "status", width: 16 },
    { header: "Proveedor", key: "supplier", width: 24 },
    { header: "Centro de costo", key: "costCenter", width: 24 },
    { header: "Kilometraje", key: "odometer", width: 14 },
    { header: "Horómetro", key: "hourMeter", width: 14 },
    { header: "Documento", key: "document", width: 20 },
    { header: "Notas", key: "notes", width: 42 },
    ...(canViewCosts ? [
      { header: "Neto", key: "net", width: 14 },
      { header: "IVA", key: "tax", width: 14 },
      { header: "Total", key: "total", width: 14 },
    ] : []),
  ]
  for (const row of data.records) {
    sheet.addRow({
      date: row.maintenanceDate,
      vehicle: row.vehicle?.plate ?? row.vehicleId,
      worksite: row.worksite?.name ?? "",
      type: row.maintenanceType,
      status: row.status,
      supplier: row.supplier?.name ?? "",
      costCenter: row.costCenter ? `${row.costCenter.code} - ${row.costCenter.name}` : "",
      odometer: row.odometerReading,
      hourMeter: row.hourMeterReading,
      document: row.documentNumber ?? row.documentName ?? "",
      notes: row.notes ?? "",
      ...(canViewCosts ? { net: row.netAmount, tax: row.taxAmount, total: row.totalAmount } : {}),
    })
  }
  sheet.getRow(1).font = { bold: true }
  sheet.views = [{ state: "frozen", ySplit: 1 }]
  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: sheet.columns.length } }
  if (canViewCosts) {
    for (const key of ["net", "tax", "total"]) sheet.getColumn(key).numFmt = "$#,##0"
  }
  addExportMetadataSheet(workbook, session, { filters, rowCount: data.records.length })
  const base64 = await xlsxToBase64(workbook)
  await recordAudit({
    userId: session.user.id,
    userEmail: session.user.email ?? undefined,
    action: "export",
    entityType: "maintenance_export",
    entityId: nanoid(),
    newState: { filters, rowCount: data.records.length, truncated, includesCosts: canViewCosts },
  })
  return {
    ok: true as const,
    data: {
      base64,
      filename: `mantenciones_${todayInChile()}.xlsx`,
      truncated,
      rowLimit: MAINTENANCE_EXPORT_LIMIT,
    },
  }
}
