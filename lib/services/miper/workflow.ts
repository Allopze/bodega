import { and, desc, eq, ne, sql, type SQL } from "drizzle-orm"
import { db } from "@/db"
import {
  preventionPdtpUpdateObligations, preventionRiskEntries, preventionRiskMatrices, preventionRiskMatrixVersions,
  preventionRiskObservations, preventionRiskProgramActions, preventionRiskPrograms, preventionRiskReviewRounds,
} from "@/db/schema"
import { nanoid } from "@/lib/id"
import { checkMiperCompleteness } from "@/lib/prevention/miper/completeness"
import { diffSnapshots, type MiperSnapshot } from "@/lib/prevention/miper/snapshot"
import { MIPER_ACTION_RULES, REVIEW_STATE_LABEL, type MiperReviewState, type MiperWorkflowAction } from "@/lib/prevention/miper/states"
import { enqueueGeneratedDocumentTx } from "@/lib/services/generated-documents/enqueue"
import { onRiskMatrixPublished } from "@/lib/services/pdtp-adapters/pdtp-accreditation-connectors"
import { createRiskReviewTriggerWithClient } from "@/lib/services/prevention-risk-legal"
import { RiskLegalDomainError } from "@/lib/services/prevention-risk-legal-errors"
import { resolveOwnWorkSigning } from "@/lib/services/prevention-signing"
import { addDaysToPlainDate, todayInChile } from "@/lib/utils"
import { miperApproveFinalSchema, miperCommentedDecisionSchema, miperWorkflowSchema } from "@/lib/validation/prevention-module/miper"
import { buildMiperSnapshot, openRound, snapshotSha } from "./snapshots"
import { notifyMiperReviewStep } from "./notifications"
import { programLinkedControlIds, syncOccurrences, supersedePendingOccurrences } from "./program-execution"
import { type Client, lockMatrix, type MiperAccess, miperHistory, nowIso, requireAccess, userNames } from "./shared"

type Matrix = typeof preventionRiskMatrices.$inferSelect
const STALE = "La MIPER cambió mientras la revisabas. Recarga antes de continuar."

async function loadForAction(client: Client, matrixId: string, action: MiperWorkflowAction, access: MiperAccess, expectedVersion: number) {
  const matrix = await lockMatrix(client, matrixId)
  const rule = MIPER_ACTION_RULES[action]
  requireAccess(access, rule.permission, matrix.worksiteId)
  if (matrix.isLegacy || matrix.status === "superseded") throw new RiskLegalDomainError("Esta MIPER no admite cambios de flujo (reemplazada o de la metodología anterior).")
  if (!rule.from.includes(matrix.reviewState as MiperReviewState)) {
    throw new RiskLegalDomainError(`No se puede «${rule.label}» una MIPER en estado «${REVIEW_STATE_LABEL[matrix.reviewState as MiperReviewState] ?? matrix.reviewState}»; recarga para ver su estado actual.`)
  }
  if (matrix.version !== expectedVersion) throw new RiskLegalDomainError(STALE)
  return matrix
}

async function setReviewState(client: Client, matrix: Matrix, reviewState: MiperReviewState, now: string, extra: Partial<typeof preventionRiskMatrices.$inferInsert> = {}) {
  const [updated] = await client.update(preventionRiskMatrices).set({ reviewState, version: matrix.version + 1, updatedAt: now, ...extra })
    .where(and(eq(preventionRiskMatrices.id, matrix.id), eq(preventionRiskMatrices.version, matrix.version))).returning()
  if (!updated) throw new RiskLegalDomainError(STALE)
  return updated
}

async function nextRoundNumber(client: Client, matrixId: string) {
  const [row] = await client.select({ max: sql<number>`coalesce(max(${preventionRiskReviewRounds.roundNumber}), 0)::int` }).from(preventionRiskReviewRounds).where(eq(preventionRiskReviewRounds.matrixId, matrixId))
  return (row?.max ?? 0) + 1
}

