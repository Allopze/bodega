/**
 * Filas del log operacional que no se pudieron convertir en carga (D-15).
 * Se guardan en `fuel_control_import_rejections` con su motivo y la fila
 * original, y se pueden descargar para corregirlas y reimportarlas.
 */
import { asc, and, eq, sql } from "drizzle-orm"
import ExcelJS from "exceljs"
import { db, type Tx } from "@/db"
import { fuelControlImportRejections } from "@/db/schema"
import { nanoid } from "@/lib/id"
import { addExportMetadataSheet } from "@/lib/combustibles/xlsx-utils"
import { xlsxToBase64 } from "@/lib/reports/export-module/excel-builder"
import type { Session } from "next-auth"

export interface OperationRejection {
  rowIndex: number
  field: string | null
  message: string
  rawRow?: Record<string, unknown> | null
}

const INSERT_CHUNK = 1000

export async function persistOperationRejections(tx: Tx, batchId: string, rejections: OperationRejection[]) {
  for (let index = 0; index < rejections.length; index += INSERT_CHUNK) {
    await tx.insert(fuelControlImportRejections).values(rejections.slice(index, index + INSERT_CHUNK).map((item) => ({
      id: nanoid(),
      batchKind: "operations",
      batchId,
      rowIndex: item.rowIndex,
      field: item.field,
      message: item.message.slice(0, 500),
      rawRow: item.rawRow ?? null,
    })))
  }
}

export async function listOperationRejections(batchId: string, limit?: number) {
  return db.select().from(fuelControlImportRejections)
    .where(and(eq(fuelControlImportRejections.batchKind, "operations"), eq(fuelControlImportRejections.batchId, batchId)))
    .orderBy(asc(fuelControlImportRejections.rowIndex))
    .limit(limit ?? 100_000)
}

export async function countOperationRejections(batchId: string): Promise<number> {
  const [row] = await db.select({ count: sql<number>`count(*)::int` }).from(fuelControlImportRejections)
    .where(and(eq(fuelControlImportRejections.batchKind, "operations"), eq(fuelControlImportRejections.batchId, batchId)))
  return row?.count ?? 0
}

/** Excel con una fila por rechazo: fila, campo, motivo y las columnas originales para corregir y reimportar. */
export async function buildOperationRejectionsXlsx(batchId: string, fileLabel: string, session: Session): Promise<{ base64: string; rowCount: number }> {
  const rows = await listOperationRejections(batchId)
  const rawKeys = [...new Set(rows.flatMap((row) => row.rawRow && typeof row.rawRow === "object" ? Object.keys(row.rawRow as Record<string, unknown>) : []))]
  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet("Filas rechazadas")
  sheet.columns = [
    { header: "Fila del archivo", key: "rowIndex", width: 16 },
    { header: "Campo", key: "field", width: 16 },
    { header: "Motivo", key: "message", width: 60 },
    ...rawKeys.map((key, index) => ({ header: key, key: `raw${index}`, width: 18 })),
  ]
  sheet.getRow(1).font = { bold: true }
  for (const row of rows) {
    const raw = row.rawRow && typeof row.rawRow === "object" ? row.rawRow as Record<string, unknown> : {}
    const values: Record<string, unknown> = { rowIndex: row.rowIndex, field: row.field ?? "", message: row.message }
    rawKeys.forEach((key, index) => {
      const value = raw[key]
      values[`raw${index}`] = value == null ? "" : typeof value === "object" ? JSON.stringify(value) : value
    })
    sheet.addRow(values)
  }
  sheet.views = [{ state: "frozen", ySplit: 1 }]
  addExportMetadataSheet(workbook, session, { filters: { lote: batchId, archivo: fileLabel }, rowCount: rows.length })
  return { base64: await xlsxToBase64(workbook), rowCount: rows.length }
}
