/**
 * Arma el archivo de cada documento generado a partir de su fila en la cola.
 *
 * Cada tipo lee su registro de origen y decide si la fila sigue describiendo el
 * estado actual. Si no —el mes se volvió a cerrar y su foto anterior se
 * sobrescribió, la inspección se reabrió—, devuelve `superseded` en vez de
 * imprimir otra versión con el nombre de esta.
 *
 * Los PDF se imprimen con la sesión de quien produjo el hecho (o del
 * administrador que reintenta): no hay otra forma de abrir las páginas de
 * impresión. Los Excel se arman en el servidor, sin sesión.
 */
import { eq } from "drizzle-orm"
import { db } from "@/db"
import {
  deliveries,
  pdtpPeriodClosures,
  pdtpPrograms,
  preventionIncidents,
  preventionInspectionRuns,
  preventionRiskMatrices,
  sstEvaluations,
  workers,
  type GeneratedDocumentArchive,
} from "@/db/schema"
import { PRINT_DOCUMENT_SPECS, type PrintDocumentId } from "@/lib/pdf/print-specs"
import { PrintRenderError, renderPrintPageToPdf, type PrintCredential } from "@/lib/pdf/render-print-page"
import { buildXlsxBuffer } from "@/lib/reports/export-module/excel-builder"
import { buildMiperWorkbook, miperFilenameBase } from "@/lib/reports/miper-workbook"
import { renderPdtpRe36Buffer } from "@/lib/reports/pdtp-re36-workbook"
import { buildPdtpRe36Document } from "@/lib/services/pdtp/re36-document"
import { pdtpClosureFilenameBase, pdtpClosureSheet } from "@/lib/services/pdtp/period-closure-export"
import type { PdtpPeriodClosureSnapshot } from "@/lib/services/pdtp/period-closures"
import { buildIncidentCaseArchive } from "@/lib/services/prevention-incident-export"
import { getPublishedRiskMatrixForArchive } from "@/lib/services/prevention-risk-legal"
import { buildActaFilename } from "@/lib/sst/acta-filename"
import { isGeneratedDocumentKind } from "./kinds"

export type GeneratedDocumentErrorCode =
  | "RENDER_UNAUTHORIZED"
  | "RENDER_CREDENTIAL_MISSING"
  | "RENDER_FAILED"
  | "PDF_ORIGIN_NOT_CONFIGURED"
  | "INVALID_OUTPUT"
  | "SOURCE_NOT_FOUND"

export class GeneratedDocumentError extends Error {
  constructor(readonly code: GeneratedDocumentErrorCode, message: string, readonly transient = false) {
    super(message)
    this.name = "GeneratedDocumentError"
  }
}

export type ProducedDocument =
  | { outcome: "document"; buffer: Buffer; baseName: string }
  | { outcome: "superseded" }

export interface ProduceContext {
  /** Sesión para imprimir los PDF; null en el cron. */
  credential: PrintCredential | null
  /** Origen interno para imprimir (`resolveInternalRenderOrigin`); null si no está configurado. */
  origin: string | null
}

type Row = Pick<GeneratedDocumentArchive, "kind" | "entityId" | "milestone" | "revision">

const SUPERSEDED: ProducedDocument = { outcome: "superseded" }

/** Nombre de un documento que no tiene uno propio, a partir de su hito. */
function withMilestone(base: string, milestone: string): string {
  return `${base} - ${milestone}`
}

async function renderPdf(spec: PrintDocumentId, entityId: string, ctx: ProduceContext): Promise<Buffer> {
  if (!ctx.credential) {
    throw new GeneratedDocumentError("RENDER_CREDENTIAL_MISSING", "Sin sesión para imprimir el documento")
  }
  if (!ctx.origin) throw new GeneratedDocumentError("PDF_ORIGIN_NOT_CONFIGURED", "Sin origen para imprimir")
  try {
    return await renderPrintPageToPdf({
      origin: ctx.origin,
      spec: PRINT_DOCUMENT_SPECS[spec],
      entityId,
      credential: ctx.credential,
    })
  } catch (error) {
    if (error instanceof PrintRenderError) {
      // Un render que no pudo abrir la página puede ser un navegador caído:
      // se reintenta una vez. La falta de acceso no se arregla reintentando.
      throw new GeneratedDocumentError(error.code, error.message, error.code === "RENDER_FAILED")
    }
    throw new GeneratedDocumentError("RENDER_FAILED", error instanceof Error ? error.message : "Render fallido", true)
  }
}

