import { and, desc, eq, isNull, ne } from "drizzle-orm"
import { db } from "@/db"
import { pdtpActivities, pdtpProgramWorksites, pdtpPrograms } from "@/db/schema"
import { logger } from "@/lib/logger"
import { countOf } from "@/lib/utils"
import { addPdtpChangeLogEntry } from "./helpers"
import { computePdtpProgramContentDigest, computePdtpProgramContentDigestForStoredVersion } from "./content-digest"
import { assertPdtpFulfillmentCoverage, type PdtpCoverageScope, type PdtpFulfillmentCoverageIssue } from "./fulfillment"
import {
  assertAllRequiredPdtpApprovalStepsApproved,
  decidePdtpApprovalStep,
  ensureDefaultPdtpApprovalSteps,
  listPdtpApprovalProgress,
} from "./approval-flow"
import { materializePdtpScheduledInstances } from "./scheduled-instances"
import { reconcilePdtpTriggerEvents } from "./trigger-events"

/**
 * Qué clasificaciones de la compuerta 81/81 frenan el ciclo de vida, con el
 * texto con que se le nombran al operador. Ser clave de este mapa ES ser
 * bloqueante: así la etiqueta y la regla no pueden separarse.
 *
 * Sólo están las dos que se arreglan DENTRO del programa: una actividad sin
 * mecanismo de acreditación clasificado (o cuyo destino todavía cae a la
 * planilla genérica) no tiene dónde cumplirse, y una cuyo responsable no mapea
 * a un rol real o cuyo destino no tiene un ejecutor acreditador válido no tiene
 * quién la cumpla. Ninguna se resuelve fuera del PDTP, así que dejarlas pasar
 * sería prometer trabajo imposible.
 *
 * El resto se informa y no frena nada. `config_required` e `instrument_required`
 * apuntan a instrumentos EXTERNOS —un curso, una plantilla, una campaña, un
 * plan de emergencia, un mapa de riesgos— que se crean y se aprueban después
 * de firmar, sin invalidar el contenido firmado. Exigirlos para activar dejaba
 * el programa inutilizable hasta tener el catálogo completo, cuando lo que
 * corresponde es lo contrario: se activa y se usa, y esas actividades
 * simplemente no acreditan cumplimiento mientras su instrumento no exista o no
 * esté vigente. `decision_required` nunca frena nada.
 */
const BLOCKING_COVERAGE_LABELS = {
  code_gap: "sin mecanismo de acreditación clasificado",
  destination_not_configured: "sin destino operativo configurado",
  // Cubre los dos casos que la compuerta clasifica igual: el responsable no
  // mapea a ningún rol, o mapea a uno que no tiene permiso en el módulo
  // donde el trabajo se registra. Decir sólo "no mapea a un rol real" mentía
  // en el segundo caso, que es el más común.
  permission_gap: "sin un responsable que pueda registrar el cumplimiento",
  executor_required: "sin rol ejecutor para acreditar el hecho",
  executor_permission_gap: "con ejecutores sin permiso para acreditar el hecho",
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
    messages.push(`${countOf(numbers.length, "actividad", "actividades")} ${BLOCKING_COVERAGE_LABELS[status]}: N°${numbers.join(", N°")}.`)
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
  ).orderBy(desc(pdtpPrograms.version)).limit(1)
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
    const n = unresolvedScheduleClassifications.length
    blockers.push(
      `${countOf(n, "actividad", "actividades")} aún ${n === 1 ? "requiere" : "requieren"} confirmar cuándo ${n === 1 ? "se realiza" : "se realizan"}. ` +
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
    const n = incompleteDemandActivities.length
    blockers.push(
      `${countOf(n, "actividad", "actividades")} a demanda o por evento ${n === 1 ? "no tiene" : "no tienen"} SLA, evidencia, disparador o regla de indicador completos.`,
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
    /**
     * `true` sólo para lo que se arregla dentro del programa —`code_gap`,
     * `destination_not_configured`, `permission_gap` y la configuración de ejecutores— y frena por igual el
     * envío a revisión y la activación.
     * Ver `pdtpCoverageIssueBlocksLifecycle`. Lo demás se muestra para que el operador
     * distinga pendientes de configuración de flujos segregados ya válidos.
     */
    blocks: boolean
    issues: PdtpFulfillmentCoverageIssue[]
  }>
}

/**
 * Orden de presentación de las clasificaciones, de más a menos urgente.
 *
 * Acá había un `COVERAGE_STATUS_LABELS` con el nombre visible de cada grupo, y
 * el informe los ordenaba alfabéticamente por ese texto — o sea, el orden en
 * pantalla dependía de con qué letra empezaba la frase. Los nombres se mudaron
 * a la UI (`habilitacion/readiness-copy.ts`): un servicio que corre dentro de
 * las compuertas de ciclo de vida no debería tener que editarse para ajustar
 * una redacción. Lo que sí es de dominio, y se queda, es **qué tan grave es
 * cada cosa**.
 */
const COVERAGE_STATUS_SEVERITY: PdtpFulfillmentCoverageIssue["status"][] = [
  // Frenan el ciclo de vida. Dentro del bloque, primero lo que no tiene
  // arreglo posible sin tocar el catálogo de actividades.
  "code_gap",
  "destination_not_configured",
  "permission_gap",
  "executor_required",
  "executor_permission_gap",
  // No frenan, pero la actividad no acredita mientras sigan así.
  "config_required",
  "instrument_required",
  "decision_required",
  // Confirmaciones positivas, al final.
  "segregated_valid",
  "ready",
]

