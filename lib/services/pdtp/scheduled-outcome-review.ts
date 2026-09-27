/**
 * lib/services/pdtp/scheduled-outcome-review.ts
 *
 * PREV-C07 sobre ocurrencias programadas (0334). El "no aplica" y la
 * cancelación de una ocurrencia la sacan del denominador del indicador. Hasta
 * 0334 lo hacían en el acto y con un solo actor; ahora siguen la regla del N/A
 * de celda (T2, D8):
 *
 * - `requestPdtpScheduledInstanceOutcome` deja una solicitud `pending_review`
 *   y **no toca la ocurrencia**: sigue `pending`/`in_progress`/`submitted` y
 *   sigue contando. El indicador no cambia hasta que se aprueba.
 * - `reviewPdtpScheduledInstanceOutcome` la aprueba (recién ahí la ocurrencia
 *   pasa a `not_applicable`/`cancelled`) o la rechaza con motivo. Revisa otra
 *   persona con `prevention:pdtp:approve` (la acción valida el permiso; el
 *   servicio y el CHECK, la segregación).
 * - `withdrawPdtpScheduledInstanceOutcomeRequest`: sólo quien la pidió.
 * - `withdrawPendingPdtpScheduledOutcomeRequests`: la llama la sincronización
 *   con el libro cuando una ejecución aprobada cumple la ocurrencia.
 *
 * **Orden de bloqueos: advisory de la ocurrencia → (ejecución) → ocurrencia
 * `FOR UPDATE` → solicitud `FOR UPDATE`.** La sincronización con el libro ya
 * bloquea ejecución → ocurrencia y, con este módulo, después la solicitud; acá
 * nunca se bloquea una solicitud antes que su ocurrencia, así que no hay ciclo.
 * El advisory serializa pedir, revisar y retirar sobre la misma ocurrencia.
 */
import { and, eq, inArray, sql } from "drizzle-orm"
import { db, type Tx } from "@/db"
import {
  pdtpActivities,
  pdtpPrograms,
  pdtpScheduledInstanceOutcomeRequests,
  pdtpScheduledInstances,
  users,
  worksites,
} from "@/db/schema"
import { nanoid } from "@/lib/id"
import { formatDate, todayInChile } from "@/lib/utils"
import { PDTP_REASON_MIN_LENGTH } from "@/lib/prevention/pdtp"
import { pdtpScheduledInstanceOutcomeReviewSchema, pdtpScheduledInstanceOutcomeWithdrawSchema } from "@/lib/validation/prevention"
import { addPdtpChangeLogEntry, assertWorksiteAccess, isUniqueViolation, type WorksiteScope } from "./helpers"
import { assertPdtpPeriodOpen } from "./period-guard"
import { pdtpPeriodFromChileDate } from "./period"
import { assertPdtpProgramAcceptsReview } from "./version-window"

export type PdtpScheduledOutcome = "not_applicable" | "cancelled"
export type PdtpScheduledInstanceRow = typeof pdtpScheduledInstances.$inferSelect
export type PdtpScheduledOutcomeRequestRow = typeof pdtpScheduledInstanceOutcomeRequests.$inferSelect

const OUTCOME_LABEL: Record<PdtpScheduledOutcome, string> = {
  not_applicable: "\"No aplica\"",
  cancelled: "Cancelación",
}

const TERMINAL_STATUSES = ["completed", "not_applicable", "cancelled"]

/** Clave del advisory lock de una ocurrencia. */
export function pdtpScheduledInstanceLockKey(instanceId: string): string {
  return `pdtp-instance:${instanceId}`
}

