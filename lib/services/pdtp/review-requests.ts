/**
 * lib/services/pdtp/review-requests.ts
 *
 * Solicitudes que sacan algo del cumplimiento y que, por eso, las pide una
 * persona y las aprueba otra (PRV-05 y PRV-12, auditoría 2026-09-28):
 *
 * - Cancelar una obligación "cuando corresponda": la saca del indicador de
 *   plazos. Antes bastaba el permiso y un motivo, incluso en un mes cerrado.
 * - Anular una ejecución manual ya aprobada: el error del aprobador o una
 *   evidencia que resultó falsa. Antes no había ninguna vía para corregirlo.
 * - Reducir una meta por faena (M-06): baja el denominador. La solicitud la
 *   crea `overrides.ts`; aquí se aprueba y se aplica.
 *
 * Replica el contrato de `scheduled-outcome-review.ts`: una sola solicitud en
 * revisión por objeto, la revisa alguien distinto de quien la pidió (también
 * lo impone un CHECK), el mes afectado tiene que estar abierto al pedirla y al
 * resolverla, y todo queda en el control de cambios del programa.
 */

import { and, desc, eq, inArray, sql } from "drizzle-orm"
import { z } from "zod"
import { db, type Tx } from "@/db"
import {
  pdtpActivities,
  pdtpActivityScheduleOverrides,
  pdtpExecutions,
  pdtpObligations,
  pdtpPrograms,
  pdtpReviewRequests,
  users,
  worksites,
  type PdtpReviewRequest,
} from "@/db/schema"
import { nanoid } from "@/lib/id"
import { PDTP_REASON_MIN_LENGTH } from "@/lib/prevention/pdtp"
import { chileDateParts } from "@/lib/utils"
import { recordOperationalActivity } from "@/lib/services/operational-activity"
import { addPdtpChangeLogEntry, assertWorksiteAccess, type WorksiteScope } from "./helpers"
import { applyPdtpObligationCancellation } from "./obligations"
import { assertPdtpPeriodOpenForExecution } from "./executions"
import { assertPdtpPeriodOpen } from "./period-guard"
import { assertPdtpProgramAcceptsReview } from "./version-window"
import { pdtpExecutionHistorySnapshot, recordPdtpExecutionHistory } from "./execution-history"
import { syncPdtpScheduledInstanceFromExecution } from "./scheduled-execution"
import { removePdtpActivityOverride, writePdtpActivityOverride, type PdtpOverrideReductionPayload } from "./overrides"

export type PdtpReviewRequestKind = "obligation_cancellation" | "execution_annulment" | "override_reduction"

const reasonSchema = z.string().trim().min(PDTP_REASON_MIN_LENGTH, `El motivo debe tener al menos ${PDTP_REASON_MIN_LENGTH} caracteres`).max(1000)

export const pdtpReviewRequestCreateSchema = z.object({
  targetId: z.string().min(1),
  reason: reasonSchema,
})

export const pdtpReviewRequestDecisionSchema = z.object({
  requestId: z.string().min(1),
  decision: z.enum(["approve", "reject"]),
  reason: z.string().trim().max(1000).optional(),
})

async function programVersion(tx: Tx, programId: string) {
  const [program] = await tx.select({ version: pdtpPrograms.version, year: pdtpPrograms.year }).from(pdtpPrograms)
    .where(eq(pdtpPrograms.id, programId)).limit(1)
  if (!program) throw new Error("Programa PDTP no encontrado.")
  return program
}

/** El mes que la obligación ocupa en el indicador de plazos (mismo criterio que `compliance.ts`). */
function obligationIndicatorMonth(dueAt: string | null, programYear: number): number | null {
  if (!dueAt) return null
  const due = chileDateParts(dueAt)
  return due.year > programYear ? 12 : due.year < programYear ? 1 : due.month
}

async function assertObligationPeriodOpen(tx: Tx, obligation: typeof pdtpObligations.$inferSelect) {
  const program = await programVersion(tx, obligation.programId)
  const month = obligationIndicatorMonth(obligation.dueAt, program.year)
  await assertPdtpProgramAcceptsReview(obligation.programId, { year: program.year, month: month ?? 1, week: 1 }, tx)
  if (month !== null) await assertPdtpPeriodOpen(obligation.programId, obligation.worksiteId, program.year, month, tx)
  return program
}

async function lockObligation(tx: Tx, obligationId: string) {
  await tx.execute(sql`SELECT id FROM ${pdtpObligations} WHERE ${pdtpObligations.id} = ${obligationId} FOR UPDATE`)
  const [obligation] = await tx.select().from(pdtpObligations).where(eq(pdtpObligations.id, obligationId)).limit(1)
  if (!obligation) throw new Error("Obligación PDTP no encontrada.")
  return obligation
}

