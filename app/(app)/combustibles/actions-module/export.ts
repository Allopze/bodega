"use server"

import { db } from "@/db"
import { fuelLoads } from "@/db/schema"
import { desc } from "drizzle-orm"
import { requirePermission } from "@/lib/auth/can"
import { recordAudit } from "@/lib/audit"
import { nanoid } from "@/lib/id"
import { buildFuelLoadsWhere } from "@/lib/combustibles/queries"
import { addExportMetadataSheet } from "@/lib/combustibles/xlsx-utils"
import { fuelLoadStatusLabel } from "@/lib/combustibles/labels"
import { todayInChile } from "@/lib/utils"

const MAX_FUEL_EXPORT_ROWS = 10_000

export async function optionalNumber(value: FormDataEntryValue | null): Promise<number | null> {
  if (value === null || value === "") return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

export async function exportFuelLoadsXlsxAction(filters?: {
  month?: string
  startDate?: string
  endDate?: string
  serviceType?: string
  vehicleId?: string
  worksiteId?: string
  fuelSupplierId?: string
  product?: string
  productId?: string
  status?: string
}) {
  let session
  // Incluye montos (IEC, IVA, total): requiere el permiso de exportación
  // sensible además del genérico, no sólo "combustibles:export".
  try { session = await requirePermission("combustibles:export_sensitive") }
  catch { return { ok: false as const, message: "Sin permisos para exportar datos con montos" } }

  const where = buildFuelLoadsWhere(session, filters ?? {})

  const rows = await db.query.fuelLoads.findMany({
    where,
    with: { vehicle: true, supplier: true, worksite: true },
    orderBy: [desc(fuelLoads.loadDate)],
    limit: MAX_FUEL_EXPORT_ROWS + 1,
  })
  const truncated = rows.length > MAX_FUEL_EXPORT_ROWS
  const exportRows = truncated ? rows.slice(0, MAX_FUEL_EXPORT_ROWS) : rows

  const ExcelJS = await import("exceljs")
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet("Cargas Combustible")

  ws.columns = [
    { header: "Fecha", key: "loadDate", width: 12 },
    { header: "Mes", key: "month", width: 10 },
    { header: "Servicio", key: "serviceType", width: 10 },
    { header: "Vehículo", key: "vehicle", width: 15 },
    { header: "Proveedor", key: "supplier", width: 15 },
    { header: "Faena", key: "worksite", width: 25 },
    { header: "Producto", key: "product", width: 18 },
    { header: "Nro Factura", key: "receiptNumber", width: 15 },
    { header: "Litros", key: "liters", width: 12 },
    { header: "IEC Fijo", key: "iecFixed", width: 14 },
    { header: "IEC Variable", key: "iecVariable", width: 14 },
    { header: "Base Afecta", key: "baseAmount", width: 16 },
    { header: "IEC Total", key: "iecTotal", width: 14 },
    { header: "IVA", key: "ivaAmount", width: 14 },
    { header: "Total", key: "totalAmount", width: 16 },
    { header: "Estado", key: "status", width: 12 },
  ]

  ws.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } }
  ws.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF2563EB" } }

  for (const row of exportRows) {
    ws.addRow({
      loadDate: row.loadDate, month: row.month, serviceType: row.serviceType,
      vehicle: row.vehicle?.plate ?? "", supplier: row.supplier?.name ?? "",
      worksite: row.worksite?.name ?? "", product: row.product,
      receiptNumber: row.receiptNumber ?? "", liters: row.liters,
      iecFixed: row.iecFixed, iecVariable: row.iecVariable, baseAmount: row.baseAmount,
      iecTotal: row.iecTotal, ivaAmount: row.ivaAmount, totalAmount: row.totalAmount,
      status: fuelLoadStatusLabel(row.status),
    })
  }

  const totalsRow = ws.addRow({
    loadDate: "", month: "", serviceType: "", vehicle: "", supplier: "",
    worksite: "TOTALES", product: "", receiptNumber: "",
    liters: exportRows.reduce((s, r) => s + r.liters, 0),
    iecFixed: exportRows.reduce((s, r) => s + r.iecFixed, 0),
    iecVariable: exportRows.reduce((s, r) => s + r.iecVariable, 0),
    baseAmount: exportRows.reduce((s, r) => s + r.baseAmount, 0),
    iecTotal: exportRows.reduce((s, r) => s + r.iecTotal, 0),
    ivaAmount: exportRows.reduce((s, r) => s + r.ivaAmount, 0),
    totalAmount: exportRows.reduce((s, r) => s + r.totalAmount, 0),
    status: "",
  })
  totalsRow.font = { bold: true }

  for (const col of ["iecFixed", "iecVariable", "baseAmount", "iecTotal", "ivaAmount", "totalAmount"]) {
    ws.getColumn(col).numFmt = "#,##0"
  }
  ws.getColumn("liters").numFmt = "#,##0.00"
  addExportMetadataSheet(wb, session, { filters: filters ?? null, rowCount: exportRows.length, from: filters?.startDate, to: filters?.endDate })

  const buffer = await wb.xlsx.writeBuffer()
  const base64 = Buffer.from(buffer).toString("base64")
  // Esta exportación incluye montos (IEC, IVA, total) — auditarla es más
  // importante que las demás, que sólo exponen datos operativos.
  await recordAudit({
    userId: session.user.id, userEmail: session.user.email ?? undefined, action: "export",
    entityType: "fuel_loads_export", entityId: nanoid(),
    newState: { rowCount: exportRows.length, truncated, filters: (filters ?? {}) as Record<string, unknown>, includesAmounts: true },
  })
  return {
    ok: true as const,
    data: {
      base64,
      filename: `combustibles_${todayInChile()}.xlsx`,
      truncated,
      rowLimit: MAX_FUEL_EXPORT_ROWS,
    },
  }
}
