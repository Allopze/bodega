import { and, eq, isNull, ne } from "drizzle-orm"
import { db } from "@/db"
import { pdtpActivities, pdtpPrograms } from "@/db/schema"
import { addPdtpChangeLogEntry } from "./helpers"
import { computePdtpProgramContentDigest } from "./content-digest"
import {
  assertAllRequiredPdtpApprovalStepsApproved,
  decidePdtpApprovalStep,
  ensureDefaultPdtpApprovalSteps,
  listPdtpApprovalProgress,
} from "./approval-flow"

function lifecycleReason(value: string, label: string): string {
  const reason = value.trim()
  if (reason.length < 10) throw new Error(`${label} debe tener al menos 10 caracteres.`)
  if (reason.length > 3000) throw new Error(`${label} no puede superar 3000 caracteres.`)
  return reason
}

async function requireProgram(programId: string) {
  const [program] = await db.select().from(pdtpPrograms).where(eq(pdtpPrograms.id, programId)).limit(1)
  if (!program) throw new Error("Programa PDTP no encontrado.")
  return program
}

export async function getActivePdtpProgram(year: number) {
  const [program] = await db.select().from(pdtpPrograms).where(
    and(eq(pdtpPrograms.year, year), eq(pdtpPrograms.status, "active")),
  ).limit(1)
  return program ?? null
}

type PdtpActivityRow = typeof pdtpActivities.$inferSelect

/**
 * Requisitos de contenido para enviar un programa a revisión, en el mismo orden
 * en que se comunican al operador.
 *
 * Vive aparte de la transacción porque la tarjeta de estado necesita mostrar el
 * bloqueo ANTES de que el envío falle: la regla es una sola, consultada desde
 * los dos lados.
 */
export function pdtpSubmitReviewBlockers(activities: PdtpActivityRow[]): string[] {
  if (activities.length === 0) return ["Agrega al menos una actividad antes de enviar el programa a revisión."]

  const blockers: string[] = []
  const unresolvedScheduleClassifications = activities.filter((activity) => activity.scheduleClassificationStatus === "needs_review")
  if (unresolvedScheduleClassifications.length > 0) {
    blockers.push(
      `${unresolvedScheduleClassifications.length} actividad(es) aún requieren confirmar cuándo se realizan. ` +
      "Clasifícalas como periódicas, a demanda o por evento antes de enviar el programa a revisión.",
    )
  }
  const incompleteDemandActivities = activities.filter((activity) => {
    if (activity.scheduleMode !== "on_demand" && activity.scheduleMode !== "triggered") return false
    return activity.dueDays === null
      || !activity.evidenceRequirement?.trim()
      || (activity.scheduleMode === "triggered" && (!activity.triggerType?.trim() || !activity.triggerDescription?.trim()))
      || activity.indicatorMode === "planned_vs_completed"
  })
  if (incompleteDemandActivities.length > 0) {
    blockers.push(
      `${incompleteDemandActivities.length} actividad(es) a demanda o por evento no tienen SLA, evidencia, disparador o regla de indicador completos.`,
    )
  }
  return blockers
}

/** Los motivos por los que hoy no se puede enviar el programa a revisión. */
export async function getPdtpSubmitReviewBlockers(programId: string): Promise<string[]> {
  const activities = await db.select().from(pdtpActivities).where(eq(pdtpActivities.programId, programId))
  return pdtpSubmitReviewBlockers(activities)
}

