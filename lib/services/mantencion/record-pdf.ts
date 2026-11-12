import { createHash } from "node:crypto"
import { promises as fs } from "node:fs"
import { asc, eq } from "drizzle-orm"
import { db } from "@/db"
import { mantRecordCorrectives, mantRecordObservations, mantRecords, mantWorkshopUpdates } from "@/db/schema"
import { workshopState } from "@/lib/mantencion/status"
import { todayInChile } from "@/lib/utils"
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
 * `n` es la revisión del documento: 1 mientras está vigente, 2 anulado, seguida
 * de una huella (`1-ab12cd34ef`) cuando la hoja incluye datos que cambian después
 * de firmar: observaciones y respuestas del supervisor, novedades de taller y,
 * mientras el equipo sigue en taller, el día de hoy (los «días detenido» crecen
 * a diario). Un registro sin nada de eso conserva el nombre sin huella
 * (`{id}-1.pdf`). Un archivo archivado sólo se reutiliza si su nombre es el de
 * la revisión actual: si algo cambió, o la anulación no limpió `pdf_storage_key`,
 * se regenera.
 */

export type RecordPdfResult =
  | { ok: true; buffer: Buffer; filename: string; generated: boolean; recordId: string; folio: string | null; worksiteId: string }
  | { ok: false; status: 404 | 502; message: string }

/** Revisión del documento: cambia cuando el registro se anula. */
export function pdfRevision(status: string): number {
  return status === "anulado" ? 2 : 1
}

export function pdfStorageName(recordId: string, revision: number | string): string {
  return `${recordId}-${revision}.pdf`
}

/**
 * Huella de lo que la hoja imprime y puede cambiar sin tocar el registro firmado.
 * Vacía cuando no hay nada de eso (el nombre queda `{id}-{revisión}.pdf`, como antes).
 * `today` es `todayInChile()` del llamador, para que la función de abajo quede predecible.
 */
export async function pdfMutableFingerprint(recordId: string, status: string, today: string = todayInChile()): Promise<string> {
  const [observations, corrective, updates] = await Promise.all([
    db.select({
      id: mantRecordObservations.id, createdAt: mantRecordObservations.createdAt, respondedAt: mantRecordObservations.respondedAt,
    }).from(mantRecordObservations).where(eq(mantRecordObservations.recordId, recordId)).orderBy(asc(mantRecordObservations.createdAt)),
    db.select({ inWorkshop: mantRecordCorrectives.inWorkshop, entryDate: mantRecordCorrectives.workshopEntryDate, workDate: mantRecords.workDate })
      .from(mantRecordCorrectives).innerJoin(mantRecords, eq(mantRecords.id, mantRecordCorrectives.recordId))
      .where(eq(mantRecordCorrectives.recordId, recordId)).limit(1),
    db.select({
      id: mantWorkshopUpdates.id, kind: mantWorkshopUpdates.kind, createdAt: mantWorkshopUpdates.createdAt, exitDate: mantWorkshopUpdates.exitDate,
    }).from(mantWorkshopUpdates).where(eq(mantWorkshopUpdates.recordId, recordId)).orderBy(asc(mantWorkshopUpdates.createdAt)),
  ])

  const parts: string[] = []
  if (observations.length > 0) {
    parts.push("o", String(observations.length))
    for (const observation of observations) parts.push(observation.id, observation.respondedAt ?? "-")
  }
  if (updates.length > 0) {
    parts.push("u", String(updates.length))
    for (const update of updates) parts.push(update.id, update.kind, update.exitDate ?? "-")
  }
  // Sólo el vigente tiene estado de taller (un anulado no acumula días): mientras sigue en taller
  // la hoja dice «Días detenido» hasta hoy, así que el día entra en la huella.
  const row = corrective[0]
  if (row?.inWorkshop && status === "vigente") {
    const state = workshopState({
      inWorkshop: true,
      entryDate: row.entryDate,
      workDate: row.workDate,
      updates: updates.map((update) => ({ kind: update.kind as "sigue" | "salio", createdDate: todayInChile(update.createdAt), exitDate: update.exitDate })),
    }, today)
    if (state.inWorkshop) parts.push("d", today)
  }
  if (parts.length === 0) return ""
  return createHash("sha256").update(parts.join("|")).digest("hex").slice(0, 10)
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

  const fingerprint = await pdfMutableFingerprint(record.id, record.status)
  const revision = fingerprint ? `${pdfRevision(record.status)}-${fingerprint}` : pdfRevision(record.status)
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
  // El archivo de la revisión anterior ya no lo nombra la fila: se borra (best effort, la descarga lo regenera igual).
  if (record.pdfStorageKey && record.pdfStorageKey !== storageKey) {
    const previous = resolveMantencionFile(record.pdfStorageKey)
    if (previous) await fs.unlink(previous).catch(() => undefined)
  }
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
