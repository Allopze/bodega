import { and, eq, inArray } from "drizzle-orm"
import { db } from "@/db"
import { fuelSealMovements, fuelTaeEvidence, fuelTaeSubmissions } from "@/db/schema"
import { nanoid } from "@/lib/id"
import { recordAudit, recordStatusChange } from "@/lib/audit"
import { auditResetDecisions } from "@/lib/combustibles/projection-audit"
import { projectTaeSubmissions } from "@/lib/combustibles/control/projection"
import { isTaeReviewTransitionAllowed } from "@/lib/validation/fuel-tae"
import { MIN_ACCEPTED_OCR_CONFIDENCE } from "@/lib/services/tae-ocr"
import { detectTaeAnomaliesInTx } from "./anomalies"

export async function reviewTaeSubmission({ id, expectedStatus, status, reviewNote, userId }: { id: string; expectedStatus: "submitted" | "observed" | "validated" | "voided"; status: "observed" | "validated" | "voided"; reviewNote: string; userId: string }) {
  const current = await db.query.fuelTaeSubmissions.findFirst({ where: eq(fuelTaeSubmissions.id, id) })
  if (!current) throw new Error("Carga TAE no encontrada")
  if (current.status !== expectedStatus) throw new Error("La carga cambió mientras la revisabas. Actualiza la página e inténtalo nuevamente.")
  if (!isTaeReviewTransitionAllowed(current.status as "submitted" | "observed" | "validated" | "voided", status)) throw new Error("La transición de estado solicitada no está permitida")
  const requiresMeterConfirmation = current.ocrSuggestedReading != null
    && current.ocrConfidence != null
    && Number(current.ocrConfidence) < MIN_ACCEPTED_OCR_CONFIDENCE
    && current.meterReadingSource !== "manual"
  if (status === "validated" && requiresMeterConfirmation) {
    throw new Error("Confirma o corrige manualmente la lectura sugerida por OCR antes de validar la carga")
  }
  const now = new Date().toISOString()
  await db.transaction(async (tx) => {
    const updated = await tx.update(fuelTaeSubmissions)
      .set({ status, reviewNote, reviewedBy: userId, reviewedAt: now, updatedAt: now })
      .where(and(eq(fuelTaeSubmissions.id, id), eq(fuelTaeSubmissions.status, expectedStatus)))
      .returning({ id: fuelTaeSubmissions.id })
    if (updated.length === 0) throw new Error("La carga cambió mientras la revisabas. Actualiza la página e inténtalo nuevamente.")
    await recordAudit({ userId, action: "status_change", entityType: "fuel_tae_submission", entityId: id, oldState: { status: current.status }, newState: { status }, reason: reviewNote }, tx)
    await recordStatusChange({ entityType: "fuel_tae_submission", entityId: id, fromStatus: current.status, toStatus: status, changedBy: userId, reason: reviewNote }, tx)

    // Auto-detección de anomalías durante la revisión (sección 11)
    await detectTaeAnomaliesInTx(current, tx, userId, status)

    // La serie canónica sigue al estado de la carga: anular la saca de los
    // cálculos, observar o validar la deja a la vista de la revisión.
    const projection = await projectTaeSubmissions(tx, [id])
    await auditResetDecisions(tx, projection.resetLoadIds, { userId }, current.worksiteId)

    // Registrar movimientos de sellos al validar (sección 9)
    if (status === "validated") {
      // Buscar evidencias de sello en esta carga para asociarlas al movimiento
      const sealEvidences = await tx.select({ kind: fuelTaeEvidence.kind, fileName: fuelTaeEvidence.fileName, filePath: fuelTaeEvidence.filePath, sha256: fuelTaeEvidence.sha256 })
        .from(fuelTaeEvidence).where(and(eq(fuelTaeEvidence.submissionId, id), inArray(fuelTaeEvidence.kind, ["removed_seal", "installed_seal"])))

      const removedEvidence = sealEvidences.find((e) => e.kind === "removed_seal")
      const installedEvidence = sealEvidences.find((e) => e.kind === "installed_seal")

      // Idempotencia simétrica y sin carrera: el retiro se insertaba siempre
      // (revalidar duplicaba el movimiento) y la instalación se protegía con un
      // SELECT previo, que dos revisiones concurrentes atraviesan igual. Ahora
      // ambos se apoyan en el índice único (submission, tipo, sello).
      const sealMovements = [
        current.removedSealNumber
          ? { sealNumber: current.removedSealNumber, movementType: "removed" as const, evidence: removedEvidence }
          : null,
        current.installedSealNumber
          ? { sealNumber: current.installedSealNumber, movementType: "installed" as const, evidence: installedEvidence }
          : null,
      ].filter(Boolean) as Array<{ sealNumber: string; movementType: "removed" | "installed"; evidence: typeof removedEvidence }>

      for (const movement of sealMovements) {
        await tx.insert(fuelSealMovements).values({
          id: nanoid(), submissionId: id, sealNumber: movement.sealNumber,
          movementType: movement.movementType, changedBy: userId, isException: false,
          evidenceFileName: movement.evidence?.fileName ?? null,
          evidenceFilePath: movement.evidence?.filePath ?? null,
          evidenceSha256: movement.evidence?.sha256 ?? null,
        }).onConflictDoNothing({
          target: [fuelSealMovements.submissionId, fuelSealMovements.movementType, fuelSealMovements.sealNumber],
        })
      }
    }
  })
}