export async function submitPdtpProgramForReview(programId: string, userId: string) {
  return db.transaction(async (tx) => {
    const [program] = await tx.select().from(pdtpPrograms).where(eq(pdtpPrograms.id, programId)).limit(1)
    if (!program) throw new Error("Programa PDTP no encontrado.")
    if (program.status === "in_review" && program.reviewStartedByUserId === userId && program.contentDigest) return program
    if (program.status !== "draft") throw new Error("Solo se pueden enviar a revisión programas en estado borrador.")
    if (program.approvedByJdprUserId || program.approvedByLegalUserId || program.contentDigest) {
      throw new Error("El borrador contiene firmas o una revisión previa y no puede reutilizarse.")
    }

    const activities = await tx.select().from(pdtpActivities)
      .where(eq(pdtpActivities.programId, programId))
    const [firstBlocker] = pdtpSubmitReviewBlockers(activities)
    // Se lanza sólo el primero: el mensaje viaja como texto único al operador y
    // concatenarlos lo dejaría fuera del límite de un error mostrable.
    if (firstBlocker) throw new Error(firstBlocker)

    const steps = await ensureDefaultPdtpApprovalSteps(programId, tx)
    if (steps.length === 0) throw new Error("El programa debe tener al menos un paso de aprobación.")
    const { digest, snapshot } = await computePdtpProgramContentDigest(programId, tx)
    const now = new Date().toISOString()
    const [updated] = await tx.update(pdtpPrograms)
      .set({
        status: "in_review",
        contentDigest: digest,
        reviewSnapshotJson: snapshot,
        reviewStartedByUserId: userId,
        reviewStartedAt: now,
        updatedAt: now,
      })
      .where(and(
        eq(pdtpPrograms.id, programId),
        eq(pdtpPrograms.status, "draft"),
        eq(pdtpPrograms.contentVersion, program.contentVersion),
        eq(pdtpPrograms.updatedAt, program.updatedAt),
        isNull(pdtpPrograms.approvedByJdprUserId),
        isNull(pdtpPrograms.contentDigest),
      ))
      .returning()
    if (!updated) throw new Error("El programa cambió mientras se enviaba a revisión. Recarga e intenta nuevamente.")

    await addPdtpChangeLogEntry(
      programId,
      program.version,
      userId,
      "lifecycle",
      { status: program.status, contentVersion: program.contentVersion, contentDigest: null },
      { status: "in_review", contentVersion: program.contentVersion, contentDigest: digest },
      "Programa enviado a revisión con contenido y flujo de aprobación congelados.",
      tx,
    )
    return updated
  })
}

export type PdtpApprovalDecisionValue = "approved" | "rejected"

async function resolveStep(programId: string, stepCode: string) {
  const progress = await listPdtpApprovalProgress(programId)
  const step = progress.steps.find((item) => item.code === stepCode)
  if (!step) throw new Error(`Paso de aprobación no configurado: ${stepCode}.`)
  return step
}

export async function approvePdtpProgramJdpr(programId: string, userId: string) {
  const step = await resolveStep(programId, "jdpr")
  await decidePdtpApprovalStep({
    programId,
    stepId: step.id,
    actorUserId: userId,
    decision: "approved",
  })
  return requireProgram(programId)
}

export async function signPdtpProgramLegal(programId: string, userId: string) {
  const step = await resolveStep(programId, "legal")
  await decidePdtpApprovalStep({
    programId,
    stepId: step.id,
    actorUserId: userId,
    decision: "approved",
  })
  return requireProgram(programId)
}

export async function rejectPdtpApprovalStep(programId: string, stepCode: string, userId: string, reason: string) {
  const step = await resolveStep(programId, stepCode)
  await decidePdtpApprovalStep({
    programId,
    stepId: step.id,
    actorUserId: userId,
    decision: "rejected",
    reason,
  })
  return requireProgram(programId)
}

export async function rejectPdtpProgram(programId: string, userId: string, reason: string) {
  const progress = await listPdtpApprovalProgress(programId)
  const step = progress.steps.find((item) => item.isRequired && item.decision?.decision !== "approved")
    ?? progress.steps.at(-1)
  if (!step) throw new Error("El programa no tiene pasos de aprobación configurados.")
  return rejectPdtpApprovalStep(programId, step.code, userId, reason)
}

export async function activatePdtpProgram(programId: string, userId: string) {
  return db.transaction(async (tx) => {
    const [program] = await tx.select().from(pdtpPrograms).where(eq(pdtpPrograms.id, programId)).limit(1)
    if (!program) throw new Error("Programa PDTP no encontrado.")
    if (program.status === "active" && program.activatedByUserId === userId && program.contentDigest) {
      const { digest } = await computePdtpProgramContentDigest(programId, tx)
      if (digest !== program.contentDigest) throw new Error("El contenido activo no coincide con la versión firmada.")
      return program
    }
    if (program.status !== "in_review") throw new Error("Solo se pueden activar programas que estén en revisión.")
    if (!program.contentDigest) throw new Error("La revisión no tiene una huella de contenido válida.")

    await assertAllRequiredPdtpApprovalStepsApproved(programId, program.contentVersion, program.contentDigest, tx)
    const { digest } = await computePdtpProgramContentDigest(programId, tx)
    if (digest !== program.contentDigest) {
      throw new Error("El contenido actual no coincide con la versión firmada. Debe abrirse una nueva revisión.")
    }

    const now = new Date().toISOString()
    await tx.update(pdtpPrograms).set({ status: "closed", updatedAt: now })
      .where(and(eq(pdtpPrograms.year, program.year), eq(pdtpPrograms.status, "active"), ne(pdtpPrograms.id, programId)))

    const [updated] = await tx.update(pdtpPrograms)
      .set({ status: "active", activatedByUserId: userId, activatedAt: now, updatedAt: now })
      .where(and(
        eq(pdtpPrograms.id, programId),
        eq(pdtpPrograms.status, "in_review"),
        eq(pdtpPrograms.contentVersion, program.contentVersion),
        eq(pdtpPrograms.contentDigest, program.contentDigest),
        eq(pdtpPrograms.updatedAt, program.updatedAt),
      ))
      .returning()
    if (!updated) throw new Error("El programa cambió mientras se activaba. Recarga e intenta nuevamente.")

    await addPdtpChangeLogEntry(
      programId,
      program.version,
      userId,
      "lifecycle",
      { status: program.status, contentVersion: program.contentVersion },
      { status: "active", contentVersion: program.contentVersion, contentDigest: program.contentDigest },
      "Programa activado sobre todos los pasos requeridos de la versión firmada.",
      tx,
    )
    return updated
  })
}

