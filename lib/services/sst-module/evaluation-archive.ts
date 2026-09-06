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
  getFolderRemoteSegments,
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

    // El id del documento se deriva de la evaluación, no de un `nanoid()`: el
    // cierre es idempotente pero esta función corre DESPUÉS del cierre, así que
    // un doble clic (o el reintento de un server action) archivaba dos actas
    // legales distintas, ambas vigentes, para la misma evaluación. Se comprueba
    // antes de renderizar porque el PDF cuesta un navegador headless.
    const docId = `sdoc-eval-${evaluationId}`
    const versionId = `sdv-eval-${evaluationId}`
    const [alreadyArchived] = await db.select({ id: sstDocuments.id }).from(sstDocuments)
      .where(eq(sstDocuments.id, docId)).limit(1)
    if (alreadyArchived) return

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
    const folderSegments = await getFolderRemoteSegments(folder.id)
    const relativePath = await persistFileOnDisk(storageName, pdfBuffer, folderSegments)

    // Las cinco escrituras van en una transacción: el documento nace con
    // `currentVersionId = NULL` y sólo el UPDATE posterior lo apunta, así que un
    // fallo entremedio dejaba exactamente los estados que `integrity.ts`
    // clasifica como CRÍTICOS (`CURRENT_VERSION_NOT_PUBLISHED` /
    // `DRAFT_WITH_PUBLISHED_VERSION`), que exigen regularización manual — y en
    // silencio, porque esta función es best-effort y el caller traga el error.
    await db.transaction(async (tx) => {
      const [created] = await tx.insert(sstDocuments).values({
        id: docId, categorySlug: "salud_ocupacional", typeId: null, folderId: folder.id,
        internalCode: null, title: suggestedFilename.replace(/\.pdf$/i, ""),
        description: "Copia automática de la evaluación SST generada al cerrarse.",
        worksiteId: evaluation.worksiteId,
        status: "vigente",
        // El RE-28 registra condiciones de salud declaradas por la persona; el
        // resto de las actas registra desempeño. Clasificarlas igual metía datos
        // sensibles en la biblioteca general con la etiqueta de siempre.
        // `sensible` + `sensitive_preventive` es lo que activa la relocación
        // cifrada y la auditoría de acceso de `prevention-sensitive-files.ts`.
        ...(evaluation.definicionCode === "identificacion_sensibles"
          ? { confidentiality: "sensible" as const, dataClass: "sensitive_preventive" as const }
          : { confidentiality: "restringido" as const }),
        currentVersionId: null, effectiveFrom: now.slice(0, 10), expiresAt: null,
        responsibleUserId: null, uploadedBy: session.user.id, reviewedBy: null,
        approvedBy: session.user.id, approvedAt: now, requiresAcknowledgment: false,
        tags: ["evaluacion-sst"], extraMetadata: { evaluationId }, checksum,
        createdAt: now, updatedAt: now,
      }).onConflictDoNothing().returning()
      // Perdió la carrera contra otro cierre simultáneo: el documento ya existe.
      // ponytail: deja el PDF recién escrito huérfano en disco, que es la
      // opción barata frente a orquestar un borrado compensatorio por un caso
      // que la comprobación de más arriba ya cubre salvo empate exacto.
      if (!created) return

      await tx.insert(sstDocumentVersions).values({
        id: versionId, documentId: docId, version: 1, status: "vigente",
        fileName: suggestedFilename, storageName, filePath: relativePath,
        mimeType: "application/pdf", fileSize: pdfBuffer.length, checksum,
        effectiveFrom: now.slice(0, 10), effectiveTo: null,
        changelog: "Generado automáticamente al cerrar la evaluación.",
        uploadedBy: session.user.id, reviewedBy: null, approvedBy: session.user.id, approvedAt: now,
        supersedesId: null, createdAt: now, updatedAt: now,
      })
      await tx.update(sstDocuments).set({ currentVersionId: versionId, updatedAt: now }).where(eq(sstDocuments.id, docId))

      await tx.insert(sstDocumentLinks).values({
        id: `sdlink-${nanoid()}`, documentId: docId, entityType: "worker",
        entityId: evaluation.workerId, notes: "Evaluación SST", createdByUserId: session.user.id, createdAt: now,
      }).onConflictDoNothing()

      await recordAuditEntry({
        documentId: docId, versionId, userId: session.user.id, action: "create",
        toStatus: "vigente", metadata: { source: "sst_evaluation_close", evaluationId },
      }, tx)
    })
  } catch (err) {
    logger.error("[evaluation-archive] no se pudo guardar copia de la evaluación en la biblioteca documental", err)
  }
}
