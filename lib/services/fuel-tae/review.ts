import { and, asc, desc, eq, gt, inArray, lt, ne, sql } from "drizzle-orm"
import type { Tx } from "@/db"
import { db } from "@/db"
import { fuelSealMovements, fuelTaeEvidence, fuelTaeSubmissions } from "@/db/schema"
import { nanoid } from "@/lib/id"
import { recordAudit, recordStatusChange } from "@/lib/audit"
import { auditResetDecisions } from "@/lib/combustibles/projection-audit"
import { projectTaeSubmissions } from "@/lib/combustibles/control/projection"
import { lockVehicleSeries } from "@/lib/combustibles/control/projection-series"
import { projectWithStaleDecisions } from "@/lib/combustibles/control/stale-decisions"
import { evaluateSealChain } from "@/lib/combustibles/control/seal-chain"
import { restoreSealMovements, retractSealMovements } from "@/lib/combustibles/seal-history"
import { isTaeReviewTransitionAllowed } from "@/lib/validation/fuel-tae"
import { MIN_ACCEPTED_OCR_CONFIDENCE } from "@/lib/services/tae-ocr"
import { detectTaeAnomaliesInTx } from "./anomalies"

/**
 * `reviewNote` es obligatoria para observar y anular (la acción lo exige); validar una
 * carga que está bien no pide explicación (rediseño 2026-10-31, «Confirmar sólo lo que
 * no se deshace»), así que llega `null` y la carga queda sin nota de revisión.
 */
export async function reviewTaeSubmission({ id, expectedStatus, status, reviewNote, userId }: { id: string; expectedStatus: "submitted" | "observed" | "validated" | "voided"; status: "observed" | "validated" | "voided"; reviewNote?: string | null; userId: string }) {
  // El tipo de medidor del **equipo** —no el de la carga, que guarda odómetro u
  // horómetro incluso cuando el equipo no tiene tablero— decide si la guarda de
  // OCR tiene algo que confirmar (hallazgo 5.1).
  const current = await db.query.fuelTaeSubmissions.findFirst({
    where: eq(fuelTaeSubmissions.id, id),
    with: { vehicle: { columns: { meterType: true } } },
  })
  if (!current) throw new Error("Carga TAE no encontrada")
  if (current.status !== expectedStatus) throw new Error("La carga cambió mientras la revisabas. Actualiza la página e inténtalo nuevamente.")
  if (!isTaeReviewTransitionAllowed(current.status as "submitted" | "observed" | "validated" | "voided", status)) throw new Error("La transición de estado solicitada no está permitida")
  /*
   * La guarda existe para una lectura que el OCR propuso y nadie ratificó:
   *
   * - un equipo sin medidor (`meterType = 'none'`) no tiene lectura que confirmar:
   *   el alta guarda `meterReading = null` y `meterReadingSource = null` (submit.ts),
   *   así que una sugerencia de OCR no puede trabar la validación;
   * - una lectura digitada por una persona llega con `meterReadingSource = 'manual'`
   *   y ya es la confirmación que esta guarda pide;
   * - con medidor, el alta exige la lectura, de modo que ningún flujo legítimo
   *   llega aquí con lectura vacía.
   */
  const equipmentHasMeter = current.vehicle?.meterType !== "none"
  const readingAwaitingConfirmation = equipmentHasMeter && current.meterReadingSource !== "manual"
  const requiresMeterConfirmation = readingAwaitingConfirmation
    && current.ocrSuggestedReading != null
    && current.ocrConfidence != null
    && Number(current.ocrConfidence) < MIN_ACCEPTED_OCR_CONFIDENCE
  if (status === "validated" && requiresMeterConfirmation) {
    throw new Error("Confirma o corrige manualmente la lectura sugerida por OCR antes de validar la carga")
  }
  const note = reviewNote?.trim() || null
  if (!note && status !== "validated") throw new Error("Indica el motivo o resolución")
  const now = new Date().toISOString()
  await db.transaction(async (tx) => {
    const updated = await tx.update(fuelTaeSubmissions)
      .set({ status, reviewNote: note, reviewedBy: userId, reviewedAt: now, updatedAt: now })
      .where(and(eq(fuelTaeSubmissions.id, id), eq(fuelTaeSubmissions.status, expectedStatus)))
      .returning({ id: fuelTaeSubmissions.id })
    if (updated.length === 0) throw new Error("La carga cambió mientras la revisabas. Actualiza la página e inténtalo nuevamente.")
    await recordAudit({ userId, action: "status_change", entityType: "fuel_tae_submission", entityId: id, oldState: { status: current.status }, newState: { status }, reason: note ?? undefined }, tx)
    await recordStatusChange({ entityType: "fuel_tae_submission", entityId: id, fromStatus: current.status, toStatus: status, changedBy: userId, reason: note ?? undefined }, tx)

    /*
     * 2.7 / 5.4: los movimientos de sello siguen al estado de la carga.
     *
     * `fuel_seal_movements` sólo se escribía al validar y nadie lo retractaba:
     * una carga anulada u observada seguía aportando su retiro/instalación al
     * historial del sello. Ahora se marcan (`reverted_at/by/reason`, migración
     * del carril E) y se reactivan si la carga vuelve a validarse — la fila no
     * se borra, así que el historial del lote nunca se pierde.
     */
    const sealMovements = status === "validated"
      ? await restoreSealMovements(tx, [id])
      : await retractSealMovements(tx, [id], {
          userId,
          reason: `La carga pasó de ${current.status} a ${status}${note ? `: ${note}` : ""}`,
          now,
        })
    for (const movementId of sealMovements) {
      await recordAudit({
        userId,
        action: "update",
        entityType: "fuel_seal_movement",
        entityId: movementId,
        oldState: { revertedAt: status === "validated" ? now : null },
        newState: { revertedAt: status === "validated" ? null : now, status },
        reason: status === "validated"
          ? "La carga volvió a estar validada: el movimiento de sello se reactiva"
          : `La carga dejó de estar validada (${status}): el movimiento de sello se retracta`,
        worksiteId: current.worksiteId,
      }, tx)
    }

    // Auto-detección de anomalías durante la revisión (sección 11)
    await detectTaeAnomaliesInTx(current, tx, userId, status)

    // La serie canónica sigue al estado de la carga: anular la saca de los
    // cálculos, observar o validar la deja a la vista de la revisión. El lock del
    // equipo va antes de leer/escribir la serie (mismo orden que el alta y la
    // corrección de lectura) y las decisiones posteriores se reabren si su base
    // cambió (A7).
    if (current.vehicleId) await lockVehicleSeries(tx, current.vehicleId)
    await projectWithStaleDecisions(
      tx,
      current.vehicleId,
      current.loadedAt,
      { userId },
      async () => {
        const projection = await projectTaeSubmissions(tx, [id])
        await auditResetDecisions(tx, projection.resetLoadIds, { userId }, current.worksiteId)
      },
    )

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
          where: sql`${fuelSealMovements.submissionId} IS NOT NULL`,
        })
      }
    }

    /*
     * 5.4: la cadena de sellos de la carga siguiente se calcula contra «la carga
     * anterior del equipo». Al anular u observar esta, la siguiente cambia de
     * referencia (o deja de tenerla), y hasta ahora sólo se reevaluaba al
     * insertar (`submit.ts`): el `mismatch` quedaba congelado. Se recalcula
     * siempre, también al revalidar.
     */
    if (current.vehicleId) {
      await reevaluateSealChainOfNextLoad(tx, {
        vehicleId: current.vehicleId,
        afterLoadedAt: current.loadedAt,
        actorId: userId,
        reason: `La carga ${current.loadedAt} pasó de ${current.status} a ${status}: se reevaluó la cadena de sellos de la siguiente`,
      })
    }
  })
}