function xlsxBuffer(data: ArrayBuffer | Uint8Array | Buffer): Buffer {
  return Buffer.isBuffer(data) ? data : Buffer.from(data instanceof Uint8Array ? data : new Uint8Array(data))
}

async function produceEntrega(row: Row, ctx: ProduceContext): Promise<ProducedDocument> {
  const [delivery] = await db.select({ code: deliveries.code, voidedAt: deliveries.voidedAt })
    .from(deliveries).where(eq(deliveries.id, row.entityId)).limit(1)
  if (!delivery) throw new GeneratedDocumentError("SOURCE_NOT_FOUND", "La entrega ya no existe")
  // Si se anuló antes de imprimir la copia «registrada», esa copia saldría con
  // el aviso de anulación: la de «anulada» ya lo cubre.
  if (row.milestone === "registrada" && delivery.voidedAt) return SUPERSEDED
  if (row.milestone === "anulada" && !delivery.voidedAt) return SUPERSEDED
  const buffer = await renderPdf("entrega", row.entityId, ctx)
  return { outcome: "document", buffer, baseName: withMilestone(`Comprobante de entrega ${delivery.code}`, row.milestone) }
}

const INSPECTION_STATUS_BY_MILESTONE: Record<string, string> = { completada: "completed", revisada: "reviewed" }

async function produceInspeccion(row: Row, ctx: ProduceContext): Promise<ProducedDocument> {
  const [run] = await db.select({ code: preventionInspectionRuns.code, status: preventionInspectionRuns.status, version: preventionInspectionRuns.version })
    .from(preventionInspectionRuns).where(eq(preventionInspectionRuns.id, row.entityId)).limit(1)
  if (!run) throw new GeneratedDocumentError("SOURCE_NOT_FOUND", "La inspección ya no existe")
  // La versión se mueve con cada cambio del run: si ya no es la del hecho, la
  // inspección se revisó, se reabrió o se volvió a cerrar, y esa otra fila
  // tiene su propia copia.
  if (run.version !== row.revision || run.status !== INSPECTION_STATUS_BY_MILESTONE[row.milestone]) return SUPERSEDED
  const buffer = await renderPdf("inspeccion", row.entityId, ctx)
  return { outcome: "document", buffer, baseName: withMilestone(run.code, row.milestone) }
}

/** Nombre del acta tal como lo descarga el usuario, sin la extensión. */
export async function actaSstBaseName(evaluationId: string): Promise<string | null> {
  const [row] = await db.select({ tipo: sstEvaluations.tipo, firstName: workers.firstName, lastName: workers.lastName })
    .from(sstEvaluations).innerJoin(workers, eq(workers.id, sstEvaluations.workerId))
    .where(eq(sstEvaluations.id, evaluationId)).limit(1)
  if (!row) return null
  return buildActaFilename({ tipo: row.tipo, workerName: `${row.firstName} ${row.lastName}` }).replace(/\.pdf$/i, "")
}

async function produceActaSst(row: Row, ctx: ProduceContext): Promise<ProducedDocument> {
  const baseName = await actaSstBaseName(row.entityId)
  if (!baseName) throw new GeneratedDocumentError("SOURCE_NOT_FOUND", "La evaluación ya no existe")
  const buffer = await renderPdf("sst", row.entityId, ctx)
  return { outcome: "document", buffer, baseName }
}

