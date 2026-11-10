import ExcelJS from "exceljs"
import type { Session } from "next-auth"
import { recordAudit } from "@/lib/audit"
import { nanoid } from "@/lib/id"
import { addExportMetadataSheet } from "@/lib/reports/export-metadata"
import { xlsxToBase64 } from "@/lib/reports/export-module/excel-builder"
import { styleHeaderRow } from "@/lib/services/mantencion/export-equipment"
import { listSpareParts } from "@/lib/services/spare-parts-catalog"
import { normalizeUnitCode } from "@/lib/services/product-unit-catalog"
import { formatDate, todayInChile } from "@/lib/utils"
import { loadSparePartUnits } from "./unit-options"

/**
 * Excel del catálogo de repuestos: una fila por repuesto con su identidad, el
 * último precio conocido, el precio de referencia de la ficha y cuánto se ha
 * comprado. La unidad va con su nombre del catálogo de unidades, no el código. Lo exporta quien tiene
 * `repuestos:catalog` (la misma puerta que la pantalla).
 */

export type SparePartExportScope = "activos" | "inactivos"

const COLUMNS: Array<{ header: string; key: string; width: number }> = [
  { header: "SKU", key: "sku", width: 12 },
  { header: "Repuesto", key: "name", width: 44 },
  { header: "N° de parte", key: "partNumber", width: 20 },
  { header: "Marca del repuesto", key: "partBrand", width: 20 },
  { header: "Unidad", key: "unit", width: 12 },
  { header: "Proveedor preferido", key: "supplier", width: 28 },
  { header: "Último proveedor", key: "lastSupplier", width: 28 },
  { header: "Último precio (CLP)", key: "lastPrice", width: 18 },
  { header: "Precio de referencia (CLP)", key: "referencePrice", width: 20 },
  { header: "Última compra", key: "lastPurchasedAt", width: 14 },
  { header: "Equipos para los que se compró", key: "vehicleCount", width: 18 },
  { header: "Estado", key: "status", width: 10 },
]

export async function exportSpareParts(
  session: Session,
  scope: SparePartExportScope,
): Promise<{ base64: string; filename: string; rowCount: number }> {
  const [all, units] = await Promise.all([listSpareParts({ includeInactive: true }), loadSparePartUnits()])
  const unitLabels = new Map(units.map((unit) => [unit.code, unit.label]))
  const rows = all.filter((part) => (scope === "activos" ? part.isActive : !part.isActive))

  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet("Repuestos")
  sheet.columns = COLUMNS
  for (const part of rows) {
    sheet.addRow({
      sku: part.sku,
      name: part.name,
      partNumber: part.partNumber ?? "",
      partBrand: part.partBrand ?? "",
      unit: unitLabels.get(normalizeUnitCode(part.unitOfMeasure)) ?? part.unitOfMeasure,
      supplier: part.preferredSupplierName ?? "",
      lastSupplier: part.lastSupplierName ?? "",
      lastPrice: part.lastPrice ?? "",
      referencePrice: part.referencePrice ?? "",
      // Fecha calendario de Chile (el ISO del servicio viene en UTC, con hora).
      lastPurchasedAt: part.lastPurchasedAt ? formatDate(part.lastPurchasedAt) : "",
      vehicleCount: part.vehicleCount,
      status: part.isActive ? "Activo" : "Inactivo",
    })
  }
  sheet.getColumn("lastPrice").numFmt = "#,##0"
  sheet.getColumn("referencePrice").numFmt = "#,##0"
  styleHeaderRow(sheet, COLUMNS.length)
  await addExportMetadataSheet(workbook, session, { filters: { estado: scope }, rowCount: rows.length })

  await recordAudit({
    userId: session.user.id,
    userEmail: session.user.email ?? undefined,
    action: "export",
    entityType: "spare_parts_catalog_export",
    entityId: nanoid(),
    newState: { scope, rowCount: rows.length },
  })

  return {
    base64: await xlsxToBase64(workbook),
    filename: `catalogo-repuestos-${scope}_${todayInChile()}.xlsx`,
    rowCount: rows.length,
  }
}