async function lockExecution(tx: Tx, executionId: string) {
  await tx.execute(sql`SELECT id FROM ${pdtpExecutions} WHERE ${pdtpExecutions.id} = ${executionId} FOR UPDATE`)
  const [execution] = await tx.select().from(pdtpExecutions).where(eq(pdtpExecutions.id, executionId)).limit(1)
  if (!execution) throw new Error("Ejecución PDTP no encontrada.")
  const [activity] = await tx.select({ programId: pdtpActivities.programId, n: pdtpActivities.n }).from(pdtpActivities)
    .where(eq(pdtpActivities.id, execution.activityId)).limit(1)
  if (!activity) throw new Error("Actividad PDTP no encontrada.")
  return { execution, activity }
}

async function insertRequest(tx: Tx, values: {
  kind: PdtpReviewRequestKind
  targetId: string
  programId: string
  worksiteId: string
  reason: string
  userId: string
}) {
  const [pending] = await tx.select({ id: pdtpReviewRequests.id, requestedByUserId: pdtpReviewRequests.requestedByUserId })
    .from(pdtpReviewRequests)
    .where(and(eq(pdtpReviewRequests.kind, values.kind), eq(pdtpReviewRequests.targetId, values.targetId), eq(pdtpReviewRequests.status, "pending_review")))
    .limit(1)
  if (pending) throw new Error("Ya hay una solicitud en revisión para este registro.")
  const [created] = await tx.insert(pdtpReviewRequests).values({
    id: `pdtp-rr-${nanoid()}`,
    kind: values.kind,
    targetId: values.targetId,
    programId: values.programId,
    worksiteId: values.worksiteId,
    reason: values.reason,
    status: "pending_review",
    requestedByUserId: values.userId,
    requestedAt: new Date().toISOString(),
  }).returning()
  return created!
}

/** PRV-05: pedir que se cancele una obligación pendiente o vencida. */
export async function requestPdtpObligationCancellation(input: unknown, userId: string, scope: WorksiteScope): Promise<PdtpReviewRequest> {
  const data = pdtpReviewRequestCreateSchema.parse(input)
  return db.transaction(async (tx) => {
    const obligation = await lockObligation(tx, data.targetId)
    assertWorksiteAccess(obligation.worksiteId, scope)
    if (obligation.status !== "pending" && obligation.status !== "overdue") {
      throw new Error("Sólo se puede pedir la cancelación de una obligación pendiente o vencida.")
    }
    const program = await assertObligationPeriodOpen(tx, obligation)
    const request = await insertRequest(tx, { kind: "obligation_cancellation", targetId: obligation.id, programId: obligation.programId, worksiteId: obligation.worksiteId, reason: data.reason, userId })
    await addPdtpChangeLogEntry(
      obligation.programId, program.version, userId, `review-request:${request.id}`,
      null, { kind: request.kind, targetId: obligation.id, status: "pending_review", reason: data.reason },
      "Cancelación de obligación solicitada; queda en revisión hasta que otra persona la resuelva.",
      tx,
    )
    return request
  })
}

/** PRV-12: pedir que se anule una ejecución manual ya aprobada. */
export async function requestPdtpExecutionAnnulment(input: unknown, userId: string, scope: WorksiteScope): Promise<PdtpReviewRequest> {
  const data = pdtpReviewRequestCreateSchema.parse(input)
  return db.transaction(async (tx) => {
    const { execution, activity } = await lockExecution(tx, data.targetId)
    assertWorksiteAccess(execution.worksiteId, scope)
    if (execution.status !== "approved") throw new Error("Sólo se puede anular una ejecución aprobada.")
    // La integración se corrige en su módulo de origen: anular allá revoca acá.
    if (execution.origin === "integration") {
      throw new Error("Esta ejecución viene de otro módulo: se corrige anulando el registro de origen, que revoca el cumplimiento.")
    }
    await assertPdtpPeriodOpenForExecution(tx, execution)
    const program = await programVersion(tx, activity.programId)
    const request = await insertRequest(tx, { kind: "execution_annulment", targetId: execution.id, programId: activity.programId, worksiteId: execution.worksiteId, reason: data.reason, userId })
    await addPdtpChangeLogEntry(
      activity.programId, program.version, userId, `review-request:${request.id}`,
      null, { kind: request.kind, targetId: execution.id, status: "pending_review", reason: data.reason },
      `Anulación de la ejecución de la N°${activity.n} (mes ${execution.month}, semana ${execution.week}) solicitada; queda en revisión.`,
      tx,
    )
    return request
  })
}

