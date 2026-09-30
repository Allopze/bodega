import { and, eq } from "drizzle-orm"
import { db } from "@/db"
import { preventionRiskEntries, preventionRiskObservations } from "@/db/schema"
import { nanoid } from "@/lib/id"
import { REVIEW_STAGE_FOR_STATE, STAGE_PERMISSION, type MiperReviewState, type ReviewStage } from "@/lib/prevention/miper/states"
import { miperObservationRefSchema, miperObservationResponseSchema, miperObservationSchema } from "@/lib/validation/prevention-module/miper"
import { RiskLegalDomainError } from "@/lib/services/prevention-risk-legal-errors"
import { openRound } from "./snapshots"
import { type Client, lockMatrix, type MiperAccess, miperHistory, nowIso, requireAccess } from "./shared"

/** Observar sólo mientras hay una ronda abierta, y sólo quien revisa esa etapa. */
export async function addMiperObservation(input: unknown, access: MiperAccess) {
  const data = miperObservationSchema.parse(input)
  return db.transaction(async (tx) => {
    const matrix = await lockMatrix(tx, data.matrixId)
    const stage = REVIEW_STAGE_FOR_STATE[matrix.reviewState as MiperReviewState]
    if (!stage) throw new RiskLegalDomainError("Sólo se observa una MIPER que está en revisión técnica o pendiente de aprobación.")
    requireAccess(access, STAGE_PERMISSION[stage], matrix.worksiteId)
    const round = await openRound(tx, matrix.id)
    if (!round || round.stage !== stage) throw new RiskLegalDomainError("No hay una ronda de revisión abierta; recarga la MIPER.")
    let entryLabel: string | null = null
    if (data.entryId) {
      const [entry] = await tx.select({ rowNumber: preventionRiskEntries.rowNumber, hazard: preventionRiskEntries.hazard }).from(preventionRiskEntries)
        .where(and(eq(preventionRiskEntries.id, data.entryId), eq(preventionRiskEntries.matrixId, matrix.id))).limit(1)
      if (!entry) throw new RiskLegalDomainError("La fila observada no existe en esta MIPER.")
      entryLabel = `Riesgo #${entry.rowNumber ?? "?"} · ${entry.hazard ?? "sin peligro descrito"}`
    }
    const id = `riskobs-${nanoid()}`
    await tx.insert(preventionRiskObservations).values({ id, matrixId: matrix.id, entryId: data.entryId ?? null, entryLabel, roundId: round.id, stage, authorUserId: access.userId, body: data.body })
    await miperHistory(tx, { matrixId: matrix.id, worksiteId: matrix.worksiteId, object: "observation", objectId: id, changeType: "observation_created", reason: data.body, after: { entryId: data.entryId ?? null, stage }, actorUserId: access.userId, actingAs: STAGE_PERMISSION[stage] })
    return { id }
  })
}

async function loadObservation(tx: Client, observationId: string) {
  const [observation] = await tx.select().from(preventionRiskObservations).where(eq(preventionRiskObservations.id, observationId)).limit(1)
  if (!observation) throw new RiskLegalDomainError("Observación no encontrada.")
  const matrix = await lockMatrix(tx, observation.matrixId)
  return { observation, matrix, permission: STAGE_PERMISSION[observation.stage as ReviewStage] }
}

/** Responde el prevencionista, una vez devuelta la MIPER. */
export async function respondMiperObservation(input: unknown, access: MiperAccess) {
  const data = miperObservationResponseSchema.parse(input)
  await db.transaction(async (tx) => {
    const { observation, matrix } = await loadObservation(tx, data.observationId)
    requireAccess(access, "prevention:risk:edit", matrix.worksiteId)
    if (matrix.reviewState !== "observed") throw new RiskLegalDomainError("Se responde una observación cuando la MIPER fue devuelta con observaciones.")
    if (observation.status !== "open") throw new RiskLegalDomainError("Esta observación ya fue respondida.")
    await tx.update(preventionRiskObservations).set({ status: "answered", response: data.response, respondedByUserId: access.userId, respondedAt: nowIso() }).where(eq(preventionRiskObservations.id, observation.id))
    await miperHistory(tx, { matrixId: matrix.id, worksiteId: matrix.worksiteId, object: "observation", objectId: observation.id, changeType: "observation_answered", reason: data.response, actorUserId: access.userId, actingAs: "prevention:risk:edit" })
  })
}

/** Quien revisa la etapa da por resuelta una respuesta. */
export async function resolveMiperObservation(input: unknown, access: MiperAccess) {
  const data = miperObservationRefSchema.parse(input)
  await db.transaction(async (tx) => {
    const { observation, matrix, permission } = await loadObservation(tx, data.observationId)
    requireAccess(access, permission, matrix.worksiteId)
    if (observation.status !== "answered") throw new RiskLegalDomainError("Sólo se resuelve una observación respondida.")
    await tx.update(preventionRiskObservations).set({ status: "resolved", resolvedByUserId: access.userId, resolvedAt: nowIso() }).where(eq(preventionRiskObservations.id, observation.id))
    await miperHistory(tx, { matrixId: matrix.id, worksiteId: matrix.worksiteId, object: "observation", objectId: observation.id, changeType: "observation_resolved", actorUserId: access.userId, actingAs: permission })
  })
}

/** ...o la reabre si la respuesta no basta, durante la revisión de su etapa. */
export async function reopenMiperObservation(input: unknown, access: MiperAccess) {
  const data = miperObservationRefSchema.parse(input)
  await db.transaction(async (tx) => {
    const { observation, matrix, permission } = await loadObservation(tx, data.observationId)
    requireAccess(access, permission, matrix.worksiteId)
    if (observation.status !== "answered") throw new RiskLegalDomainError("Sólo se reabre una observación respondida.")
    if (REVIEW_STAGE_FOR_STATE[matrix.reviewState as MiperReviewState] !== observation.stage) throw new RiskLegalDomainError("La observación se reabre durante la revisión de su etapa.")
    await tx.update(preventionRiskObservations).set({ status: "open" }).where(eq(preventionRiskObservations.id, observation.id))
    await miperHistory(tx, { matrixId: matrix.id, worksiteId: matrix.worksiteId, object: "observation", objectId: observation.id, changeType: "observation_reopened", actorUserId: access.userId, actingAs: permission })
  })
}