async function latestVersion(client: Client, matrixId: string) {
  const [version] = await client.select().from(preventionRiskMatrixVersions).where(eq(preventionRiskMatrixVersions.matrixId, matrixId)).orderBy(desc(preventionRiskMatrixVersions.versionNumber)).limit(1)
  return version ?? null
}

async function countObservations(client: Client, where: SQL | undefined) {
  const [row] = await client.select({ count: sql<number>`count(*)::int` }).from(preventionRiskObservations).where(where)
  return row?.count ?? 0
}

function assertNotSubmitter(access: MiperAccess, submittedByUserId: string, message: string) {
  if (access.userId === submittedByUserId) throw new RiskLegalDomainError(message)
}

/** Al aprobar, lo respondido y no reabierto queda resuelto por quien aprueba. */
async function autoResolveAnswered(client: Client, matrixId: string, userId: string, now: string) {
  await client.update(preventionRiskObservations).set({ status: "resolved", resolvedByUserId: userId, resolvedAt: now })
    .where(and(eq(preventionRiskObservations.matrixId, matrixId), eq(preventionRiskObservations.status, "answered")))
}

export async function submitMiperForReview(input: unknown, access: MiperAccess) {
  const data = miperWorkflowSchema.parse(input)
  const submitted = await db.transaction(async (tx) => {
    const matrix = await loadForAction(tx, data.matrixId, "submit", access, data.expectedVersion)
    const snapshot = await buildMiperSnapshot(tx, matrix.id)
    /* El Intolerable no puede enviarse sin una medida dentro del Programa de
     * Trabajo (§6.2 / §7.3): la regla vive en `checkMiperCompleteness` y acá se
     * le entrega el conjunto de medidas ya vinculadas a una actividad. */
    const linkedControlIds = await programLinkedControlIds(tx, matrix.id)
    const blocking = checkMiperCompleteness(snapshot, { linkedControlIds, requireProgramLink: true }).filter((issue) => issue.severity === "error")
    if (blocking.length > 0) {
      throw new RiskLegalDomainError(`No se puede enviar a revisión: hay ${blocking.length} pendiente(s). ${blocking.slice(0, 3).map((issue) => issue.message).join(" ")}`)
    }
    if (matrix.reviewState === "observed") {
      const open = await countObservations(tx, and(eq(preventionRiskObservations.matrixId, matrix.id), eq(preventionRiskObservations.status, "open")))
      if (open > 0) throw new RiskLegalDomainError(`Responde todas las observaciones antes de reenviar (${open} sin responder).`)
    }
    if (matrix.status === "published" && matrix.reviewState === "none") {
      const last = await latestVersion(tx, matrix.id)
      if (last && !diffSnapshots(last.snapshot as MiperSnapshot, snapshot).hasChanges) {
        throw new RiskLegalDomainError(`No hay cambios respecto de la versión vigente v${last.versionNumber}.`)
      }
    }
    const now = nowIso()
    const roundId = `riskround-${nanoid()}`
    await tx.insert(preventionRiskReviewRounds).values({
      id: roundId, matrixId: matrix.id, roundNumber: await nextRoundNumber(tx, matrix.id), stage: "technical",
      snapshot, snapshotSha256: snapshotSha(snapshot), submittedByUserId: access.userId, submittedAt: now,
    })
    await setReviewState(tx, matrix, "in_review", now)
    await miperHistory(tx, { matrixId: matrix.id, worksiteId: matrix.worksiteId, object: "round", objectId: roundId, changeType: "submitted", reason: data.comment ?? null, after: { entryCount: snapshot.entries.length }, actorUserId: access.userId, actingAs: "prevention:risk:edit" })
    return { roundId, worksiteId: matrix.worksiteId, matrixTitle: matrix.title }
  })

  /* §9.1: «enviado → siguiente responsable». Después del COMMIT y fuera del
   * callback, porque los destinatarios se resuelven con la conexión global. */
  notifyMiperReviewStep({
    matrixId: data.matrixId, worksiteId: submitted.worksiteId, matrixTitle: submitted.matrixTitle,
    reviewState: "in_review", returned: false, actorUserId: access.userId, roundId: submitted.roundId,
  })
  return { roundId: submitted.roundId }
}