async function lockInstance(tx: Tx, instanceId: string): Promise<PdtpScheduledInstanceRow> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${pdtpScheduledInstanceLockKey(instanceId)}))`)
  const [row] = await tx.select().from(pdtpScheduledInstances)
    .where(eq(pdtpScheduledInstances.id, instanceId)).limit(1).for("update")
  if (!row) throw new Error("Instancia programada no encontrada.")
  return row
}

function periodOf(scheduledFor: string) {
  const period = pdtpPeriodFromChileDate(scheduledFor)
  if (!period) throw new Error("La ocurrencia no tiene una fecha válida.")
  return period
}

async function activityAndVersion(tx: Tx, instance: PdtpScheduledInstanceRow) {
  const [row] = await tx.select({ n: pdtpActivities.n, version: pdtpPrograms.version })
    .from(pdtpActivities)
    .innerJoin(pdtpPrograms, eq(pdtpPrograms.id, pdtpActivities.programId))
    .where(eq(pdtpActivities.id, instance.activityId)).limit(1)
  if (!row) throw new Error("Actividad PDTP no encontrada.")
  return row
}

function sourceMetadata(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {}
  return value as Record<string, unknown>
}

/**
 * Motivo recortado de un resultado, o `null` si no trae. PREV-C07: el "No
 * aplica" (y, desde la revisión final, la cancelación) de una instancia exige
 * el mismo mínimo que el de una celda (`PDTP_REASON_MIN_LENGTH`, igual que
 * `pdtpDeviationSchema` y el CHECK de `pdtp_execution_deviations`); antes
 * bastaban 3 caracteres.
 */
export function assertPdtpScheduledOutcomeReason(nextStatus: string, rawReason: string | null | undefined): string | null {
  const reason = rawReason?.trim() || null
  if (nextStatus === "not_applicable") {
    if (!reason) throw new Error("Indica por qué la instancia no aplica.")
    if (reason.length < PDTP_REASON_MIN_LENGTH) {
      throw new Error(`El motivo de "no aplica" debe tener al menos ${PDTP_REASON_MIN_LENGTH} caracteres.`)
    }
  }
  // Revisión final 2026-09-27: cancelar también saca la ocurrencia del
  // denominador, así que exige el mismo mínimo (antes bastaban 3 caracteres).
  if (nextStatus === "cancelled") {
    if (!reason) throw new Error("Indica el motivo de cancelación.")
    if (reason.length < PDTP_REASON_MIN_LENGTH) {
      throw new Error(`El motivo de cancelación debe tener al menos ${PDTP_REASON_MIN_LENGTH} caracteres.`)
    }
  }
  return reason
}

/**
 * El "no aplica" no se declara sobre una ocurrencia que todavía no ocurre
 * (fecha de Chile), igual que el de celda (`isPdtpCellInFuture`). La
 * cancelación sí se admite a futuro: su caso típico es una ocurrencia
 * duplicada o mal programada, que conviene quitar antes de que llegue.
 */
export function assertPdtpScheduledOutcomeNotInFuture(outcome: PdtpScheduledOutcome, scheduledFor: string, today = todayInChile()): void {
  if (outcome === "not_applicable" && scheduledFor > today) {
    throw new Error(`No se puede declarar 'no aplica' para una ocurrencia que aún no ocurre (programada para el ${formatDate(scheduledFor)}).`)
  }
}

/**
 * Pide el "no aplica" o la cancelación de una ocurrencia. Corre dentro de la
 * transacción de `recordPdtpScheduledInstanceOutcome`. Orden de validación,
 * con la ocurrencia ya bloqueada: estado, solicitud pendiente, fecha futura,
 * ventana de la versión, mes abierto, motivo y evidencia.
 *
 * Idempotencia: si la ocurrencia ya tiene ese resultado (por ejemplo, un "no
 * aplica" anterior a 0334), o si quien pide ya tiene la misma solicitud en
 * revisión, se devuelve lo existente sin escribir.
 */
export async function requestPdtpScheduledInstanceOutcome(tx: Tx, input: {
  instanceId: string
  outcome: PdtpScheduledOutcome
  userId: string
  reason: string | null | undefined
  evidenceRef?: string | null
  assertEvidence?: (instance: PdtpScheduledInstanceRow) => Promise<void>
}): Promise<{ instance: PdtpScheduledInstanceRow; request: PdtpScheduledOutcomeRequestRow | null }> {
  const instance = await lockInstance(tx, input.instanceId)
  if (instance.status === input.outcome) return { instance, request: null }
  if (TERMINAL_STATUSES.includes(instance.status)) throw new Error("La instancia programada ya tiene un resultado terminal.")

  const [pending] = await tx.select().from(pdtpScheduledInstanceOutcomeRequests)
    .where(and(
      eq(pdtpScheduledInstanceOutcomeRequests.instanceId, instance.id),
      eq(pdtpScheduledInstanceOutcomeRequests.status, "pending_review"),
    )).limit(1)
  if (pending) {
    if (pending.outcome === input.outcome && pending.requestedByUserId === input.userId) return { instance, request: pending }
    throw new Error(`La ocurrencia ya tiene una solicitud de ${OUTCOME_LABEL[pending.outcome as PdtpScheduledOutcome].toLowerCase()} pendiente de revisión. Espera la revisión o pide a quien la hizo que la retire.`)
  }

  assertPdtpScheduledOutcomeNotInFuture(input.outcome, instance.scheduledFor)
  const period = periodOf(instance.scheduledFor)
  await assertPdtpProgramAcceptsReview(instance.programId, period, tx)
  await assertPdtpPeriodOpen(instance.programId, instance.worksiteId, period.year, period.month, tx)
  const reason = assertPdtpScheduledOutcomeReason(input.outcome, input.reason) ?? ""
  if (input.assertEvidence) await input.assertEvidence(instance)

  const now = new Date().toISOString()
  let request: PdtpScheduledOutcomeRequestRow | undefined
  try {
    // SAVEPOINT: una violación del índice único (otra solicitud ganó la
    // carrera) no deja inutilizable la transacción del llamador.
    request = await tx.transaction(async (sp) => {
      const [row] = await sp.insert(pdtpScheduledInstanceOutcomeRequests).values({
        id: `pdtp-sor-${nanoid()}`,
        instanceId: instance.id,
        outcome: input.outcome,
        reason,
        evidenceRef: input.evidenceRef ?? null,
        status: "pending_review",
        requestedByUserId: input.userId,
        requestedAt: now,
      }).returning()
      return row
    })
  } catch (error) {
    if (isUniqueViolation(error)) throw new Error("La ocurrencia ya tiene una solicitud pendiente de revisión.")
    throw error
  }
  if (!request) throw new Error("No se pudo registrar la solicitud.")

  const activity = await activityAndVersion(tx, instance)
  await addPdtpChangeLogEntry(
    instance.programId, activity.version, input.userId, `scheduled_instance:${activity.n}`,
    { status: instance.status, scheduledFor: instance.scheduledFor, worksiteId: instance.worksiteId },
    { requestId: request.id, outcome: input.outcome, status: "pending_review", reason: request.reason },
    `${OUTCOME_LABEL[input.outcome]} solicitado para la ocurrencia del ${formatDate(instance.scheduledFor)} de la actividad ${activity.n}. Queda en revisión: el cumplimiento no cambia hasta que otra persona lo apruebe. Motivo: ${request.reason}`,
    tx,
  )
  return { instance, request }
}

async function loadRequestTarget(requestId: string) {
  const [target] = await db.select({
    instanceId: pdtpScheduledInstanceOutcomeRequests.instanceId,
    worksiteId: pdtpScheduledInstances.worksiteId,
  }).from(pdtpScheduledInstanceOutcomeRequests)
    .innerJoin(pdtpScheduledInstances, eq(pdtpScheduledInstances.id, pdtpScheduledInstanceOutcomeRequests.instanceId))
    .where(eq(pdtpScheduledInstanceOutcomeRequests.id, requestId)).limit(1)
  if (!target) throw new Error("Solicitud no encontrada.")
  return target
}

async function lockRequest(tx: Tx, requestId: string): Promise<PdtpScheduledOutcomeRequestRow> {
  const [request] = await tx.select().from(pdtpScheduledInstanceOutcomeRequests)
    .where(eq(pdtpScheduledInstanceOutcomeRequests.id, requestId)).limit(1).for("update")
  if (!request) throw new Error("Solicitud no encontrada.")
  return request
}

/**
 * Aprueba o rechaza una solicitud pendiente.
 *
 * - Quien la pidió no la revisa (también el CHECK
 *   `pdtp_sched_outcome_requests_reviewer_check`).
 * - Alcance de faena del revisor.
 * - Ventana de la versión (`assertPdtpProgramAcceptsReview`: año cerrado
 *   formalmente o semana de la sucesora) y mes abierto.
 * - Aprobar exige que la ocurrencia siga sin resultado terminal.
 */
export async function reviewPdtpScheduledInstanceOutcome(
  input: unknown,
  reviewerUserId: string,
  scope: WorksiteScope,
): Promise<PdtpScheduledOutcomeRequestRow> {
  const data = pdtpScheduledInstanceOutcomeReviewSchema.parse(input)
  const target = await loadRequestTarget(data.requestId)
  assertWorksiteAccess(target.worksiteId, scope)

  return db.transaction(async (tx) => {
    const instance = await lockInstance(tx, target.instanceId)
    const request = await lockRequest(tx, data.requestId)
    if (request.status !== "pending_review") throw new Error("Esta solicitud no está pendiente de revisión.")
    if (request.requestedByUserId === reviewerUserId) {
      throw new Error("No puedes revisar tu propia solicitud: debe hacerlo otra persona.")
    }
    const outcome = request.outcome as PdtpScheduledOutcome
    const period = periodOf(instance.scheduledFor)
    await assertPdtpProgramAcceptsReview(instance.programId, period, tx)
    await assertPdtpPeriodOpen(instance.programId, instance.worksiteId, period.year, period.month, tx)

    const now = new Date().toISOString()
    const reason = data.reason?.trim() || null
    if (data.decision === "approve") {
      if (TERMINAL_STATUSES.includes(instance.status)) {
        throw new Error("La ocurrencia ya tiene un resultado: no se puede aprobar la solicitud. Recházala.")
      }
      const metadata = {
        ...sourceMetadata(instance.sourceMetadataJson),
        ...(request.evidenceRef ? { evidenceRef: request.evidenceRef } : {}),
        outcomeReason: request.reason,
        outcomeRecordedAt: request.requestedAt,
        outcomeRecordedByUserId: request.requestedByUserId,
        outcomeReviewedAt: now,
        outcomeReviewedByUserId: reviewerUserId,
        outcomeRequestId: request.id,
      }
      const [updatedInstance] = await tx.update(pdtpScheduledInstances).set({
        status: outcome,
        notApplicableReason: outcome === "not_applicable" ? request.reason : instance.notApplicableReason,
        cancelledAt: outcome === "cancelled" ? now : instance.cancelledAt,
        cancelledByUserId: outcome === "cancelled" ? request.requestedByUserId : instance.cancelledByUserId,
        cancellationReason: outcome === "cancelled" ? request.reason : instance.cancellationReason,
        sourceMetadataJson: metadata,
        updatedAt: now,
      }).where(and(
        eq(pdtpScheduledInstances.id, instance.id),
        eq(pdtpScheduledInstances.status, instance.status),
      )).returning({ id: pdtpScheduledInstances.id })
      if (!updatedInstance) throw new Error("La ocurrencia cambió antes de aprobar la solicitud. Actualiza la página.")
    }

    const nextStatus = data.decision === "approve" ? "approved" : "rejected"
    const [updated] = await tx.update(pdtpScheduledInstanceOutcomeRequests).set({
      status: nextStatus,
      reviewedByUserId: reviewerUserId,
      reviewedAt: now,
      reviewReason: reason,
    }).where(and(
      eq(pdtpScheduledInstanceOutcomeRequests.id, request.id),
      eq(pdtpScheduledInstanceOutcomeRequests.status, "pending_review"),
    )).returning()
    if (!updated) throw new Error("La solicitud cambió antes de poder revisarse. Actualiza la página.")

    const activity = await activityAndVersion(tx, instance)
    const verb = data.decision === "approve" ? (outcome === "cancelled" ? "aprobada" : "aprobado") : (outcome === "cancelled" ? "rechazada" : "rechazado")
    await addPdtpChangeLogEntry(
      instance.programId, activity.version, reviewerUserId, `scheduled_instance:${activity.n}`,
      { requestId: request.id, outcome, status: "pending_review", instanceStatus: instance.status },
      { status: nextStatus, reviewedByUserId: reviewerUserId, reason, instanceStatus: data.decision === "approve" ? outcome : instance.status },
      `${OUTCOME_LABEL[outcome]} ${verb} para la ocurrencia del ${formatDate(instance.scheduledFor)} de la actividad ${activity.n}.${reason ? ` Motivo: ${reason}` : ""}`,
      tx,
    )
    return updated
  })
}

/**
 * Quien pidió la solicitud la retira mientras sigue en revisión. No cambia el
 * indicador (la ocurrencia nunca dejó de contar), así que no exige mes
 * abierto; el motivo es opcional por lo mismo.
 */
export async function withdrawPdtpScheduledInstanceOutcomeRequest(
  input: unknown,
  userId: string,
  scope: WorksiteScope,
): Promise<PdtpScheduledOutcomeRequestRow> {
  const data = pdtpScheduledInstanceOutcomeWithdrawSchema.parse(input)
  const target = await loadRequestTarget(data.requestId)
  assertWorksiteAccess(target.worksiteId, scope)

  return db.transaction(async (tx) => {
    const instance = await lockInstance(tx, target.instanceId)
    const request = await lockRequest(tx, data.requestId)
    if (request.status !== "pending_review") throw new Error("Esta solicitud no está pendiente de revisión.")
    if (request.requestedByUserId !== userId) throw new Error("Sólo quien la pidió puede retirar la solicitud.")
    const now = new Date().toISOString()
    const reason = data.reason?.trim() || null
    const [updated] = await tx.update(pdtpScheduledInstanceOutcomeRequests).set({
      status: "withdrawn",
      withdrawnByUserId: userId,
      withdrawnAt: now,
      withdrawReason: reason,
    }).where(and(
      eq(pdtpScheduledInstanceOutcomeRequests.id, request.id),
      eq(pdtpScheduledInstanceOutcomeRequests.status, "pending_review"),
    )).returning()
    if (!updated) throw new Error("La solicitud cambió antes de poder retirarse. Actualiza la página.")
    const activity = await activityAndVersion(tx, instance)
    const outcome = request.outcome as PdtpScheduledOutcome
    await addPdtpChangeLogEntry(
      instance.programId, activity.version, userId, `scheduled_instance:${activity.n}`,
      { requestId: request.id, outcome, status: "pending_review" },
      { status: "withdrawn", reason },
      `${OUTCOME_LABEL[outcome]} retirado por quien lo pidió para la ocurrencia del ${formatDate(instance.scheduledFor)} de la actividad ${activity.n}.${reason ? ` Motivo: ${reason}` : ""}`,
      tx,
    )
    return updated
  })
}

/**
 * Una ejecución aprobada cumplió la ocurrencia: la solicitud que esperaba
 * revisión ya no tiene objeto. La llama `syncPdtpScheduledInstanceFromExecution`
 * con la ocurrencia ya bloqueada (orden ejecución → ocurrencia → solicitud).
 */
export async function withdrawPendingPdtpScheduledOutcomeRequests(tx: Tx, instanceId: string, userId: string | null): Promise<number> {
  const rows = await tx.update(pdtpScheduledInstanceOutcomeRequests).set({
    status: "withdrawn",
    withdrawnByUserId: userId,
    withdrawnAt: new Date().toISOString(),
    withdrawReason: "La ocurrencia se cumplió con una ejecución aprobada.",
  }).where(and(
    eq(pdtpScheduledInstanceOutcomeRequests.instanceId, instanceId),
    eq(pdtpScheduledInstanceOutcomeRequests.status, "pending_review"),
  )).returning({ id: pdtpScheduledInstanceOutcomeRequests.id })
  return rows.length
}

export type PdtpPendingScheduledOutcome = {
  id: string
  instanceId: string
  outcome: PdtpScheduledOutcome
  programId: string
  activityId: string
  activityN: number
  activityName: string
  worksiteId: string
  worksiteName: string
  scheduledFor: string
  reason: string
  requestedByUserId: string
  requestedByName: string
  requestedAt: string
}

/**
 * Bandeja de solicitudes pendientes, acotada al alcance de faenas del revisor
 * y, opcionalmente, a un programa. Más antiguas primero.
 */
export async function listPendingPdtpScheduledInstanceOutcomes(
  worksiteIds: string[] | "all",
  options: { programId?: string } = {},
): Promise<PdtpPendingScheduledOutcome[]> {
  if (worksiteIds !== "all" && worksiteIds.length === 0) return []
  const rows = await db.select({
    id: pdtpScheduledInstanceOutcomeRequests.id,
    instanceId: pdtpScheduledInstanceOutcomeRequests.instanceId,
    outcome: pdtpScheduledInstanceOutcomeRequests.outcome,
    programId: pdtpScheduledInstances.programId,
    activityId: pdtpScheduledInstances.activityId,
    activityN: pdtpActivities.n,
    activityName: pdtpActivities.activity,
    worksiteId: pdtpScheduledInstances.worksiteId,
    worksiteName: worksites.name,
    scheduledFor: pdtpScheduledInstances.scheduledFor,
    reason: pdtpScheduledInstanceOutcomeRequests.reason,
    requestedByUserId: pdtpScheduledInstanceOutcomeRequests.requestedByUserId,
    requestedByName: users.name,
    requestedAt: pdtpScheduledInstanceOutcomeRequests.requestedAt,
  }).from(pdtpScheduledInstanceOutcomeRequests)
    .innerJoin(pdtpScheduledInstances, eq(pdtpScheduledInstances.id, pdtpScheduledInstanceOutcomeRequests.instanceId))
    .innerJoin(pdtpActivities, eq(pdtpActivities.id, pdtpScheduledInstances.activityId))
    .innerJoin(worksites, eq(worksites.id, pdtpScheduledInstances.worksiteId))
    .innerJoin(users, eq(users.id, pdtpScheduledInstanceOutcomeRequests.requestedByUserId))
    .where(and(
      eq(pdtpScheduledInstanceOutcomeRequests.status, "pending_review"),
      worksiteIds === "all" ? undefined : inArray(pdtpScheduledInstances.worksiteId, worksiteIds),
      options.programId ? eq(pdtpScheduledInstances.programId, options.programId) : undefined,
    ))
    .orderBy(pdtpScheduledInstanceOutcomeRequests.requestedAt, pdtpScheduledInstances.scheduledFor)
  return rows.map((row) => ({ ...row, outcome: row.outcome as PdtpScheduledOutcome, requestedByName: row.requestedByName ?? "" }))
}

/**
 * Cuántas solicitudes pendientes tienen las ocurrencias de un mes, para que el
 * cierre mensual lo impida (`period-closures.ts`).
 */
export async function countPendingPdtpScheduledOutcomesForMonth(
  client: Tx | typeof db,
  input: { programId: string; worksiteId: string; year: number; month: number },
): Promise<number> {
  const from = `${input.year}-${String(input.month).padStart(2, "0")}-01`
  const nextMonth = input.month === 12 ? `${input.year + 1}-01-01` : `${input.year}-${String(input.month + 1).padStart(2, "0")}-01`
  const [row] = await client.select({ pending: sql<number>`count(*)::int` })
    .from(pdtpScheduledInstanceOutcomeRequests)
    .innerJoin(pdtpScheduledInstances, eq(pdtpScheduledInstances.id, pdtpScheduledInstanceOutcomeRequests.instanceId))
    .where(and(
      eq(pdtpScheduledInstanceOutcomeRequests.status, "pending_review"),
      eq(pdtpScheduledInstances.programId, input.programId),
      eq(pdtpScheduledInstances.worksiteId, input.worksiteId),
      sql`${pdtpScheduledInstances.scheduledFor} >= ${from}`,
      sql`${pdtpScheduledInstances.scheduledFor} < ${nextMonth}`,
    ))
  return Number(row?.pending ?? 0)
}