async function applyOverrideReduction(tx: Tx, request: PdtpReviewRequest, reviewerUserId: string) {
  const payload = request.payloadJson as PdtpOverrideReductionPayload | null
  if (!payload) throw new Error("La solicitud no trae la celda a reducir.")
  const [activity] = await tx.select({ programId: pdtpActivities.programId, n: pdtpActivities.n }).from(pdtpActivities)
    .where(eq(pdtpActivities.id, payload.activityId)).limit(1)
  if (!activity) throw new Error("Actividad PDTP no encontrada.")
  const [program] = await tx.select({ status: pdtpPrograms.status, version: pdtpPrograms.version }).from(pdtpPrograms)
    .where(eq(pdtpPrograms.id, activity.programId)).limit(1)
  if (!program || program.status !== "active") throw new Error("El programa ya no está activo: la reducción quedó sin objeto.")
  await assertPdtpPeriodOpen(activity.programId, payload.worksiteId, payload.year, payload.month, tx)
  const [existing] = await tx.select().from(pdtpActivityScheduleOverrides).where(and(
    eq(pdtpActivityScheduleOverrides.activityId, payload.activityId),
    eq(pdtpActivityScheduleOverrides.worksiteId, payload.worksiteId),
    eq(pdtpActivityScheduleOverrides.year, payload.year),
    eq(pdtpActivityScheduleOverrides.month, payload.month),
    eq(pdtpActivityScheduleOverrides.week, payload.week),
  )).limit(1).for("update")
  const cell = { activityId: payload.activityId, worksiteId: payload.worksiteId, year: payload.year, month: payload.month, week: payload.week, reason: request.reason }
  const common = { programId: activity.programId, programVersion: program.version, activityN: activity.n }
  // La meta la aplica quien aprueba: es la segunda persona la que asume el cambio.
  if (payload.mode === "delete") {
    if (existing) await removePdtpActivityOverride(tx, { ...cell, ...common, existing }, reviewerUserId)
  } else {
    await writePdtpActivityOverride(tx, { ...cell, ...common, plannedQuantity: payload.plannedQuantity, before: existing ?? null }, reviewerUserId)
  }
  return activity
}

async function applyExecutionAnnulment(tx: Tx, request: PdtpReviewRequest, reviewerUserId: string) {
  const { execution, activity } = await lockExecution(tx, request.targetId)
  if (execution.status !== "approved") throw new Error("La ejecución ya no está aprobada; la solicitud quedó sin objeto.")
  await assertPdtpPeriodOpenForExecution(tx, execution)
  const now = new Date().toISOString()
  const [updated] = await tx.update(pdtpExecutions).set({
    status: "rejected",
    rejectedByUserId: reviewerUserId,
    rejectedAt: now,
    rejectionReason: `Aprobación anulada: ${request.reason}`,
    sourceMetadataJson: {
      ...((execution.sourceMetadataJson ?? {}) as Record<string, unknown>),
      annulment: { requestId: request.id, requestedByUserId: request.requestedByUserId, approvedByUserId: reviewerUserId, at: now, reason: request.reason },
    },
    updatedAt: now,
  }).where(and(eq(pdtpExecutions.id, execution.id), eq(pdtpExecutions.status, "approved"))).returning()
  if (!updated) throw new Error("La ejecución cambió de estado antes de poder anularse.")
  if (execution.obligationId) {
    await tx.update(pdtpObligations).set({
      status: sql`CASE WHEN ${pdtpObligations.dueAt} < ${now} THEN 'overdue' ELSE 'pending' END`,
      completedQuantity: 0,
      completedAt: null,
      reportedAt: null,
      updatedAt: now,
    }).where(and(eq(pdtpObligations.id, execution.obligationId), eq(pdtpObligations.status, "completed")))
  }
  if (updated.scheduledInstanceId) {
    await syncPdtpScheduledInstanceFromExecution(tx, { executionId: updated.id, trigger: "rejection", userId: reviewerUserId, reason: request.reason })
  }
  await recordPdtpExecutionHistory(tx, {
    executionId: updated.id,
    worksiteId: updated.worksiteId,
    changeType: "revoked",
    actorUserId: reviewerUserId,
    before: pdtpExecutionHistorySnapshot(execution),
    after: pdtpExecutionHistorySnapshot(updated),
  })
  await recordOperationalActivity({
    eventType: "pdtp.execution_annulled",
    module: "pdtp",
    entityType: "pdtp_execution",
    entityId: updated.id,
    worksiteId: updated.worksiteId,
    actorUserId: reviewerUserId,
    payload: { requestId: request.id, reason: request.reason },
  }, tx)
  return activity
}