async function producePdtpCierre(row: Row): Promise<ProducedDocument> {
  const [closure] = await db.select().from(pdtpPeriodClosures).where(eq(pdtpPeriodClosures.id, row.entityId)).limit(1)
  if (!closure) throw new GeneratedDocumentError("SOURCE_NOT_FOUND", "El cierre ya no existe")
  // Cerrar otra vez el mismo mes sobrescribe la foto: la de esta versión ya no
  // se puede reconstruir y lo que se imprimiera sería otra.
  if (closure.version !== row.revision) return SUPERSEDED
  const snapshot = closure.snapshotJson as PdtpPeriodClosureSnapshot
  // Sin `session`: la hoja de metadatos describe a quien descarga, y acá no
  // descarga nadie.
  const data = await renderPdtpRe36Buffer(snapshot.re36, { closure: pdtpClosureSheet(closure, snapshot) })
  return { outcome: "document", buffer: xlsxBuffer(data), baseName: pdtpClosureFilenameBase(closure, snapshot) }
}

async function producePdtpRe36(row: Row): Promise<ProducedDocument> {
  const separator = row.entityId.indexOf(":")
  const programId = row.entityId.slice(0, separator)
  const worksiteId = row.entityId.slice(separator + 1)
  if (separator <= 0 || !worksiteId) throw new GeneratedDocumentError("SOURCE_NOT_FOUND", "Referencia de programa inválida")
  const [program] = await db.select({ status: pdtpPrograms.status, version: pdtpPrograms.version })
    .from(pdtpPrograms).where(eq(pdtpPrograms.id, programId)).limit(1)
  if (!program) throw new GeneratedDocumentError("SOURCE_NOT_FOUND", "El programa ya no existe")
  // La copia es la del programa al entrar en vigencia: si ya dejó de estar
  // vigente, lo que se imprimiera ahora sería otro estado.
  if (program.status !== "active" || program.version !== row.revision) return SUPERSEDED
  const doc = await buildPdtpRe36Document({ programId, worksiteId, scope: "all" })
  const data = await renderPdtpRe36Buffer(doc)
  return {
    outcome: "document",
    buffer: xlsxBuffer(data),
    baseName: `RE-36-PDTP-${doc.program.year}-${doc.worksite.code}-v${doc.program.version}`,
  }
}

async function produceMiper(row: Row): Promise<ProducedDocument> {
  const [matrix] = await db.select({ status: preventionRiskMatrices.status })
    .from(preventionRiskMatrices).where(eq(preventionRiskMatrices.id, row.entityId)).limit(1)
  if (!matrix) throw new GeneratedDocumentError("SOURCE_NOT_FOUND", "La MIPER ya no existe")
  if (matrix.status !== "published" && matrix.status !== "superseded") return SUPERSEDED
  const detail = await getPublishedRiskMatrixForArchive(row.entityId)
  const workbook = await buildMiperWorkbook(detail)
  const data = await workbook.xlsx.writeBuffer()
  return { outcome: "document", buffer: xlsxBuffer(data as ArrayBuffer), baseName: miperFilenameBase(detail) }
}

async function produceIncidente(row: Row): Promise<ProducedDocument> {
  const [incident] = await db.select({ code: preventionIncidents.code, status: preventionIncidents.status })
    .from(preventionIncidents).where(eq(preventionIncidents.id, row.entityId)).limit(1)
  if (!incident) throw new GeneratedDocumentError("SOURCE_NOT_FOUND", "El incidente ya no existe")
  if (incident.status !== "closed") return SUPERSEDED
  const report = await buildIncidentCaseArchive(row.entityId)
  if (!report) throw new GeneratedDocumentError("SOURCE_NOT_FOUND", "El incidente ya no existe")
  const data = await buildXlsxBuffer(report)
  return { outcome: "document", buffer: xlsxBuffer(data), baseName: withMilestone(`Expediente ${incident.code}`, row.milestone) }
}

export async function produceGeneratedDocument(row: Row, ctx: ProduceContext): Promise<ProducedDocument> {
  if (!isGeneratedDocumentKind(row.kind)) throw new GeneratedDocumentError("SOURCE_NOT_FOUND", "Tipo de documento desconocido")
  switch (row.kind) {
    case "entrega": return produceEntrega(row, ctx)
    case "inspeccion": return produceInspeccion(row, ctx)
    case "acta_sst": return produceActaSst(row, ctx)
    case "pdtp_cierre": return producePdtpCierre(row)
    case "pdtp_re36": return producePdtpRe36(row)
    case "miper": return produceMiper(row)
    case "incidente": return produceIncidente(row)
  }
}
