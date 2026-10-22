"use server"

import { revalidatePath } from "next/cache"
import ExcelJS from "exceljs"
import { guardPermission } from "@/lib/auth/can"
import { MimeType, validateFileBuffer } from "@/lib/file-validation"
import { xlsxToBase64 } from "@/lib/reports/export-module/excel-builder"
import {
  MAX_IMPORT_FILE_BYTES,
  type ControlImportKind,
} from "@/lib/combustibles/control/imports/constants"
import {
  commitControlImport,
  listBatchRejections,
  previewControlImport,
  revertControlImportBatch,
  type ControlImportPreview,
  type ControlImportResult,
} from "@/lib/combustibles/control/imports/service"
import { buildControlImportTemplateBase64, templateFilename } from "@/lib/combustibles/control/imports/templates"

const PATH = "/combustibles/control/importar"

export type PreviewResponse = { ok: true; data: ControlImportPreview } | { ok: false; message: string }
export type ConfirmResponse = { ok: true; data: ControlImportResult } | { ok: false; message: string }

function isKind(value: unknown): value is ControlImportKind {
  return value === "telemetry" || value === "supply_inputs"
}

/** Lee y valida el archivo del FormData: mismas reglas para la vista previa y la confirmación. */
async function readForm(formData: FormData): Promise<
  | { ok: true; kind: ControlImportKind; buffer: Uint8Array; fileName: string; source?: string; supplyMediumId?: string }
  | { ok: false; message: string }
> {
  const kind = formData.get("kind")
  if (!isKind(kind)) return { ok: false, message: "Tipo de importación no reconocido" }
  const file = formData.get("file")
  if (!(file instanceof File) || file.size === 0) return { ok: false, message: "Selecciona un archivo Excel" }
  if (!file.name.toLocaleLowerCase("es-CL").endsWith(".xlsx")) return { ok: false, message: "El archivo debe estar en formato .xlsx" }
  if (file.size > MAX_IMPORT_FILE_BYTES) return { ok: false, message: "El archivo no puede superar 10 MB" }
  const buffer = new Uint8Array(await file.arrayBuffer())
  const validation = validateFileBuffer(buffer, file.size, MimeType.SPREADSHEET)
  if (validation.error) return { ok: false, message: validation.error }
  return {
    ok: true,
    kind,
    buffer,
    fileName: file.name,
    source: String(formData.get("source") ?? "").trim() || undefined,
    supplyMediumId: String(formData.get("supplyMediumId") ?? "").trim() || undefined,
  }
}

export async function previewControlImportAction(formData: FormData): Promise<PreviewResponse> {
  const guard = await guardPermission("combustibles:import", PATH)
  if (guard.error) return guard.error
  const form = await readForm(formData)
  if (!form.ok) return form
  return previewControlImport(guard.session, form.kind, form)
}

export async function confirmControlImportAction(formData: FormData): Promise<ConfirmResponse> {
  const guard = await guardPermission("combustibles:import", PATH)
  if (guard.error) return guard.error
  const form = await readForm(formData)
  if (!form.ok) return form
  const result = await commitControlImport(guard.session, form.kind, form)
  if (result.ok) {
    revalidatePath(PATH)
    revalidatePath("/combustibles/control", "layout")
  }
  return result
}

export async function revertControlImportBatchAction(input: { batchId: string }): Promise<{ ok: boolean; message?: string }> {
  const guard = await guardPermission("combustibles:revert", PATH)
  if (guard.error) return guard.error
  const batchId = String(input?.batchId ?? "").trim()
  if (!batchId) return { ok: false, message: "Lote requerido" }
  const result = await revertControlImportBatch(guard.session, batchId)
  if (!result.ok) return result
  revalidatePath(PATH)
  revalidatePath("/combustibles/control", "layout")
  return { ok: true, message: `Lote revertido: se eliminaron ${result.deletedRows} registros que ese lote había creado` }
}

type DownloadResult = { ok: boolean; data?: { base64: string; filename: string }; message?: string }

/** Plantilla xlsx con los encabezados exactos del importador y la hoja «Instrucciones». */
export async function downloadImportTemplateAction(kind: ControlImportKind): Promise<DownloadResult> {
  const guard = await guardPermission("combustibles:import", PATH)
  if (guard.error) return guard.error
  if (!isKind(kind)) return { ok: false, message: "Tipo de importación no reconocido" }
  return { ok: true, data: { base64: await buildControlImportTemplateBase64(kind), filename: templateFilename(kind) } }
}

/** Filas rechazadas de un lote ya importado, con su motivo, para corregirlas y volver a subirlas. */
export async function exportBatchRejectionsAction(batchId: string): Promise<DownloadResult> {
  const guard = await guardPermission("combustibles:import", PATH)
  if (guard.error) return guard.error
  const result = await listBatchRejections(guard.session, String(batchId ?? ""))
  if (!result.ok) return result
  if (result.rows.length === 0) return { ok: false, message: "Este lote no tiene filas rechazadas" }
  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet("Rechazos")
  // Columnas originales del archivo a continuación del motivo: se corrige y se vuelve a subir.
  const originalKeys = [...new Set(result.rows.flatMap((row) => Object.keys(row.raw ?? {})))].slice(0, 20)
  sheet.columns = [
    { header: "Fila", key: "rowIndex", width: 8 },
    { header: "Campo", key: "field", width: 22 },
    { header: "Motivo", key: "message", width: 70 },
    ...originalKeys.map((key) => ({ header: key, key: `raw:${key}`, width: 18 })),
  ]
  sheet.getRow(1).font = { bold: true }
  for (const row of result.rows) {
    sheet.addRow({
      rowIndex: row.rowIndex, field: row.field, message: row.message,
      ...Object.fromEntries(originalKeys.map((key) => [`raw:${key}`, row.raw?.[key] ?? null])),
    })
  }
  const base = result.fileName.replace(/\.xlsx$/i, "").replace(/[^a-zA-Z0-9._-]+/g, "-").slice(0, 60) || "lote"
  return { ok: true, data: { base64: await xlsxToBase64(workbook), filename: `rechazos-${base}.xlsx` } }
}