/** Marca que la revisora abrió la ronda: distingue "Enviado" de "En revisión". */
export async function openMiperReviewRound(input: { matrixId: string }, access: MiperAccess) {
  await db.transaction(async (tx) => {
    const matrix = await lockMatrix(tx, input.matrixId)
    const round = await openRound(tx, matrix.id)
    if (!round || round.openedAt) return
    const permission = round.stage === "technical" ? "prevention:risk:review" : "prevention:risk:approve_legal"
    if (!access.permissions.includes(permission) || access.userId === round.submittedByUserId) return
    requireAccess(access, permission, matrix.worksiteId)
    await tx.update(preventionRiskReviewRounds).set({ openedAt: nowIso(), openedByUserId: access.userId }).where(eq(preventionRiskReviewRounds.id, round.id))
    await miperHistory(tx, { matrixId: matrix.id, worksiteId: matrix.worksiteId, object: "round", objectId: round.id, changeType: "opened", actorUserId: access.userId, actingAs: permission })
  })
}

export async function returnMiperWithObservations(input: unknown, access: MiperAccess) {
  const data = miperCommentedDecisionSchema.parse(input)
  const returned = await db.transaction(async (tx) => {
    const matrix = await loadForAction(tx, data.matrixId, "return", access, data.expectedVersion)
    const round = await openRound(tx, matrix.id)
    if (!round || round.stage !== "technical") throw new RiskLegalDomainError("No hay una ronda de revisión técnica abierta; recarga la MIPER.")
    assertNotSubmitter(access, round.submittedByUserId, "Quien envió la MIPER no puede revisarla.")
    const open = await countObservations(tx, and(eq(preventionRiskObservations.roundId, round.id), eq(preventionRiskObservations.status, "open")))
    if (open === 0) throw new RiskLegalDomainError("Registra al menos una observación antes de devolver la MIPER.")
    const now = nowIso()
    await tx.update(preventionRiskReviewRounds).set({ decision: "observed", decidedByUserId: access.userId, decidedAt: now, decisionComment: data.comment }).where(eq(preventionRiskReviewRounds.id, round.id))
    await setReviewState(tx, matrix, "observed", now)
    await miperHistory(tx, { matrixId: matrix.id, worksiteId: matrix.worksiteId, object: "round", objectId: round.id, changeType: "returned", reason: data.comment, after: { openObservations: open }, actorUserId: access.userId, actingAs: "prevention:risk:review" })
    return { roundId: round.id, worksiteId: matrix.worksiteId, matrixTitle: matrix.title, submitterUserId: round.submittedByUserId }
  })

  /* §9.1: «devuelto → quien editó» (el autor de la ronda que se devuelve). */
  notifyMiperReviewStep({
    matrixId: data.matrixId, worksiteId: returned.worksiteId, matrixTitle: returned.matrixTitle,
    reviewState: "observed", returned: true, actorUserId: access.userId,
    roundId: returned.roundId, submitterUserId: returned.submitterUserId,
  })
}