export async function reviewPdtpReviewRequest(input: unknown, reviewerUserId: string, scope: WorksiteScope): Promise<PdtpReviewRequest> {
  const data = pdtpReviewRequestDecisionSchema.parse(input)
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT id FROM ${pdtpReviewRequests} WHERE ${pdtpReviewRequests.id} = ${data.requestId} FOR UPDATE`)
    const [request] = await tx.select().from(pdtpReviewRequests).where(eq(pdtpReviewRequests.id, data.requestId)).limit(1)
    if (!request) throw new Error("Solicitud no encontrada.")
    assertWorksiteAccess(request.worksiteId, scope)
    if (request.status !== "pending_review") throw new Error("La solicitud ya fue resuelta.")
    if (request.requestedByUserId === reviewerUserId) {
      throw new Error("No puedes revisar tu propia solicitud: debe hacerlo otra persona.")
    }
    const reviewReason = data.reason?.trim() || null
    if (data.decision === "reject" && (reviewReason?.length ?? 0) < PDTP_REASON_MIN_LENGTH) {
      throw new Error(`Para rechazar indica el motivo (mínimo ${PDTP_REASON_MIN_LENGTH} caracteres).`)
    }

    let note: string
    if (data.decision === "approve") {
      if (request.kind === "obligation_cancellation") {
        const obligation = await lockObligation(tx, request.targetId)
        await assertObligationPeriodOpen(tx, obligation)
        await applyPdtpObligationCancellation(tx, { obligationId: obligation.id, userId: reviewerUserId, reason: request.reason, scope })
        note = "Cancelación de obligación aprobada por una segunda persona."
      } else if (request.kind === "override_reduction") {
        const activity = await applyOverrideReduction(tx, request, reviewerUserId)
        note = `Reducción de meta por faena de la N°${activity.n} aprobada por una segunda persona.`
      } else {
        const activity = await applyExecutionAnnulment(tx, request, reviewerUserId)
        note = `Anulación de la ejecución de la N°${activity.n} aprobada por una segunda persona.`
      }
    } else {
      note = request.kind === "obligation_cancellation"
        ? "Cancelación de obligación rechazada: la obligación se sigue exigiendo."
        : request.kind === "override_reduction"
          ? "Reducción de meta rechazada: la meta se mantiene."
          : "Anulación de ejecución rechazada: la aprobación se mantiene."
    }

    const now = new Date().toISOString()
    const [resolved] = await tx.update(pdtpReviewRequests).set({
      status: data.decision === "approve" ? "approved" : "rejected",
      reviewedByUserId: reviewerUserId,
      reviewedAt: now,
      reviewReason,
    }).where(and(eq(pdtpReviewRequests.id, request.id), eq(pdtpReviewRequests.status, "pending_review"))).returning()
    if (!resolved) throw new Error("La solicitud cambió antes de poder resolverse.")
    const program = await programVersion(tx, request.programId)
    await addPdtpChangeLogEntry(
      request.programId, program.version, reviewerUserId, `review-request:${request.id}`,
      { status: "pending_review" }, { status: resolved.status, reviewReason },
      note,
      tx,
    )
    return resolved
  })
}

export async function withdrawPdtpReviewRequest(requestId: string, userId: string): Promise<PdtpReviewRequest> {
  return db.transaction(async (tx) => {
    const [request] = await tx.select().from(pdtpReviewRequests).where(eq(pdtpReviewRequests.id, requestId)).limit(1)
    if (!request) throw new Error("Solicitud no encontrada.")
    if (request.requestedByUserId !== userId) throw new Error("Sólo quien pidió la solicitud puede retirarla.")
    if (request.status !== "pending_review") throw new Error("La solicitud ya fue resuelta.")
    const [withdrawn] = await tx.update(pdtpReviewRequests).set({ status: "withdrawn", withdrawnByUserId: userId, withdrawnAt: new Date().toISOString() })
      .where(and(eq(pdtpReviewRequests.id, request.id), eq(pdtpReviewRequests.status, "pending_review"))).returning()
    if (!withdrawn) throw new Error("La solicitud cambió antes de poder retirarse.")
    const program = await programVersion(tx, request.programId)
    await addPdtpChangeLogEntry(request.programId, program.version, userId, `review-request:${request.id}`,
      { status: "pending_review" }, { status: "withdrawn" }, "Solicitud retirada por quien la pidió.", tx)
    return withdrawn
  })
}

export type PendingPdtpReviewRequest = {
  id: string
  kind: PdtpReviewRequestKind
  targetId: string
  worksiteName: string
  reason: string
  requestedByUserId: string
  requestedByName: string | null
  requestedAt: string
  description: string
}

export async function listPendingPdtpReviewRequests(
  scope: WorksiteScope,
  filter: { programId?: string } = {},
): Promise<PendingPdtpReviewRequest[]> {
  const rows = await db.select({
    request: pdtpReviewRequests,
    worksiteName: worksites.name,
    requestedByName: users.name,
  })
    .from(pdtpReviewRequests)
    .innerJoin(worksites, eq(worksites.id, pdtpReviewRequests.worksiteId))
    .leftJoin(users, eq(users.id, pdtpReviewRequests.requestedByUserId))
    .where(and(
      eq(pdtpReviewRequests.status, "pending_review"),
      filter.programId ? eq(pdtpReviewRequests.programId, filter.programId) : undefined,
      scope === "all" ? undefined : inArray(pdtpReviewRequests.worksiteId, scope),
    ))
    .orderBy(desc(pdtpReviewRequests.requestedAt))
  if (rows.length === 0) return []

  const reductionActivityIds = rows.filter((row) => row.request.kind === "override_reduction")
    .map((row) => (row.request.payloadJson as PdtpOverrideReductionPayload | null)?.activityId)
    .filter((id): id is string => !!id)
  const reductionActivities = reductionActivityIds.length
    ? await db.select({ id: pdtpActivities.id, n: pdtpActivities.n, name: pdtpActivities.activity }).from(pdtpActivities).where(inArray(pdtpActivities.id, reductionActivityIds))
    : []
  const reductionActivityById = new Map(reductionActivities.map((row) => [row.id, row]))
  const obligationIds = rows.filter((row) => row.request.kind === "obligation_cancellation").map((row) => row.request.targetId)
  const executionIds = rows.filter((row) => row.request.kind === "execution_annulment").map((row) => row.request.targetId)
  const [obligations, executions] = await Promise.all([
    obligationIds.length
      ? db.select({ id: pdtpObligations.id, n: pdtpActivities.n, name: pdtpActivities.activity })
        .from(pdtpObligations).innerJoin(pdtpActivities, eq(pdtpActivities.id, pdtpObligations.activityId))
        .where(inArray(pdtpObligations.id, obligationIds))
      : [],
    executionIds.length
      ? db.select({ id: pdtpExecutions.id, n: pdtpActivities.n, name: pdtpActivities.activity, month: pdtpExecutions.month, week: pdtpExecutions.week })
        .from(pdtpExecutions).innerJoin(pdtpActivities, eq(pdtpActivities.id, pdtpExecutions.activityId))
        .where(inArray(pdtpExecutions.id, executionIds))
      : [],
  ])
  const obligationById = new Map(obligations.map((row) => [row.id, row]))
  const executionById = new Map(executions.map((row) => [row.id, row]))

  return rows.map(({ request, worksiteName, requestedByName }) => {
    const obligation = obligationById.get(request.targetId)
    const execution = executionById.get(request.targetId)
    const reduction = request.kind === "override_reduction" ? request.payloadJson as PdtpOverrideReductionPayload | null : null
    const reductionActivity = reduction ? reductionActivityById.get(reduction.activityId) : undefined
    const description = reduction
      ? `Bajar la meta de la N°${reductionActivity?.n ?? "?"} ${reductionActivity?.name ?? ""} (mes ${reduction.month}, semana ${reduction.week}) de ${reduction.previousQuantity} a ${reduction.plannedQuantity}${reduction.mode === "delete" ? " (vuelve al catálogo)" : ""}`.replace(/\s+/g, " ")
      : request.kind === "obligation_cancellation"
      ? `Cancelar la obligación de la N°${obligation?.n ?? "?"} ${obligation?.name ?? ""}`.trim()
      : `Anular la ejecución aprobada de la N°${execution?.n ?? "?"} ${execution?.name ?? ""} (mes ${execution?.month ?? "?"}, semana ${execution?.week ?? "?"})`.trim()
    return {
      id: request.id,
      kind: request.kind as PdtpReviewRequestKind,
      targetId: request.targetId,
      worksiteName,
      reason: request.reason,
      requestedByUserId: request.requestedByUserId,
      requestedByName,
      requestedAt: request.requestedAt,
      description,
    }
  })
}