function coverageSeverityRank(status: PdtpFulfillmentCoverageIssue["status"]): number {
  const rank = COVERAGE_STATUS_SEVERITY.indexOf(status)
  return rank === -1 ? COVERAGE_STATUS_SEVERITY.length : rank
}

/**
 * El informe por actividad de la compuerta, para mostrarlo antes de decidir la
 * activación. `getPdtpSubmitReviewBlockers` colapsa lo mismo a una línea por
 * clasificación —es lo que cabe en un mensaje de error—, así que sin esto la
 * clasificación existía en el tipo y había que leer la base actividad por
 * actividad. El ciclo de vida consulta la cobertura completa; las vistas
 * autenticadas pueden pasar el alcance visible para no revelar nombres de
 * faenas fuera de los permisos del usuario.
 */
export async function getPdtpCoverageReport(
  programId: string,
  options?: PdtpCoverageScope,
): Promise<PdtpCoverageReport> {
  const [activities, issues] = await Promise.all([
    db.select({ id: pdtpActivities.id }).from(pdtpActivities)
      .where(and(eq(pdtpActivities.programId, programId), eq(pdtpActivities.status, "active"))),
    assertPdtpFulfillmentCoverage(programId, db, options),
  ])
  const byStatus = new Map<PdtpFulfillmentCoverageIssue["status"], PdtpFulfillmentCoverageIssue[]>()
  for (const issue of issues) {
    const list = byStatus.get(issue.status) ?? []
    list.push(issue)
    byStatus.set(issue.status, list)
  }
  // `segregated_valid` es una confirmación positiva del contrato, no una
  // brecha. Se muestra en el desglose, pero no reduce el contador de listas.
  const withIssues = new Set(issues
    .filter((issue) => issue.status !== "segregated_valid")
    .map((issue) => issue.n))
  return {
    total: activities.length,
    ready: activities.length - withIssues.size,
    groups: [...byStatus.entries()]
      .map(([status, list]) => ({
        status,
        blocks: pdtpCoverageIssueBlocksLifecycle(status),
        issues: [...list].sort((a, b) => a.n - b.n),
      }))
      // Lo que frena el ciclo de vida primero, y dentro de cada bloque por
      // gravedad declarada — no por la inicial de su nombre.
      .sort((a, b) => Number(b.blocks) - Number(a.blocks) || coverageSeverityRank(a.status) - coverageSeverityRank(b.status)),
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
  const activated = await db.transaction(async (tx) => {
    const [program] = await tx.select().from(pdtpPrograms).where(eq(pdtpPrograms.id, programId)).limit(1)
    if (!program) throw new Error("Programa PDTP no encontrado.")
    if (program.status === "active" && program.activatedByUserId === userId && program.contentDigest) {
      const { digest } = await computePdtpProgramContentDigestForStoredVersion(programId, tx)
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

    /**
     * PDTP-003 (auditoría 2026-09-14): un programa activo sin ninguna faena
     * declarada se aplicaba a TODAS —el motor de acreditación trata
     * `members.length === 0` como "cualquier faena"—, así que un programa
     * creado y activado antes de asignarle faenas absorbía las acreditaciones
     * de toda la organización y sus indicadores mezclaban faenas que nunca se
     * le asignaron. Podía ser deliberado, pero era indistinguible de un
     * programa a medio configurar.
     *
     * Aquí es donde la diferencia importa: activar es el acto que pone el
     * programa a recibir hechos. O lista faenas, o declara que las cubre
     * todas; lo que no puede es no decirlo.
     */
    const activeMembers = await tx.select({ worksiteId: pdtpProgramWorksites.worksiteId })
      .from(pdtpProgramWorksites)
      .where(and(eq(pdtpProgramWorksites.programId, programId), eq(pdtpProgramWorksites.isActive, true)))
    if (activeMembers.length === 0 && !program.appliesToAllWorksites) {
      throw new Error(
        "El programa no declara faenas y tampoco declara que aplica a todas: "
        + "asigna sus faenas o declara el alcance corporativo antes de activarlo.",
      )
    }

    await assertAllRequiredPdtpApprovalStepsApproved(programId, program.contentVersion, program.contentDigest, tx)
    const { digest } = await computePdtpProgramContentDigestForStoredVersion(programId, tx)
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

  // La firma/activación y la materialización viven en pasos separados: la
  // primera transacción no debe mantener una conexión abierta mientras se
  // expanden recurrencias por faena. Ambas operaciones son idempotentes; si el
  // proceso cae después de activar, el reconciliador puede retomarlas sin
  // duplicar ocurrencias. No se revierte una activación válida por un fallo de
  // infraestructura posterior, pero sí queda una señal operativa explícita.
  try {
    await materializePdtpScheduledInstances({ programId })
    await reconcilePdtpTriggerEvents({ limit: 200 })
  } catch (error) {
    logger.error({ error, programId }, "[pdtp-lifecycle] No se pudieron materializar o reconciliar las instancias nuevas tras activar.")
  }
  return activated
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