export async function approveMiperTechnicalReview(input: unknown, access: MiperAccess) {
  const data = miperWorkflowSchema.parse(input)
  const approved = await db.transaction(async (tx) => {
    const matrix = await loadForAction(tx, data.matrixId, "approve_technical", access, data.expectedVersion)
    const round = await openRound(tx, matrix.id)
    if (!round || round.stage !== "technical") throw new RiskLegalDomainError("No hay una ronda de revisión técnica abierta; recarga la MIPER.")
    assertNotSubmitter(access, round.submittedByUserId, "Quien envió la MIPER no puede revisarla.")
    const open = await countObservations(tx, and(eq(preventionRiskObservations.matrixId, matrix.id), eq(preventionRiskObservations.status, "open")))
    if (open > 0) throw new RiskLegalDomainError(`Hay ${open} observación(es) abierta(s): devuelve la MIPER o resuélvelas antes de aprobar.`)
    const now = nowIso()
    await autoResolveAnswered(tx, matrix.id, access.userId, now)
    await tx.update(preventionRiskReviewRounds).set({ decision: "approved", decidedByUserId: access.userId, decidedAt: now, decisionComment: data.comment ?? null }).where(eq(preventionRiskReviewRounds.id, round.id))
    /* La ronda de Legal y RRHH nace acá: es la espera de firma que se avisa (y
     * la que el cron de firma pendiente mide en días hábiles). */
    const legalRoundId = `riskround-${nanoid()}`
    await tx.insert(preventionRiskReviewRounds).values({
      id: legalRoundId, matrixId: matrix.id, roundNumber: await nextRoundNumber(tx, matrix.id), stage: "legal_rrhh",
      snapshot: round.snapshot, snapshotSha256: round.snapshotSha256, submittedByUserId: round.submittedByUserId, submittedAt: now,
    })
    await setReviewState(tx, matrix, "pending_approval", now)
    await miperHistory(tx, { matrixId: matrix.id, worksiteId: matrix.worksiteId, object: "round", objectId: round.id, changeType: "technical_approved", reason: data.comment ?? null, actorUserId: access.userId, actingAs: "prevention:risk:review" })
    return { legalRoundId, worksiteId: matrix.worksiteId, matrixTitle: matrix.title }
  })

  /* §9.1: «pendiente de firma → siguiente responsable» = Legal y RRHH. */
  notifyMiperReviewStep({
    matrixId: data.matrixId, worksiteId: approved.worksiteId, matrixTitle: approved.matrixTitle,
    reviewState: "pending_approval", returned: false, actorUserId: access.userId, roundId: approved.legalRoundId,
  })
}

export async function requestMiperCorrections(input: unknown, access: MiperAccess) {
  const data = miperCommentedDecisionSchema.parse(input)
  const asked = await db.transaction(async (tx) => {
    const matrix = await loadForAction(tx, data.matrixId, "request_corrections", access, data.expectedVersion)
    const round = await openRound(tx, matrix.id)
    if (!round || round.stage !== "legal_rrhh") throw new RiskLegalDomainError("No hay una aprobación Legal y RRHH pendiente; recarga la MIPER.")
    assertNotSubmitter(access, round.submittedByUserId, "Quien elaboró la MIPER no puede aprobarla.")
    const open = await countObservations(tx, and(eq(preventionRiskObservations.roundId, round.id), eq(preventionRiskObservations.status, "open")))
    if (open === 0) throw new RiskLegalDomainError("Registra al menos una observación antes de solicitar correcciones.")
    const now = nowIso()
    await tx.update(preventionRiskReviewRounds).set({ decision: "observed", decidedByUserId: access.userId, decidedAt: now, decisionComment: data.comment }).where(eq(preventionRiskReviewRounds.id, round.id))
    await setReviewState(tx, matrix, "observed", now)
    await miperHistory(tx, { matrixId: matrix.id, worksiteId: matrix.worksiteId, object: "round", objectId: round.id, changeType: "corrections_requested", reason: data.comment, actorUserId: access.userId, actingAs: "prevention:risk:approve_legal" })
    return { roundId: round.id, worksiteId: matrix.worksiteId, matrixTitle: matrix.title, submitterUserId: round.submittedByUserId }
  })

  /* §9.1: una solicitud de correcciones de Legal y RRHH también vuelve a quien
   * elaboró, con el mismo aviso que una devolución técnica. */
  notifyMiperReviewStep({
    matrixId: data.matrixId, worksiteId: asked.worksiteId, matrixTitle: asked.matrixTitle,
    reviewState: "observed", returned: true, actorUserId: access.userId,
    roundId: asked.roundId, submitterUserId: asked.submitterUserId,
  })
}

