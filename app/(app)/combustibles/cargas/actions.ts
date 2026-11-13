"use server"

import { xlsxToBase64 } from "@/lib/reports/export-module/excel-builder"
import { requirePermission } from "@/lib/auth/can"
import { recordAudit } from "@/lib/audit"
import { nanoid } from "@/lib/id"
import {
  canViewFuelPersonalData,
  describeFuelLogFilters,
  getFuelLogExportRows,
  getFuelLogRowsBySelection,
  type FuelLogFilters,
  type FuelLogRow,
  type FuelLogSource,
} from "@/lib/combustibles/fuel-log"
import { FUEL_LOAD_ORIGIN_LABEL, fuelLogPending } from "@/lib/combustibles/fuel-log-shared"
import { sanitizeFuelLogFilters } from "@/lib/combustibles/fuel-log-params"
import {
  requestLoadReview,
  resolveFuelLogEntity,
  withdrawLoadReviewRequest,
  type FuelLogEntityContext,
} from "@/lib/combustibles/fuel-log-review-request"
import { FUEL_LOAD_STATUS_LABELS, TAE_STATUS_LABELS } from "@/lib/combustibles/labels"
import { addExportMetadataSheet } from "@/lib/reports/export-metadata"
import { todayInChile } from "@/lib/utils"
import { FUEL_PATHS } from "@/lib/combustibles/routes"
import { revalidateFuel } from "@/lib/combustibles/revalidate"

/** Resuelve la faena y un rótulo legible de una entidad de Cargas. Delega en `lib/`: este archivo sólo puede exportar acciones. */
export async function resolveEntityWorksite(
  entityType: string,
  entityId: string,
): Promise<{ worksiteId: string; worksiteName: string | null; label: string } | null> {
  const ctx: FuelLogEntityContext | null = await resolveFuelLogEntity(entityType, entityId)
  return ctx && ctx.worksiteId ? { worksiteId: ctx.worksiteId, worksiteName: ctx.worksiteName, label: ctx.label } : null
}

type RequestReviewResult = { ok: true; markId: string } | { ok: false; message: string }

/**
 * «Pedir que la revisen»: abre un pedido de revisión con nota (10 a 500
 * caracteres) sobre una carga. Llega a la bandeja «Por revisar». Un pedido ya
 * abierto no se duplica; para volver a pedir, primero se retira o se resuelve.
 */
const FUEL_LOG_SOURCES: readonly FuelLogSource[] = ["tae_pwa", "invoiced", "operation_manual"]

export async function requestReviewAction(source: FuelLogSource, entityId: string, note: string): Promise<RequestReviewResult> {
  // El tipo desaparece en runtime: un `source` inventado hacía que
  // `resolveFuelLogEntity` llegara a un `switch` sin rama y reventara con
  // TypeError en vez de responder un error de validación (6.7).
  if (!FUEL_LOG_SOURCES.includes(source)) return { ok: false, message: "El origen de la carga no es válido." }
  let session
  try { session = await requirePermission("combustibles:view", FUEL_PATHS.cargas) }
  catch { return { ok: false, message: "No tienes permiso para pedir revisiones." } }

  const result = await requestLoadReview(session, { source, entityId, note })
  if (!result.ok) return { ok: false, message: result.message }
  revalidateFuel()
  return { ok: true, markId: result.markId }
}

/** Retira un pedido de revisión abierto. Lo puede hacer quien lo pidió o quien decide sobre las cargas. */
export async function withdrawReviewRequestAction(markId: string): Promise<RequestReviewResult> {
  let session
  try { session = await requirePermission("combustibles:view", FUEL_PATHS.cargas) }
  catch { return { ok: false, message: "No tienes permiso para retirar pedidos de revisión." } }

  const result = await withdrawLoadReviewRequest(session, markId)
  if (!result.ok) return { ok: false, message: result.message }
  revalidateFuel()
  return { ok: true, markId: result.markId }
}

