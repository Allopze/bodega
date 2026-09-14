import { and, eq, isNull, ne } from "drizzle-orm"
import { db } from "@/db"
import { pdtpActivities, pdtpPrograms } from "@/db/schema"
import { addPdtpChangeLogEntry } from "./helpers"
import { computePdtpProgramContentDigest } from "./content-digest"
import { assertPdtpFulfillmentCoverage, type PdtpFulfillmentCoverageIssue } from "./fulfillment"
import {
  assertAllRequiredPdtpApprovalStepsApproved,
  decidePdtpApprovalStep,
  ensureDefaultPdtpApprovalSteps,
  listPdtpApprovalProgress,
} from "./approval-flow"

/**
 * Qué clasificaciones de la compuerta 81/81 frenan el ciclo de vida, con el
 * texto con que se le nombran al operador. Ser clave de este mapa ES ser
 * bloqueante: así la etiqueta y la regla no pueden separarse.
 *
 * Sólo están las dos que se arreglan DENTRO del programa: una actividad sin
 * mecanismo de acreditación clasificado (o cuyo destino todavía cae a la
 * planilla genérica) no tiene dónde cumplirse, y una cuyo responsable no mapea
 * a un rol real —o mapea a uno sin permiso en el módulo donde el trabajo se
 * registra— no tiene quién la cumpla. Ninguna se resuelve fuera del PDTP, así
 * que dejarlas pasar sería prometer trabajo imposible.
 *
 * El resto se informa y no frena nada. `config_required` e `instrument_required`
 * apuntan a instrumentos EXTERNOS —un curso, una plantilla, una campaña, un
 * plan de emergencia, un mapa de riesgos— que se crean y se aprueban después
 * de firmar, sin invalidar el contenido firmado. Exigirlos para activar dejaba
 * el programa inutilizable hasta tener el catálogo completo, cuando lo que
 * corresponde es lo contrario: se activa y se usa, y esas actividades
 * simplemente no acreditan cumplimiento mientras su instrumento no exista o no
 * esté vigente. `decision_required` y `destination_review` nunca frenaron nada.
 */
const BLOCKING_COVERAGE_LABELS = {
  code_gap: "sin mecanismo de acreditación clasificado",
  // Cubre los dos casos que la compuerta clasifica igual: el responsable no
  // mapea a ningún rol, o mapea a uno que no tiene permiso en el módulo
  // donde el trabajo se registra. Decir sólo "no mapea a un rol real" mentía
  // en el segundo caso, que es el más común.
  permission_gap: "sin un responsable que pueda registrar el cumplimiento",
} satisfies Partial<Record<PdtpFulfillmentCoverageIssue["status"], string>>

type BlockingCoverageStatus = keyof typeof BLOCKING_COVERAGE_LABELS

/**
 * Si esta clasificación frena el envío a revisión y la activación. Se exporta
 * porque el preflight de cableado (`scripts/preflight-pdtp-accreditation-wiring.ts`)
 * tenía la misma regla escrita a mano y las dos copias se separaron en cuanto
 * ésta cambió.
 */
export function pdtpCoverageIssueBlocksLifecycle(
  status: PdtpFulfillmentCoverageIssue["status"],
): status is BlockingCoverageStatus {
  return Object.hasOwn(BLOCKING_COVERAGE_LABELS, status)
}

function groupCoverageIssuesByStatus(issues: PdtpFulfillmentCoverageIssue[]): [PdtpFulfillmentCoverageIssue["status"], number[]][] {
  const byStatus = new Map<PdtpFulfillmentCoverageIssue["status"], number[]>()
  for (const issue of issues) {
    const list = byStatus.get(issue.status) ?? []
    list.push(issue.n)
    byStatus.set(issue.status, list)
  }
  return [...byStatus.entries()]
}

/** Agrupa los problemas bloqueantes de la compuerta 81/81 en mensajes
 *  legibles, uno por clasificación, en el mismo estilo que los otros
 *  bloqueadores de envío. La misma lista frena el envío a revisión y la
 *  activación: antes eran dos funciones que sólo se diferenciaban en si
 *  `instrument_required` contaba, y ya no cuenta en ninguna de las dos. */