/**
 * Recalcula la cadena de sellos de la primera carga vigente del equipo posterior
 * a `afterLoadedAt`, tomando como «carga anterior» la que de verdad le queda
 * después del cambio de estado —no la que el llamador crea—. Sirve igual para
 * anular una carga (la siguiente retrocede a la anterior), para observarla y para
 * revertir un lote entero (5.4 y 2.6).
 *
 * Se apoya en `evaluateSealChain` y no en `reevaluateNextSealChain` porque el
 * caso «la siguiente se quedó sin carga anterior» necesita distinguir `null`
 * (había anterior sin sello) de `undefined` (no había anterior).
 */
export async function reevaluateSealChainOfNextLoad(
  tx: Tx,
  input: { vehicleId: string; afterLoadedAt: string; actorId: string | null; reason: string },
): Promise<string | null> {
  const [next] = await tx.select({
    id: fuelTaeSubmissions.id,
    worksiteId: fuelTaeSubmissions.worksiteId,
    loadedAt: fuelTaeSubmissions.loadedAt,
    removedSealNumber: fuelTaeSubmissions.removedSealNumber,
    installedSealNumber: fuelTaeSubmissions.installedSealNumber,
    noSealReason: fuelTaeSubmissions.noSealReason,
    sealChainStatus: fuelTaeSubmissions.sealChainStatus,
    sealChainExpected: fuelTaeSubmissions.sealChainExpected,
  }).from(fuelTaeSubmissions)
    .where(and(
      eq(fuelTaeSubmissions.vehicleId, input.vehicleId),
      ne(fuelTaeSubmissions.status, "voided"),
      gt(fuelTaeSubmissions.loadedAt, input.afterLoadedAt),
    ))
    .orderBy(asc(fuelTaeSubmissions.loadedAt), asc(fuelTaeSubmissions.id))
    .limit(1)
  if (!next) return null

  const [previous] = await tx.select({ installedSealNumber: fuelTaeSubmissions.installedSealNumber })
    .from(fuelTaeSubmissions)
    .where(and(
      eq(fuelTaeSubmissions.vehicleId, input.vehicleId),
      ne(fuelTaeSubmissions.status, "voided"),
      lt(fuelTaeSubmissions.loadedAt, next.loadedAt),
    ))
    .orderBy(desc(fuelTaeSubmissions.loadedAt), desc(fuelTaeSubmissions.id))
    .limit(1)

  const chain = evaluateSealChain(
    { removedSeal: next.removedSealNumber, installedSeal: next.installedSealNumber, noSealReason: next.noSealReason },
    previous ? previous.installedSealNumber : undefined,
  )
  const changed = chain.status !== next.sealChainStatus || (chain.expected ?? null) !== (next.sealChainExpected ?? null)
  if (!changed) return null

  await tx.update(fuelTaeSubmissions)
    .set({ sealChainStatus: chain.status, sealChainExpected: chain.expected, updatedAt: new Date().toISOString() })
    .where(eq(fuelTaeSubmissions.id, next.id))
  await recordAudit({
    userId: input.actorId,
    action: "update",
    entityType: "fuel_tae_submission",
    entityId: next.id,
    oldState: { sealChainStatus: next.sealChainStatus, sealChainExpected: next.sealChainExpected },
    newState: { sealChainStatus: chain.status, sealChainExpected: chain.expected },
    reason: input.reason,
    worksiteId: next.worksiteId,
  }, tx)
  return next.id
}