async function buildWorkbook(rows: FuelLogRow[], includePersonal: boolean) {
  const ExcelJS = await import("exceljs")
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet("Cargas de combustible")
  ws.columns = [
    { header: "Fecha y hora", key: "occurredAt", width: 20 },
    { header: "Cómo llegó", key: "origin", width: 26 },
    { header: "Faena", key: "worksiteName", width: 20 },
    { header: "Proveedor", key: "supplierName", width: 18 },
    { header: "Punto de carga", key: "loadingPointName", width: 20 },
    { header: "Código equipo", key: "equipmentCode", width: 14 },
    { header: "Patente", key: "plate", width: 12 },
    { header: "Tipo de equipo", key: "equipmentTypeName", width: 16 },
    // D-10: sin `combustibles:view_personal` las columnas de personas no se exportan.
    ...(includePersonal ? [
      { header: "Conductor", key: "driverName", width: 20 },
      { header: "Supervisor", key: "supervisorName", width: 20 },
    ] : []),
    { header: "Producto", key: "productName", width: 16 },
    { header: "Litros", key: "liters", width: 12 },
    { header: "Medidor", key: "meterReading", width: 12 },
    { header: "Tipo medidor", key: "meterLabel", width: 14 },
    { header: "Rendimiento", key: "performanceValue", width: 12 },
    { header: "Unidad rendimiento", key: "performanceUnit", width: 14 },
    { header: "Sello retirado", key: "sealRemoved", width: 14 },
    { header: "Sello instalado", key: "sealInstalled", width: 14 },
    { header: "Evidencias", key: "evidenceCount", width: 12 },
    { header: "Pendiente", key: "pending", width: 26 },
    { header: "Nota del pedido de revisión", key: "reviewMarkNotes", width: 30 },
    { header: "Observaciones", key: "notes", width: 30 },
    { header: "Estado", key: "statusLabel", width: 16 },
    { header: "Creado por", key: "createdByName", width: 18 },
    { header: "Modificado por", key: "updatedByName", width: 18 },
    { header: "Creado", key: "createdAt", width: 20 },
    { header: "Modificado", key: "updatedAt", width: 20 },
  ]
  ws.getRow(1).font = { bold: true }
  for (const row of rows) {
    ws.addRow({
      ...row,
      origin: FUEL_LOAD_ORIGIN_LABEL[row.origin],
      pending: fuelLogPending(row).map((item) => item.label).join(" · "),
      statusLabel: exportStatusLabel(row),
      liters: Number(row.liters),
      meterReading: row.meterReading == null ? null : Number(row.meterReading),
      performanceValue: row.performanceValue == null ? null : Number(row.performanceValue),
    })
  }
  return wb
}

/** El estado en palabras (el crudo, `submitted` o `importado`, no se exporta). */
function exportStatusLabel(row: FuelLogRow): string {
  if (row.source === "operation_manual") return "Importada"
  const meta = row.source === "tae_pwa" ? TAE_STATUS_LABELS[row.statusLabel ?? ""] : FUEL_LOAD_STATUS_LABELS[row.statusLabel ?? ""]
  return meta?.label ?? row.statusLabel ?? ""
}

function exportFileName(prefix: string) {
  return `${prefix}_${todayInChile()}.xlsx`
}

export async function exportFuelLogAction(rawFilters: FuelLogFilters) {
  let session
  try { session = await requirePermission("combustibles:export", FUEL_PATHS.cargas) }
  catch { return { ok: false as const, message: "Sin permisos para exportar" } }
  const filters = sanitizeFuelLogFilters(rawFilters)

  const { rows, truncated } = await getFuelLogExportRows(session, filters)
  const wb = await buildWorkbook(rows, canViewFuelPersonalData(session))
  await addExportMetadataSheet(wb, session, { filters: await describeFuelLogFilters(filters), rowCount: rows.length, from: filters.from, to: filters.to })
  const base64 = await xlsxToBase64(wb)
  await recordAudit({
    userId: session.user.id, userEmail: session.user.email ?? undefined, action: "export",
    entityType: "fuel_log_export", entityId: nanoid(),
    newState: { rowCount: rows.length, truncated, filters: filters as Record<string, unknown> },
  })
  return {
    ok: true as const,
    data: {
      base64,
      filename: exportFileName("cargas_combustible"),
      truncated,
    },
  }
}

export async function exportFuelLogSelectionAction(selection: Array<{ source: FuelLogSource; id: string }>) {
  let session
  try { session = await requirePermission("combustibles:export", FUEL_PATHS.cargas) }
  catch { return { ok: false as const, message: "Sin permisos para exportar" } }
  if (!selection.length) return { ok: false as const, message: "No hay filas seleccionadas" }

  const rows = await getFuelLogRowsBySelection(session, selection)
  const wb = await buildWorkbook(rows, canViewFuelPersonalData(session))
  await addExportMetadataSheet(wb, session, { rowCount: rows.length })
  const base64 = await xlsxToBase64(wb)
  await recordAudit({
    userId: session.user.id, userEmail: session.user.email ?? undefined, action: "export",
    entityType: "fuel_log_export", entityId: nanoid(),
    newState: { rowCount: rows.length, selectionCount: selection.length },
  })
  return {
    ok: true as const,
    data: {
      base64,
      filename: exportFileName("cargas_combustible_seleccion"),
      truncated: false,
    },
  }
}