function fulfillmentCoverageBlockers(issues: PdtpFulfillmentCoverageIssue[]): string[] {
  if (issues.length === 0) return []
  const messages: string[] = []
  for (const [status, numbers] of groupCoverageIssuesByStatus(issues)) {
    if (!pdtpCoverageIssueBlocksLifecycle(status)) continue
    messages.push(`${numbers.length} actividad(es) ${BLOCKING_COVERAGE_LABELS[status]}: N°${numbers.join(", N°")}.`)
  }
  return messages
}

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
  // Una actividad retirada no participa del contenido que se revisa ni se
  // ejecuta: exigirle SLA o clasificación bloquearía el envío para siempre,
  // porque nadie vuelve a tocar una actividad ya retirada (hallazgo real: las
  // N°12, 14 y 21 quedaron retiradas con `needs_review` sin resolver y
  // bloqueaban el envío del programa 2026-09-02).
  const active = activities.filter((activity) => activity.status === "active")
  if (active.length === 0) return ["Agrega al menos una actividad antes de enviar el programa a revisión."]

  const blockers: string[] = []
  const unresolvedScheduleClassifications = active.filter((activity) => activity.scheduleClassificationStatus === "needs_review")
  if (unresolvedScheduleClassifications.length > 0) {
    blockers.push(
      `${unresolvedScheduleClassifications.length} actividad(es) aún requieren confirmar cuándo se realizan. ` +
      "Clasifícalas como periódicas, a demanda o por evento antes de enviar el programa a revisión.",
    )
  }
  const incompleteDemandActivities = active.filter((activity) => {
    if (activity.scheduleMode !== "on_demand" && activity.scheduleMode !== "triggered") return false
    return (activity.dueDays === null && activity.dueHours === null)
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
  const coverageIssues = await assertPdtpFulfillmentCoverage(programId)
  return [...pdtpSubmitReviewBlockers(activities), ...fulfillmentCoverageBlockers(coverageIssues)]
}

export type PdtpCoverageReport = {
  /** Actividades activas del programa: el denominador de la compuerta. */
  total: number
  /** Las que no tienen ningún problema declarado. */
  ready: number
  /** Problemas agrupados por clasificación, cada uno con sus actividades. */
  groups: Array<{
    status: PdtpFulfillmentCoverageIssue["status"]
    label: string
    /**
     * `true` sólo para lo que se arregla dentro del programa —`code_gap` y
     * `permission_gap`— y frena por igual el envío a revisión y la activación.
     * Ver `pdtpCoverageIssueBlocksLifecycle`. Lo demás se muestra para que el operador
     * sepa qué actividades no van a acreditar cumplimiento todavía.
     */
    blocks: boolean
    issues: PdtpFulfillmentCoverageIssue[]
  }>
}

const COVERAGE_STATUS_LABELS: Record<PdtpFulfillmentCoverageIssue["status"], string> = {
  ready: "Listas",
  code_gap: "Sin mecanismo de acreditación clasificado",
  config_required: "Sin la configuración que su enganche o constancia necesita",
  permission_gap: "Sin un responsable que pueda registrar el cumplimiento",
  decision_required: "Midiéndose por cobertura sin padrón declarado",
  destination_review: "Con un destino de enganche por revisar",
  instrument_required: "Con instrumento declarado pero no vigente (plantilla, curso o plan sin aprobar/publicar)",
}

/**
 * El informe por actividad de la compuerta, para mostrarlo antes de decidir la
 * activación. `getPdtpSubmitReviewBlockers` colapsa lo mismo a una línea por
 * clasificación —es lo que cabe en un mensaje de error—, así que sin esto la
 * clasificación existía en el tipo y nadie podía verla desagregada: había que
 * ir a leer la base actividad por actividad, que es exactamente el trabajo que
 * la compuerta vino a evitar.
 */
export async function getPdtpCoverageReport(programId: string): Promise<PdtpCoverageReport> {
  const [activities, issues] = await Promise.all([
    db.select({ id: pdtpActivities.id }).from(pdtpActivities)
      .where(and(eq(pdtpActivities.programId, programId), eq(pdtpActivities.status, "active"))),
    assertPdtpFulfillmentCoverage(programId),
  ])
  const byStatus = new Map<PdtpFulfillmentCoverageIssue["status"], PdtpFulfillmentCoverageIssue[]>()
  for (const issue of issues) {
    const list = byStatus.get(issue.status) ?? []
    list.push(issue)
    byStatus.set(issue.status, list)
  }
  const withIssues = new Set(issues.map((issue) => issue.n))
  return {
    total: activities.length,
    ready: activities.length - withIssues.size,
    groups: [...byStatus.entries()]
      .map(([status, list]) => ({
        status,
        label: COVERAGE_STATUS_LABELS[status],
        blocks: pdtpCoverageIssueBlocksLifecycle(status),
        issues: [...list].sort((a, b) => a.n - b.n),
      }))
      // Lo que frena el ciclo de vida primero.
      .sort((a, b) => Number(b.blocks) - Number(a.blocks) || a.label.localeCompare(b.label, "es-CL")),
  }
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
    // concatenarlos lo dejaría fuera del límite de un error mostrable. El
    // mismo orden que `getPdtpSubmitReviewBlockers`: calendario/SLA antes que
    // la compuerta 81/81, porque un programa con clasificación pendiente tiene
    // un problema más básico que su cobertura de destinos.
    if (firstBlocker) throw new Error(firstBlocker)
    const [firstCoverageBlocker] = fulfillmentCoverageBlockers(await assertPdtpFulfillmentCoverage(programId, tx))
    if (firstCoverageBlocker) throw new Error(firstCoverageBlocker)

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

    // Compuerta 81/81: se comprueba después de los guards de estado (activar
    // un borrador es un error de flujo, no un problema de cobertura), pero
    // antes de tocar nada — no debe volver a ser posible activar un programa
    // que promete trabajo sin ofrecer dónde realizarlo. Es la misma lista que
    // frena el envío: lo que falta afuera (cursos, plantillas, planes, mapas)
    // se informa pero no impide activar, porque el programa tiene que poder
    // usarse mientras ese catálogo se completa.
    const [firstCoverageBlocker] = fulfillmentCoverageBlockers(await assertPdtpFulfillmentCoverage(programId, tx))
    if (firstCoverageBlocker) throw new Error(firstCoverageBlocker)

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