export async function approveMiperFinal(input: unknown, access: MiperAccess) {
  const data = miperApproveFinalSchema.parse(input)
  let accreditation: Parameters<typeof onRiskMatrixPublished>[0] | null = null
  const result = await db.transaction(async (tx) => {
    const matrix = await loadForAction(tx, data.matrixId, "approve_final", access, data.expectedVersion)
    const legalRound = await openRound(tx, matrix.id)
    if (!legalRound || legalRound.stage !== "legal_rrhh") throw new RiskLegalDomainError("No hay una aprobación Legal y RRHH pendiente; recarga la MIPER.")
    const [technicalRound] = await tx.select().from(preventionRiskReviewRounds).where(and(
      eq(preventionRiskReviewRounds.matrixId, matrix.id), eq(preventionRiskReviewRounds.stage, "technical"), eq(preventionRiskReviewRounds.decision, "approved"),
    )).orderBy(desc(preventionRiskReviewRounds.roundNumber)).limit(1)
    if (!technicalRound?.decidedByUserId) throw new RiskLegalDomainError("Falta la revisión técnica aprobada de esta MIPER.")
    assertNotSubmitter(access, legalRound.submittedByUserId, "Quien elaboró la MIPER no puede aprobarla.")
    const signing = resolveOwnWorkSigning({ signedByUserId: technicalRound.decidedByUserId, actorUserId: access.userId, permissions: access.permissions, what: "Aprobar la MIPER como Legal y RRHH" })
    if (!signing.ok) throw new RiskLegalDomainError("Quien hizo la revisión técnica no puede firmar la aprobación Legal y RRHH: debe firmarla otra persona.")
    const open = await countObservations(tx, and(eq(preventionRiskObservations.matrixId, matrix.id), eq(preventionRiskObservations.status, "open")))
    if (open > 0) throw new RiskLegalDomainError(`Hay ${open} observación(es) abierta(s): solicita correcciones o resuélvelas antes de aprobar.`)

    const now = nowIso()
    await autoResolveAnswered(tx, matrix.id, access.userId, now)
    await tx.update(preventionRiskReviewRounds).set({ decision: "approved", decidedByUserId: access.userId, decidedAt: now, decisionComment: data.comment ?? null }).where(eq(preventionRiskReviewRounds.id, legalRound.id))

    const previous = await latestVersion(tx, matrix.id)
    const versionNumber = (previous?.versionNumber ?? 0) + 1
    const names = await userNames(tx, [legalRound.submittedByUserId, technicalRound.decidedByUserId, access.userId])
    const versionId = `riskversion-${nanoid()}`
    await tx.insert(preventionRiskMatrixVersions).values({
      id: versionId, matrixId: matrix.id, versionNumber, period: matrix.period, roundId: legalRound.id,
      snapshot: legalRound.snapshot, snapshotSha256: legalRound.snapshotSha256, changeSummary: data.changeSummary,
      elaboratedByUserId: legalRound.submittedByUserId, technicalReviewerUserId: technicalRound.decidedByUserId, approverUserId: access.userId,
      elaboratedByName: names.get(legalRound.submittedByUserId) ?? legalRound.submittedByUserId,
      technicalReviewerName: names.get(technicalRound.decidedByUserId) ?? technicalRound.decidedByUserId,
      approverName: names.get(access.userId) ?? access.userId,
      approvedAt: now,
    })

    const firstSeal = matrix.status === "draft"
    if (firstSeal) {
      // El período nuevo reemplaza al vigente de la faena. Antes del UPDATE de
      // esta matriz: el índice parcial admite un solo `published` por faena.
      const vigentes = await tx.select().from(preventionRiskMatrices).where(and(
        eq(preventionRiskMatrices.worksiteId, matrix.worksiteId), eq(preventionRiskMatrices.status, "published"), ne(preventionRiskMatrices.id, matrix.id),
      ))
      for (const vigente of vigentes) {
        await tx.update(preventionRiskMatrices).set({ status: "superseded", reviewState: "none", version: vigente.version + 1, updatedAt: now }).where(eq(preventionRiskMatrices.id, vigente.id))
        /* Las ocurrencias pendientes del programa reemplazado pasan a
         * `superseded` ("reemplazadas") y dejan de contar; lo ya registrado se
         * conserva (§7.4). */
        await supersedePendingOccurrences(tx, vigente.id)
        await miperHistory(tx, { matrixId: vigente.id, worksiteId: vigente.worksiteId, object: "matrix", objectId: vigente.id, changeType: "superseded", reason: `Reemplazada por la MIPER del período ${matrix.period}.`, after: { supersededByMatrixId: matrix.id }, actorUserId: access.userId, actingAs: "prevention:risk:approve_legal" })
      }
    }
    const effectiveFrom = matrix.effectiveFrom ?? todayInChile()
    const reviewDueAt = matrix.reviewDueAt ?? addDaysToPlainDate(effectiveFrom, 365)
    await setReviewState(tx, matrix, "none", now, {
      status: "published",
      reviewedByUserId: technicalRound.decidedByUserId, reviewedAt: technicalRound.decidedAt,
      approvedByUserId: access.userId, approvedAt: now,
      publishedByUserId: access.userId, publishedAt: now, publishedHashSha256: legalRound.snapshotSha256,
      effectiveFrom, reviewDueAt,
    })

    if (firstSeal) {
      /* El MIPER en borrador tiene actividades pero no ocurrencias ejecutables:
       * la primera aprobación las genera todas (§7.4). Ya dentro de la
       * transacción, así que va por `tx` —nunca por la conexión global—. */
      const [program] = await tx.select({ id: preventionRiskPrograms.id, period: preventionRiskPrograms.period }).from(preventionRiskPrograms)
        .where(eq(preventionRiskPrograms.matrixId, matrix.id)).limit(1)
      if (program) {
        const actions = await tx.select().from(preventionRiskProgramActions)
          .where(and(eq(preventionRiskProgramActions.programId, program.id), eq(preventionRiskProgramActions.status, "active")))
        for (const action of actions) await syncOccurrences(tx, action, program.period)
      }
      await createRiskReviewTriggerWithClient(tx, {
        worksiteId: matrix.worksiteId, matrixId: matrix.id, triggerType: "annual", sourceType: "risk_matrix", sourceId: matrix.id,
        description: `Revisión anual de la MIPER del período ${matrix.period}.`, dueAt: reviewDueAt, idempotencyKey: `miper:annual:${matrix.id}`,
      }, access.userId)
    }
    // Cada versión sellada abre su propio reloj de 30 días para actualizar el PDTP (DS 44).
    await tx.insert(preventionPdtpUpdateObligations).values({
      id: `pdtpob-${nanoid()}`,
      idempotencyKey: `miper:pdtp30:${matrix.id}:v${versionNumber}`,
      worksiteId: matrix.worksiteId,
      sourceType: "risk_matrix",
      sourceId: matrix.id,
      sourceVersionSnapshot: `MIPER ${matrix.period} v${versionNumber} · ${legalRound.snapshotSha256}`,
      dueAt: addDaysToPlainDate(todayInChile(), 30),
    }).onConflictDoNothing()
    await enqueueGeneratedDocumentTx(tx, { kind: "miper", entityId: versionId, milestone: "aprobada", worksiteId: matrix.worksiteId, occurredAt: now, actorUserId: access.userId })
    const [counted] = await tx.select({ count: sql<number>`count(*)::int` }).from(preventionRiskEntries).where(eq(preventionRiskEntries.matrixId, matrix.id))
    const entryCount = counted?.count ?? 0
    accreditation = { actorUserId: access.userId, matrixId: matrix.id, worksiteId: matrix.worksiteId, matrixVersion: versionNumber, publishedAt: now, entryCount }
    await miperHistory(tx, {
      matrixId: matrix.id, worksiteId: matrix.worksiteId, object: "version", objectId: versionId, changeType: "version_sealed",
      reason: signing.usedException ? `${data.changeSummary} [Firma propia con la excepción prevention:sign_own_work.]` : data.changeSummary,
      after: { versionNumber, snapshotSha256: legalRound.snapshotSha256 }, actorUserId: access.userId, actingAs: "prevention:risk:approve_legal",
    })
    return { versionId, versionNumber }
  })
  if (accreditation) await onRiskMatrixPublished(accreditation)
  return result
}