export async function reopenRejectedPdtpProgram(programId: string, userId: string, rawReason: string) {
  const reason = lifecycleReason(rawReason, "El motivo de reapertura")
  return db.transaction(async (tx) => {
    const [program] = await tx.select().from(pdtpPrograms).where(eq(pdtpPrograms.id, programId)).limit(1)
    if (!program) throw new Error("Programa PDTP no encontrado.")
    if (program.status === "draft" && program.lastReopenedByUserId === userId && program.lastReopenReason === reason) return program
    if (program.status !== "rejected") throw new Error("Solo se pueden reabrir programas rechazados.")

    const now = new Date().toISOString()
    const nextContentVersion = program.contentVersion + 1
    const [updated] = await tx.update(pdtpPrograms)
      .set({
        status: "draft",
        contentVersion: nextContentVersion,
        contentDigest: null,
        reviewSnapshotJson: null,
        reviewStartedByUserId: null,
        reviewStartedAt: null,
        approvedByJdprUserId: null,
        approvedByJdprAt: null,
        approvedByLegalUserId: null,
        approvedByLegalAt: null,
        activatedByUserId: null,
        activatedAt: null,
        rejectedByUserId: null,
        rejectedAt: null,
        rejectionReason: null,
        lastReopenedByUserId: userId,
        lastReopenedAt: now,
        lastReopenReason: reason,
        updatedAt: now,
      })
      .where(and(
        eq(pdtpPrograms.id, programId),
        eq(pdtpPrograms.status, "rejected"),
        eq(pdtpPrograms.contentVersion, program.contentVersion),
        eq(pdtpPrograms.updatedAt, program.updatedAt),
      ))
      .returning()
    if (!updated) throw new Error("El programa cambió mientras se reabría. Recarga e intenta nuevamente.")

    await addPdtpChangeLogEntry(
      programId,
      program.version,
      userId,
      "lifecycle",
      { status: program.status, contentVersion: program.contentVersion, contentDigest: program.contentDigest },
      { status: "draft", contentVersion: nextContentVersion, contentDigest: null, reason },
      `Programa reabierto como nueva versión de contenido: ${reason}`,
      tx,
    )
    return updated
  })
}

export async function archivePdtpProgram(programId: string, userId: string, rawReason: string) {
  const reason = lifecycleReason(rawReason, "El motivo de archivo")
  return db.transaction(async (tx) => {
    const [program] = await tx.select().from(pdtpPrograms).where(eq(pdtpPrograms.id, programId)).limit(1)
    if (!program) throw new Error("Programa PDTP no encontrado.")
    if (program.status === "archived" && program.archivedByUserId === userId && program.archiveReason === reason) return program
    if (!["in_review", "rejected", "closed"].includes(program.status)) {
      throw new Error("Solo se pueden archivar programas revisados, rechazados o cerrados.")
    }

    const now = new Date().toISOString()
    const [updated] = await tx.update(pdtpPrograms)
      .set({ status: "archived", archivedByUserId: userId, archivedAt: now, archiveReason: reason, updatedAt: now })
      .where(and(
        eq(pdtpPrograms.id, programId),
        eq(pdtpPrograms.status, program.status),
        eq(pdtpPrograms.contentVersion, program.contentVersion),
        eq(pdtpPrograms.updatedAt, program.updatedAt),
      ))
      .returning()
    if (!updated) throw new Error("El programa cambió mientras se archivaba. Recarga e intenta nuevamente.")

    await addPdtpChangeLogEntry(
      programId,
      program.version,
      userId,
      "lifecycle",
      { status: program.status, contentVersion: program.contentVersion, contentDigest: program.contentDigest },
      { status: "archived", contentVersion: program.contentVersion, contentDigest: program.contentDigest, reason },
      `Programa archivado: ${reason}`,
      tx,
    )
    return updated
  })
}
