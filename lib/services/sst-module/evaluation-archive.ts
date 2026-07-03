/**
 * lib/services/sst-module/evaluation-archive.ts
 *
 * Al cerrar una evaluación SST (acta trabajador nuevo/seguimiento, incluye
 * las secciones semanales del conductor líder — son parte de la misma
 * `sst_evaluations`, no un registro aparte), guarda una copia PDF en la
 * biblioteca documental de Prevención, en una carpeta "Evaluaciones SST"
 * por faena. Reutiliza el mismo pipeline de renderizado que el botón
 * "descargar PDF" de /sst/[id]/print/pdf.
 *
 * Best-effort: nunca lanza. `sst_evaluations` sigue siendo la fuente de
 * verdad de la evaluación; la copia en la biblioteca es una conveniencia
 * de archivo, no algo de lo que dependa el cierre de la evaluación.
 *
 * No importa `loadActaData` de la ruta de impresión a propósito: esa función
 * carga `@/lib/auth/can` → `@/lib/auth/auth`, que invoca `NextAuth(...)` a
 * nivel de módulo y requiere `next/server` — eso rompía cualquier test que
 * importara este archivo transitivamente vía el barrel `lib/services/sst`
 * (p.ej. sst-delete-evaluation.test.ts) sin mockear next-auth. Como el
 * caller (closeEvaluationAction) ya validó el scope del que cierra, no hace
 * falta repetir ese chequeo aquí — sólo se necesitan datos planos.
 */
import { headers } from "next/headers"
import type { Session } from "next-auth"
import { eq } from "drizzle-orm"
import { db } from "@/db"
import { sstEvaluations } from "@/db/schema/sst"
import { workers } from "@/db/schema/worksites"
import { sstDocuments, sstDocumentVersions, sstDocumentLinks } from "@/db/schema"
import { nanoid } from "@/lib/id"
import { logger } from "@/lib/logger"
import { withBrowserContext } from "@/lib/pdf/browser-pool"
import { buildActaFilename } from "@/lib/sst/acta-filename"
import { validateFileBuffer, MimeType } from "@/lib/file-validation"
import {
  generateStorageName,
  sha256Hex,
  persistFileOnDisk,
  recordAuditEntry,
  getOrCreateSystemFolder,
} from "@/lib/services/prevention-documents-library"

const EVALUATIONS_FOLDER_NAME = "Evaluaciones SST"

export async function archiveEvaluationPdf(evaluationId: string, session: Session): Promise<void> {
  try {
    const [evaluation] = await db.select().from(sstEvaluations).where(eq(sstEvaluations.id, evaluationId)).limit(1)
    if (!evaluation) return
    const [worker] = await db.select({ firstName: workers.firstName, lastName: workers.lastName })
      .from(workers).where(eq(workers.id, evaluation.workerId)).limit(1)
    if (!worker) return
    const suggestedFilename = buildActaFilename({ tipo: evaluation.tipo, workerName: `${worker.firstName} ${worker.lastName}` })

    const h = await headers()
    const cookie = h.get("cookie") ?? ""
    const origin = process.env.APP_URL ?? `${h.get("x-forwarded-proto") ?? "http"}://${h.get("host") ?? "localhost:3000"}`
    const printUrl = `${origin}/sst/${evaluationId}/print`

    const pdfBuffer = await withBrowserContext(
      { extraHTTPHeaders: cookie ? { cookie } : {} },
      async (ctx) => {
        const page = await ctx.newPage()
        await page.goto(printUrl, { waitUntil: "networkidle" })
        return page.pdf({ format: "A4", printBackground: true })
      },
    )
    const validated = validateFileBuffer(pdfBuffer, pdfBuffer.length, MimeType.INVOICE)
    if (validated.error) throw new Error(`PDF generado inválido: ${validated.error}`)

    const folder = await getOrCreateSystemFolder({
      name: EVALUATIONS_FOLDER_NAME,
      worksiteId: evaluation.worksiteId,
      createdBy: session.user.id,
    })

    const now = new Date().toISOString()
    const checksum = sha256Hex(pdfBuffer)
    const storageName = generateStorageName(suggestedFilename)
    const relativePath = await persistFileOnDisk(storageName, pdfBuffer)

    const docId = `sdoc-${nanoid()}`
    await db.insert(sstDocuments).values({
      id: docId, categorySlug: "salud_ocupacional", typeId: null, folderId: folder.id,
      internalCode: null, title: suggestedFilename.replace(/\.pdf$/i, ""),
      description: "Copia automática de la evaluación SST generada al cerrarse.",
      worksiteId: evaluation.worksiteId, status: "vigente", confidentiality: "restringido",
      currentVersionId: null, effectiveFrom: now.slice(0, 10), expiresAt: null,
      responsibleUserId: null, uploadedBy: session.user.id, reviewedBy: null,
      approvedBy: session.user.id, approvedAt: now, requiresAcknowledgment: false,
      tags: ["evaluacion-sst"], extraMetadata: { evaluationId }, checksum,
      createdAt: now, updatedAt: now,
    })

    const versionId = `sdv-${nanoid()}`
    await db.insert(sstDocumentVersions).values({
      id: versionId, documentId: docId, version: 1, status: "vigente",
      fileName: suggestedFilename, storageName, filePath: relativePath,
      mimeType: "application/pdf", fileSize: pdfBuffer.length, checksum,
      effectiveFrom: now.slice(0, 10), effectiveTo: null,
      changelog: "Generado automáticamente al cerrar la evaluación.",
      uploadedBy: session.user.id, reviewedBy: null, approvedBy: session.user.id, approvedAt: now,
      supersedesId: null, createdAt: now, updatedAt: now,
    })
    await db.update(sstDocuments).set({ currentVersionId: versionId, updatedAt: now }).where(eq(sstDocuments.id, docId))

    await db.insert(sstDocumentLinks).values({
      id: `sdlink-${nanoid()}`, documentId: docId, entityType: "worker",
      entityId: evaluation.workerId, notes: "Evaluación SST", createdAt: now,
    }).onConflictDoNothing()

    await recordAuditEntry({
      documentId: docId, versionId, userId: session.user.id, action: "create",
      toStatus: "vigente", metadata: { source: "sst_evaluation_close", evaluationId },
    })
  } catch (err) {
    logger.error("[evaluation-archive] no se pudo guardar copia de la evaluación en la biblioteca documental", err)
  }
}
