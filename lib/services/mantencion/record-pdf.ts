import { promises as fs } from "node:fs"
import { eq } from "drizzle-orm"
import { db } from "@/db"
import { mantRecords } from "@/db/schema"
import { nanoid } from "@/lib/id"
import { createMantencionFilePath, resolveMantencionDir, resolveMantencionFile, resolveStorageFile } from "@/lib/storage/config"
import { PrintRenderError, renderPrintPageToPdf, type PrintCredential } from "@/lib/pdf/render-print-page"
import { PRINT_DOCUMENT_SPECS } from "@/lib/pdf/print-specs"
import { canSeeRecord, recordVisibility, type MantViewer } from "./access"
import { loadRecordAccessRow } from "./records-detail"

/**
 * PDF de un registro firmado (§12). Se imprime en el servidor con Chromium desde
 * la página `/mantencion/registros/{id}/print` (que lee el registro y su snapshot
 * de la base) y se ARCHIVA en `storage/mantencion/{id}-{n}.pdf` la primera vez:
 * después se entrega el mismo archivo, así que un documento firmado no cambia
 * aunque se edite el catálogo. Sólo se regenera cuando cambia el documento, es
 * decir, al anular (el PDF pasa a decir «ANULADO» con su motivo).
 *
 * `n` es la revisión del documento: 1 mientras está vigente, 2 anulado. Por eso
 * un archivo archivado sólo se reutiliza si su nombre es el de la revisión
 * actual: si la anulación no limpió `pdf_storage_key`, igual se regenera.
 */

export type RecordPdfResult =
  | { ok: true; buffer: Buffer; filename: string; generated: boolean; recordId: string; folio: string | null; worksiteId: string }
  | { ok: false; status: 404 | 502; message: string }

/** Revisión del documento: cambia cuando el registro se anula. */
export function pdfRevision(status: string): number {
  return status === "anulado" ? 2 : 1
}

export function pdfStorageName(recordId: string, revision: number): string {
  return `${recordId}-${revision}.pdf`
}

export async function getRecordPdf(input: {
  viewer: MantViewer
  recordId: string
  origin: string
  credential: PrintCredential | null
}): Promise<RecordPdfResult> {
  const record = await loadRecordAccessRow(input.recordId)
  // Mismo 404 para «no existe» y «no es tuyo»: un id ajeno no confirma nada.
  if (!record || !canSeeRecord(recordVisibility(input.viewer), record)) {
    return { ok: false, status: 404, message: "Registro no encontrado" }
  }

  const revision = pdfRevision(record.status)
  const storageName = pdfStorageName(record.id, revision)
  const storageKey = createMantencionFilePath(storageName)
  const base = {
    recordId: record.id,
    folio: record.folio,
    worksiteId: record.worksiteId,
    filename: `mantencion-${record.folio ?? record.id}${record.status === "anulado" ? "-ANULADO" : ""}.pdf`,
  }

  if (record.pdfStorageKey === storageKey) {
    const stored = await readStored(storageKey)
    if (stored) return { ok: true, buffer: stored, generated: false, ...base }
  }

  let buffer: Buffer
  try {
    buffer = await renderPrintPageToPdf({
      origin: input.origin,
      spec: PRINT_DOCUMENT_SPECS.mantencion,
      entityId: record.id,
      credential: input.credential,
    })
  } catch (error) {
    if (error instanceof PrintRenderError) return { ok: false, status: 502, message: "No se pudo generar el PDF del registro" }
    throw error
  }

  // Escritura atómica: dos descargas simultáneas de un registro sin PDF no se pisan a medias.
  const directory = resolveMantencionDir()
  await fs.mkdir(directory, { recursive: true })
  const finalPath = resolveStorageFile(directory, storageName)
  const temporaryPath = `${finalPath}.${nanoid()}.tmp`
  await fs.writeFile(temporaryPath, buffer)
  await fs.rename(temporaryPath, finalPath)
  await db.update(mantRecords)
    .set({ pdfStorageKey: storageKey, pdfGeneratedAt: new Date().toISOString() })
    .where(eq(mantRecords.id, record.id))
  return { ok: true, buffer, generated: true, ...base }
}

async function readStored(storageKey: string): Promise<Buffer | null> {
  const filePath = resolveMantencionFile(storageKey)
  if (!filePath) return null
  try {
    return await fs.readFile(filePath)
  } catch {
    // El archivo no está (volumen restaurado, limpieza): se regenera desde la base.
    return null
  }
}
