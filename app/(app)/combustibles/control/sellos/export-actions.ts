"use server"

import { can, requirePermission } from "@/lib/auth/can"
import { recordAudit } from "@/lib/audit"
import { nanoid } from "@/lib/id"
import { parseControlFilters } from "@/lib/combustibles/control/filters"
import { getSealJustifications, getSupervisorSealSummary, listSealDetail } from "@/lib/combustibles/control/queries/seals"
import { addTableSheet } from "@/lib/combustibles/control/queries/xlsx-sheet"
import { LOADING_POINT_TYPE_LABELS, SEAL_CHAIN_STATUS_LABELS } from "@/lib/combustibles/control/contracts"
import { addExportMetadataSheet } from "@/lib/combustibles/xlsx-utils"
import { xlsxToBase64 } from "@/lib/reports/export-module/excel-builder"
import { formatDateTime, todayInChile } from "@/lib/utils"
import type { ExportActionResult } from "@/components/ui/export-button"

const MAX_ROWS = 20_000
const MISSING_LABEL = { removed: "Sin sello retirado", installed: "Sin sello nuevo", both: "Sin ningún sello" } as const
const LOADED_AT_SOURCE_LABELS: Record<string, string> = { server: "Servidor", device: "Dispositivo", device_offline: "Dispositivo (sin conexión)", import: "Planilla" }

/**
 * Exporta las cargas en terreno y los sellos con los mismos filtros de la vista
 * (`query` es su query string). Los nombres de conductor y supervisor solo salen
 * con `combustibles:view_personal`; sin él las columnas se omiten.
 */
export async function exportSealsXlsxAction(input: { query: string }): Promise<ExportActionResult> {
  let session
  try {
    session = await requirePermission("combustibles:tae_export", "/combustibles/control/sellos")
    if (!can(session, "combustibles:tae_view")) return { ok: false, message: "Sin permisos" }
  } catch { return { ok: false, message: "Sin permisos" } }

  const query = (input.query ?? "").slice(0, 2000)
  const filters = parseControlFilters(Object.fromEntries(new URLSearchParams(query)))
  const canViewPersonal = can(session, "combustibles:view_personal")
  const access = { canViewPersonal }

  const [supervisors, justifications, detail] = await Promise.all([
    getSupervisorSealSummary(session, filters, access),
    getSealJustifications(session, filters, access),
    listSealDetail(session, filters, { ...access, limit: MAX_ROWS + 1, offset: 0 }),
  ])
  const truncated = detail.rows.length > MAX_ROWS
  const detailRows = truncated ? detail.rows.slice(0, MAX_ROWS) : detail.rows
  const supervisorName = new Map(supervisors.map((row, index) => [row.key, canViewPersonal ? row.name : `Supervisor ${index + 1}`]))

  const ExcelJS = await import("exceljs")
  const wb = new ExcelJS.Workbook()
  addTableSheet(wb, "Resumen supervisores", [
    { header: "Supervisor", key: "name", width: 28 },
    { header: "Cargas", key: "loads", width: 10 },
    { header: "Litros", key: "liters", width: 14, numFmt: "#,##0.0" },
    { header: "Iniciadas sin sello retirado", key: "removed", width: 18 },
    { header: "Terminadas sin sello nuevo", key: "installed", width: 18 },
    { header: "Cadenas de sellos rotas", key: "chain", width: 16 },
  ], supervisors.map((row) => ({
    name: supervisorName.get(row.key) ?? row.name, loads: row.loads, liters: row.liters,
    removed: row.withoutRemovedSeal, installed: row.withoutInstalledSeal, chain: row.chainBreaks,
  })))
  addTableSheet(wb, "Cargas sin sello", [
    { header: "Supervisor", key: "supervisor", width: 28 },
    { header: "Fecha y hora", key: "at", width: 18 },
    { header: "Equipo", key: "equipment", width: 14 },
    { header: "Falta", key: "missing", width: 20 },
    { header: "Motivo declarado", key: "reason", width: 48 },
  ], justifications.map((item) => ({
    supervisor: supervisorName.get(item.supervisorKey) ?? "", at: formatDateTime(item.loadedAt), equipment: item.equipment,
    missing: MISSING_LABEL[item.missing], reason: item.reason ?? "Sin motivo registrado",
  })))
  addTableSheet(wb, "Detalle por equipo", [
    { header: "Fecha y hora", key: "at", width: 18 },
    { header: "Origen de la hora", key: "atSource", width: 22 },
    { header: "Faena", key: "worksite", width: 22 },
    { header: "Equipo", key: "equipment", width: 14 },
    { header: "Patente", key: "plate", width: 12 },
    { header: "Lugar de carga", key: "point", width: 26 },
    { header: "Medio", key: "medium", width: 18 },
    { header: "Litros", key: "liters", width: 12, numFmt: "#,##0.0" },
    { header: "Medidor", key: "meter", width: 12, numFmt: "#,##0" },
    { header: "Unidad del medidor", key: "meterUnit", width: 12 },
    ...(canViewPersonal ? [{ header: "Conductor", key: "driver", width: 24 }, { header: "Supervisor", key: "supervisor", width: 24 }] : []),
    { header: "Sello retirado", key: "removed", width: 14 },
    { header: "Sello nuevo", key: "installed", width: 14 },
    { header: "Cadena de sellos", key: "chain", width: 34 },
    { header: "Observaciones", key: "notes", width: 40 },
  ], detailRows.map((row) => ({
    at: formatDateTime(row.loadedAt), atSource: LOADED_AT_SOURCE_LABELS[row.loadedAtSource] ?? row.loadedAtSource,
    worksite: row.worksiteName, equipment: row.equipment, plate: row.plate,
    point: row.loadingPointType ? LOADING_POINT_TYPE_LABELS[row.loadingPointType] : null, medium: row.mediumName,
    liters: row.liters, meter: row.meterReading, meterUnit: row.meterType === "hour_meter" ? "h" : "km",
    driver: row.driver, supervisor: row.supervisor, removed: row.removedSeal, installed: row.installedSeal,
    chain: SEAL_CHAIN_STATUS_LABELS[row.sealChainStatus],
    notes: [row.noSealReason ? `Sin sello: ${row.noSealReason}` : null, row.notes].filter(Boolean).join(" · ") || null,
  })))
  addExportMetadataSheet(wb, session, { filters, rowCount: detailRows.length, from: filters.from, to: filters.to })

  const base64 = await xlsxToBase64(wb)
  await recordAudit({
    userId: session.user.id, userEmail: session.user.email ?? undefined, action: "export",
    entityType: "fuel_control_seals_export", entityId: nanoid(),
    newState: { rowCount: detailRows.length, truncated, includesPersonal: canViewPersonal, filters: filters as unknown as Record<string, unknown> },
  })
  return { ok: true, data: { base64, filename: `control_sellos_${todayInChile()}.xlsx`, truncated, rowLimit: MAX_ROWS } }
}
