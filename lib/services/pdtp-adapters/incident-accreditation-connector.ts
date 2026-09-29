/**
 * lib/services/pdtp-adapters/incident-accreditation-connector.ts
 *
 * Conector RE-20 entre las etapas de investigación de incidentes/accidentes
 * y el programa PDTP.
 *
 * Doce de las trece actividades del RE-20 (N°66-78, salvo la N°76) se miden
 * por `closed_on_time` (Fase 3, 2026-09-02): el caso abre una **obligación**
 * con el plazo que declara `pdtp_activities.due_days`/`due_hours` —sembrado
 * por `apply-pdtp-2026-demand-slas.ts`— al reportarse el incidente, y cada
 * hito posterior la **reporta**. Antes acreditaban directo con
 * `accreditPdtpFromEvent`, lo que las hacía invisibles al indicador de plazo:
 * `pdtp_executions` no distingue una investigación cerrada a tiempo de una
 * cerrada tarde, sólo que se cerró.
 *
 * La N°66 y la N°67 ("informar inmediatamente…") se crean y se reportan en el
 * mismo instante: el propio reporte del incidente es el hecho que cumplen, no
 * hay un hito posterior que las cierre.
 *
 * La N°76 ("seguimiento quincenal") queda fuera de este cableado y sigue
 * acreditando directo: puede repetirse un número no acotado de veces por
 * incidente (un seguimiento por quincena), y el modelo de obligación es un
 * caso con un solo plazo y un solo reporte — no una serie. Convertirla
 * exigiría un caso por seguimiento, con su propio disparador de creación por
 * anticipado, que este conector no tiene (sólo se entera del seguimiento
 * cuando ya ocurrió). Queda documentado como límite conocido en
 * `tasks/TODO_PDTP_ACREDITACION_2026-09-01.md`.
 *
 * Todos los métodos son tolerantes a fallos (no revierten la transacción del
 * caso): un error acá queda en el log, nunca tumba el registro del incidente.
 */

import { and, asc, eq, gte, isNotNull } from "drizzle-orm"
import { db } from "@/db"
import {
  pdtpActivities,
  pdtpExecutions,
  pdtpObligations,
  pdtpPrograms,
  preventionIncidentDiffusion,
  preventionIncidentHistory,
  preventionIncidentInvestigations,
  preventionIncidentNotifications,
  preventionIncidents,
  preventionIncidentShiftDiffusions,
  preventionIncidentStatements,
  worksites,
} from "@/db/schema"
import { logger } from "@/lib/logger"
import { chileDateParts } from "@/lib/utils"
import { assertPdtpPeriodOpen } from "@/lib/services/pdtp/period-guard"
import { resolvePdtpActivityIdsOrSkip, resolvePdtpProgramActorUserId } from "./obligation-kit"
import {
  incidentRequiresInvestigation,
  requiredIncidentNotificationTypes,
  type IncidentEventType,
} from "@/lib/services/prevention-incidents"
import { resolvePdtpActivityIdsForNumbers } from "@/lib/services/pdtp/accreditation"
import { recordPdtpFulfillmentEvent } from "@/lib/services/pdtp/fulfillment"
import {
  cancelPdtpObligation,
  createPdtpObligation,
  findPdtpObligationByIdempotencyKey,
  pdtpObligationIdempotencyKey,
  reportPdtpObligation,
} from "@/lib/services/pdtp/obligations"
import { recordPdtpTriggerEvent, recordPdtpTriggerEventSafe } from "@/lib/services/pdtp/trigger-events"
import { pdtpCatalogActivityIdForLegacyNumber } from "./catalog-activities-2026"

/** Las doce actividades del RE-20 que pasan por obligación. La N°76 no está. */
const RE20_OBLIGATION_ACTIVITY_NUMBERS = [66, 67, 68, 69, 70, 71, 72, 73, 74, 75, 77, 78]

/**
 * De las doce, la N°66 y la N°67 se crean siempre (la auditoría confirma que
 * "cualquier incidente" las exige). Las diez restantes sólo aplican cuando el
 * incidente efectivamente exige investigación — de lo contrario un daño
 * material menor abría una DIAT (N°72) o un informe definitivo (N°73/74) que
 * ese tipo de evento nunca debió exigir, y esas obligaciones vencían para
 * siempre contando como incumplimiento del RE-20.
 */
const RE20_FILTERABLE_ACTIVITY_NUMBERS = RE20_OBLIGATION_ACTIVITY_NUMBERS.filter((n) => n !== 66 && n !== 67)

type Re20Classification = {
  eventType: IncidentEventType
  actualSeverity: string
  potentialSeverity: string
  isFatalOrSerious: boolean
}

/**
 * Recalcula, con la clasificación vigente del incidente, cuáles de las diez
 * obligaciones filtrables del RE-20 aplican. Reutilizado tanto al reportar el
 * incidente (`onIncidentReported`) como al reconciliar tras el triage
 * (`reconcileIncidentObligationsAfterTriage`): misma regla, una sola fuente.
 */
function applicableRe20FilterableNumbers(classification: Re20Classification): number[] {
  if (!incidentRequiresInvestigation(classification)) return []
  const requiresDiat = requiredIncidentNotificationTypes({
    eventType: classification.eventType,
    isFatalOrSerious: classification.isFatalOrSerious,
  }).includes("diat")
  return requiresDiat
    ? RE20_FILTERABLE_ACTIVITY_NUMBERS
    : RE20_FILTERABLE_ACTIVITY_NUMBERS.filter((n) => n !== 72)
}

function incidentObligationIdempotencyKey(activityId: string, worksiteId: string, incidentId: string): string {
  return pdtpObligationIdempotencyKey({ activityId, worksiteId, sourceType: "incident", sourceId: incidentId })
}

/**
 * Crea la obligación de una actividad del RE-20 para este incidente, y —si
 * `immediateEvidence` viene— la reporta de inmediato en el mismo llamado: es
 * el caso de la N°66/67, cuyo cumplimiento es el propio reporte del
 * incidente, sin un hito posterior que lo cierre.
 */
async function ensureIncidentObligation(input: {
  activityId: string
  worksiteId: string
  incidentId: string
  occurredAt: string
  userId: string
  immediateEvidence?: string
}): Promise<void> {
  try {
    const { obligation } = await createPdtpObligation({
      activityId: input.activityId,
      worksiteId: input.worksiteId,
      origin: "integration",
      sourceType: "incident",
      sourceId: input.incidentId,
      sourceOccurredAt: input.occurredAt,
      userId: input.userId,
      scope: "all",
    })
    if (input.immediateEvidence) {
      await reportPdtpObligation({
        obligationId: obligation.id,
        executedQuantity: 1,
        evidenceText: input.immediateEvidence,
        reportedAt: input.occurredAt,
        userId: input.userId,
        scope: "all",
      })
    }
  } catch (err) {
    logger.error(
      { err, activityId: input.activityId, incidentId: input.incidentId, worksiteId: input.worksiteId },
      "[incident-pdtp-connector] No se pudo crear/reportar la obligación del RE-20.",
    )
  }
}

/**
 * Reporta la obligación ya creada para una actividad del RE-20. Tolerante a
 * que la obligación no exista (el programa no estaba activo cuando se abrió
 * el caso, por ejemplo): queda en el log, no tumba el hito del incidente.
 */
async function reportIncidentObligation(input: {
  n: number
  worksiteId: string
  incidentId: string
  occurredAt: string
  userId: string
  evidenceText: string
}): Promise<void> {
  try {
    const resolved = await resolvePdtpActivityIdsForNumbers({
      worksiteId: input.worksiteId, occurredAt: input.occurredAt,
      activityNumbers: [input.n], sourceType: "incident", sourceId: input.incidentId,
    })
    if (!resolved) return // fuera del año del programa: ya se logueó al resolver.
    const activityId = resolved.activityIdByN.get(input.n)
    if (!activityId) return // actividad no encontrada en el programa: ya se logueó.

    const key = incidentObligationIdempotencyKey(activityId, input.worksiteId, input.incidentId)
    const obligation = await findPdtpObligationByIdempotencyKey(key)
    if (!obligation) {
      logger.warn(
        { n: input.n, incidentId: input.incidentId, worksiteId: input.worksiteId },
        "[incident-pdtp-connector] No hay obligación creada para este hito del RE-20; no se reporta.",
      )
      return
    }
    await reportPdtpObligation({
      obligationId: obligation.id,
      executedQuantity: 1,
      evidenceText: input.evidenceText,
      reportedAt: input.occurredAt,
      userId: input.userId,
      scope: "all",
    })
  } catch (err) {
    logger.error(
      { err, n: input.n, incidentId: input.incidentId, worksiteId: input.worksiteId },
      "[incident-pdtp-connector] Error al reportar una obligación del RE-20.",
    )
  }
}

/**
 * 66, 67: Aviso registrado en turno — se crea y se reporta de inmediato.
 * 68-75,77,78: sólo las que aplican según el tipo de evento/severidad del
 * incidente (ver `applicableRe20FilterableNumbers`).
 */
export async function onIncidentReported(input: {
  incidentId: string
  worksiteId: string
  reportedAt: string
  userId: string
  eventType: IncidentEventType
  actualSeverity: string
  potentialSeverity: string
  isFatalOrSerious: boolean
}) {
  // Libro durable para reglas nuevas configuradas desde el creador. El
  // cableado RE-20 de abajo conserva sus obligaciones históricas; ambos pueden
  // coexistir porque comparten la misma clave de evento y son idempotentes.
  try {
    await recordPdtpTriggerEvent({
      connectorKey: "incidents",
      eventKey: "incident_registered",
      sourceType: "incident",
      sourceId: input.incidentId,
      worksiteId: input.worksiteId,
      occurredAt: input.reportedAt,
      payload: { incidentId: input.incidentId, reportedByUserId: input.userId },
    })
  } catch (error) {
    logger.error({ err: error, incidentId: input.incidentId, worksiteId: input.worksiteId }, "[incident-pdtp-connector] No se pudo registrar el evento configurable del incidente.")
  }

  const numbersToCreate = [66, 67, ...applicableRe20FilterableNumbers(input)]

  const resolved = await resolvePdtpActivityIdsForNumbers({
    worksiteId: input.worksiteId, occurredAt: input.reportedAt,
    activityNumbers: numbersToCreate, sourceType: "incident", sourceId: input.incidentId,
  }).catch((err: unknown) => {
    logger.error({ err, incidentId: input.incidentId, worksiteId: input.worksiteId }, "[incident-pdtp-connector] No se pudieron resolver las obligaciones del RE-20.")
    return null
  })
  if (!resolved) return

  for (const n of numbersToCreate) {
    const activityId = resolved.activityIdByN.get(n)
    if (!activityId) continue
    const immediate = n === 66 || n === 67
    await ensureIncidentObligation({
      activityId, worksiteId: input.worksiteId, incidentId: input.incidentId, occurredAt: input.reportedAt,
      userId: input.userId,
      immediateEvidence: immediate ? `Aviso de incidente registrado: ${input.incidentId}` : undefined,
    })
  }
}

/**
 * El triage puede reclasificar severidad/`isFatalOrSerious` después de ya
 * abiertas las obligaciones del reporte inicial (`onIncidentReported`). Si con
 * los datos nuevos una de las diez filtrables deja de aplicar, se **cancela**
 * con motivo — nunca se borra ni se ignora en silencio — para no dejarla
 * vencer eternamente como un incumplimiento fantasma del RE-20.
 *
 * La N°66/67 nunca se tocan acá: se crean y reportan siempre, sin condición.
 *
 * Tolerante a fallos, igual que el resto del conector: un error al cancelar
 * una obligación queda en el log y no tumba el triage. `cancelPdtpObligation`
 * abre su propia transacción y no admite batch, así que se llama una vez por
 * obligación a cancelar.
 */
export async function reconcileIncidentObligationsAfterTriage(input: {
  incidentId: string
  worksiteId: string
  occurredAt: string
  userId: string
  eventType: IncidentEventType
  actualSeverity: string
  potentialSeverity: string
  isFatalOrSerious: boolean
}): Promise<void> {
  const stillApplicable = new Set(applicableRe20FilterableNumbers(input))
  const noLongerApplicable = RE20_FILTERABLE_ACTIVITY_NUMBERS.filter((n) => !stillApplicable.has(n))

  const resolved = await resolvePdtpActivityIdsForNumbers({
    worksiteId: input.worksiteId, occurredAt: input.occurredAt,
    activityNumbers: [...RE20_FILTERABLE_ACTIVITY_NUMBERS], sourceType: "incident", sourceId: input.incidentId,
  }).catch((err: unknown) => {
    logger.error(
      { err, incidentId: input.incidentId, worksiteId: input.worksiteId },
      "[incident-pdtp-connector] No se pudieron resolver las obligaciones del RE-20 para reconciliar tras el triage.",
    )
    return null
  })
  if (!resolved) return

  // M-23 (auditoría 2026-09-28): un triage que agrava el incidente abre ya las
  // obligaciones que pasan a aplicar; antes esperaban al barrido horario.
  // `ensureIncidentObligation` es idempotente: las que ya existían no cambian.
  for (const n of stillApplicable) {
    const activityId = resolved.activityIdByN.get(n)
    if (!activityId) continue
    await ensureIncidentObligation({
      activityId, worksiteId: input.worksiteId, incidentId: input.incidentId, occurredAt: input.occurredAt, userId: input.userId,
    })
  }

  for (const n of noLongerApplicable) {
    const activityId = resolved.activityIdByN.get(n)
    if (!activityId) continue
    try {
      const key = incidentObligationIdempotencyKey(activityId, input.worksiteId, input.incidentId)
      const obligation = await findPdtpObligationByIdempotencyKey(key)
      if (!obligation) continue // no se llegó a crear (p. ej. fuera del año del programa): nada que cancelar.
      if (obligation.status !== "pending" && obligation.status !== "overdue") continue // ya reportada/completada/cancelada: no se toca.
      await cancelPdtpObligation({
        obligationId: obligation.id,
        userId: input.userId,
        reason: "Reclasificado en el triage: el tipo de evento ya no exige esta actividad del RE-20.",
        scope: "all",
      })
    } catch (err) {
      logger.error(
        { err, n, incidentId: input.incidentId, worksiteId: input.worksiteId },
        "[incident-pdtp-connector] Error al cancelar una obligación del RE-20 reclasificada en el triage.",
      )
    }
  }
}

/** 68, 70: Informe preliminar enviado (≤3h) */
export async function onIncidentPreliminaryReported(input: { incidentId: string; worksiteId: string; reportedAt: string; userId: string }) {
  for (const n of [68, 70]) {
    await reportIncidentObligation({
      n, worksiteId: input.worksiteId, incidentId: input.incidentId, occurredAt: input.reportedAt, userId: input.userId,
      evidenceText: `Informe preliminar RE-20-02 enviado: ${input.incidentId}`,
    })
  }
}

/** 69: Declaración del involucrado / entrevista (≤24h) */
export async function onIncidentStatementRecorded(input: { incidentId: string; worksiteId: string; recordedAt: string; userId: string }) {
  await reportIncidentObligation({
    n: 69, worksiteId: input.worksiteId, incidentId: input.incidentId, occurredAt: input.recordedAt, userId: input.userId,
    evidenceText: `Declaración/Entrevista RE-20 firmada: ${input.incidentId}`,
  })
}

/** 72: DIAT emitida (≤24h) */
export async function onIncidentDiatIssued(input: { incidentId: string; worksiteId: string; issuedAt: string; userId: string }) {
  await reportIncidentObligation({
    n: 72, worksiteId: input.worksiteId, incidentId: input.incidentId, occurredAt: input.issuedAt, userId: input.userId,
    evidenceText: `DIAT RE-20-07 emitida: ${input.incidentId}`,
  })
}

/** 73, 74: Investigación definitiva completada / informe enviado (≤72h) */
export async function onIncidentInvestigationCompleted(input: { incidentId: string; worksiteId: string; completedAt: string; userId: string }) {
  for (const n of [73, 74]) {
    await reportIncidentObligation({
      n, worksiteId: input.worksiteId, incidentId: input.incidentId, occurredAt: input.completedAt, userId: input.userId,
      evidenceText: `Investigación definitiva RE-20-04 completada: ${input.incidentId}`,
    })
  }
}

/** 71: Difusión del evento en los turnos (≤8h, propuesto) */
export async function onIncidentShiftDiffused(input: { incidentId: string; worksiteId: string; diffusedAt: string; userId: string }) {
  await reportIncidentObligation({
    n: 71, worksiteId: input.worksiteId, incidentId: input.incidentId, occurredAt: input.diffusedAt, userId: input.userId,
    evidenceText: `Difusión en turnos confirmada: ${input.incidentId}`,
  })
}

/** 75: Difusión de las medidas correctivas (≤48h) */
export async function onIncidentMeasuresDiffused(input: { incidentId: string; worksiteId: string; diffusedAt: string; userId: string }) {
  await reportIncidentObligation({
    n: 75, worksiteId: input.worksiteId, incidentId: input.incidentId, occurredAt: input.diffusedAt, userId: input.userId,
    evidenceText: `Difusión de medidas correctivas confirmada: ${input.incidentId}`,
  })
}

/**
 * 76: Seguimiento quincenal de medidas — fuera del modelo de obligación (ver
 * el docblock del archivo). Sigue acreditando directo, con una fila por
 * seguimiento: cada `followupId` es su propio evento durable.
 */
export async function onIncidentFollowupRecorded(input: { incidentId: string; worksiteId: string; followupId: string; recordedAt: string }) {
  await recordPdtpFulfillmentEvent({
    sourceType: "incident",
    sourceId: `${input.incidentId}:seguimiento:${input.followupId}`,
    worksiteId: input.worksiteId,
    catalogActivityIds: [pdtpCatalogActivityIdForLegacyNumber(76)],
    occurredAt: input.recordedAt,
    evidenceRef: `Seguimiento de medidas RE-20-08: ${input.followupId}`,
  })
}

/** 77: Expediente archivado/cerrado (propuesto, tras el cierre del caso) */
export async function onIncidentClosed(input: { incidentId: string; worksiteId: string; closedAt: string; userId: string }) {
  await recordPdtpTriggerEventSafe({
    connectorKey: "incidents",
    eventKey: "incident_closed",
    sourceType: "incident",
    sourceId: input.incidentId,
    worksiteId: input.worksiteId,
    occurredAt: input.closedAt,
    payload: { incidentId: input.incidentId, closedByUserId: input.userId },
  })
  await reportIncidentObligation({
    n: 77, worksiteId: input.worksiteId, incidentId: input.incidentId, occurredAt: input.closedAt, userId: input.userId,
    evidenceText: `Expediente de incidente cerrado: ${input.incidentId}`,
  })
}

/** 78: ONE PAGE RE-20-06 difundido (≤24h) */
export async function onIncidentOnePageDiffused(input: { incidentId: string; worksiteId: string; diffusedAt: string; userId: string }) {
  await reportIncidentObligation({
    n: 78, worksiteId: input.worksiteId, incidentId: input.incidentId, occurredAt: input.diffusedAt, userId: input.userId,
    evidenceText: `ONE PAGE RE-20-06 difundido: ${input.incidentId}`,
  })
}

// ── Barrido de reparación (D4, tanda T3) ──────────────────────────────────────

export type IncidentRe20SweepSummary = {
  incidentsScanned: number
  incidentsWithOpenWork: number
  created: number
  reported: number
  cancelled: number
  skippedExistingExecution: number
  skippedClosedPeriod: number
  skippedNoActor: number
  skippedNotApplicable: number
  errors: number
}

type IncidentMilestone = { at: string; actorUserId: string | null; evidenceText: string }

/**
 * Hitos RE-20 ya registrados en las tablas del incidente, con su fecha real y
 * su actor, por número de actividad. Es la fuente de verdad del barrido: el
 * hito ocurrió aunque el conector post-commit no haya corrido.
 *
 * - N°69: la declaración más antigua de cualquier tipo, como el camino vivo.
 * - N°72: la DIAT enviada; el actor sale de la primera entrada del historial
 *   de notificación DIAT, y si no hay, del responsable del carril.
 * - N°68/70: `preliminaryReportAt` es la fecha del último envío del
 *   preliminar (el upsert la pisa al reenviar); el actor es quien inició la
 *   investigación. Es una aproximación declarada.
 */
async function loadIncidentMilestones(incident: typeof preventionIncidents.$inferSelect): Promise<Map<number, IncidentMilestone>> {
  const milestones = new Map<number, IncidentMilestone>()
  const [[investigation], statements, [diat], diatHistory, [onePage], shiftDiffusions] = await Promise.all([
    db.select().from(preventionIncidentInvestigations).where(eq(preventionIncidentInvestigations.incidentId, incident.id)).limit(1),
    db.select({ createdAt: preventionIncidentStatements.createdAt, createdByUserId: preventionIncidentStatements.createdByUserId })
      .from(preventionIncidentStatements).where(eq(preventionIncidentStatements.incidentId, incident.id))
      .orderBy(asc(preventionIncidentStatements.createdAt)).limit(1),
    db.select().from(preventionIncidentNotifications).where(and(
      eq(preventionIncidentNotifications.incidentId, incident.id),
      eq(preventionIncidentNotifications.notificationType, "diat"),
      isNotNull(preventionIncidentNotifications.sentAt),
    )).limit(1),
    db.select({ actorUserId: preventionIncidentHistory.actorUserId, changeSet: preventionIncidentHistory.changeSet })
      .from(preventionIncidentHistory).where(and(
        eq(preventionIncidentHistory.incidentId, incident.id),
        eq(preventionIncidentHistory.changeType, "notification"),
      )).orderBy(asc(preventionIncidentHistory.createdAt)),
    db.select({ diffusedAt: preventionIncidentDiffusion.diffusedAt, createdByUserId: preventionIncidentDiffusion.createdByUserId })
      .from(preventionIncidentDiffusion).where(eq(preventionIncidentDiffusion.incidentId, incident.id))
      .orderBy(asc(preventionIncidentDiffusion.diffusedAt)).limit(1),
    db.select().from(preventionIncidentShiftDiffusions).where(and(
      eq(preventionIncidentShiftDiffusions.incidentId, incident.id),
      isNotNull(preventionIncidentShiftDiffusions.confirmedAt),
    )).orderBy(asc(preventionIncidentShiftDiffusions.confirmedAt)),
  ])

  milestones.set(66, { at: incident.createdAt, actorUserId: incident.reportedByUserId, evidenceText: `Aviso de incidente registrado: ${incident.id}` })
  milestones.set(67, { at: incident.createdAt, actorUserId: incident.reportedByUserId, evidenceText: `Aviso de incidente registrado: ${incident.id}` })
  if (investigation?.preliminaryReportAt) {
    for (const n of [68, 70]) {
      milestones.set(n, { at: investigation.preliminaryReportAt, actorUserId: investigation.startedByUserId, evidenceText: `Informe preliminar RE-20-02 enviado: ${incident.id}` })
    }
  }
  if (statements[0]) {
    milestones.set(69, { at: statements[0].createdAt, actorUserId: statements[0].createdByUserId, evidenceText: `Declaración/Entrevista RE-20 firmada: ${incident.id}` })
  }
  if (diat?.sentAt) {
    const historyActor = diatHistory.find((row) => (row.changeSet as { type?: unknown } | null)?.type === "diat")?.actorUserId
    milestones.set(72, { at: diat.sentAt, actorUserId: historyActor ?? diat.responsibleUserId, evidenceText: `DIAT RE-20-07 emitida: ${incident.id}` })
  }
  if (investigation?.completedAt) {
    for (const n of [73, 74]) {
      milestones.set(n, { at: investigation.completedAt, actorUserId: investigation.completedByUserId, evidenceText: `Investigación definitiva RE-20-04 completada: ${incident.id}` })
    }
  }
  const shift = shiftDiffusions.find((row) => row.kind === "shift")
  if (shift?.confirmedAt) milestones.set(71, { at: shift.confirmedAt, actorUserId: shift.confirmedByUserId, evidenceText: `Difusión en turnos confirmada: ${incident.id}` })
  const measures = shiftDiffusions.find((row) => row.kind !== "shift")
  if (measures?.confirmedAt) milestones.set(75, { at: measures.confirmedAt, actorUserId: measures.confirmedByUserId, evidenceText: `Difusión de medidas correctivas confirmada: ${incident.id}` })
  if (incident.closedAt) milestones.set(77, { at: incident.closedAt, actorUserId: incident.closedByUserId, evidenceText: `Expediente de incidente cerrado: ${incident.id}` })
  if (onePage) milestones.set(78, { at: onePage.diffusedAt, actorUserId: onePage.createdByUserId, evidenceText: `ONE PAGE RE-20-06 difundido: ${incident.id}` })
  return milestones
}

/**
 * Red de seguridad de las obligaciones RE-20 (D4). Los ganchos post-commit de
 * arriba siguen siendo el camino rápido; este barrido, que corre cada hora
 * dentro del cron `prevention-incident-reminders`, repara lo que se pierda si
 * el proceso cae entre el commit del incidente y el conector, o si un error
 * transitorio los hizo fallar.
 *
 * Reglas:
 * - Sólo programas activos y sólo incidentes creados desde su activación
 *   (decisión por defecto): no hace cargas retroactivas que nacerían vencidas.
 * - Entra todo incidente cuyas obligaciones no cubren el conjunto esperado
 *   (66, 67 y las filtrables de su clasificación vigente) o que tiene alguna
 *   pendiente o vencida. Así se repara también la pérdida parcial.
 * - Crea con los servicios idempotentes de siempre y cancela lo que la
 *   reclasificación ya no exige.
 * - Reporta un hito sólo si la obligación está pendiente/vencida **y no tiene
 *   ninguna ejecución** en el libro: una ejecución rechazada por una persona
 *   no se reenvía nunca (el rechazo devuelve la obligación a pendiente).
 * - Reporta con la fecha real del hito y sólo si ese mes está abierto.
 * - Nunca lanza: las fallas se cuentan y se registran una vez por corrida.
 *
 * Límite conocido: lo perdido durante una versión v1 no se repara después de
 * activar v2 (el corte es la activación de la versión activa), y el evento
 * configurable `incident_registered` de `recordPdtpTriggerEvent` no se repara
 * acá.
 */
export async function reconcileIncidentRe20Obligations(): Promise<IncidentRe20SweepSummary> {
  const summary: IncidentRe20SweepSummary = {
    incidentsScanned: 0, incidentsWithOpenWork: 0, created: 0, reported: 0, cancelled: 0,
    skippedExistingExecution: 0, skippedClosedPeriod: 0, skippedNoActor: 0, skippedNotApplicable: 0, errors: 0,
  }
  const failures: Array<{ incidentId: string; message: string }> = []
  try {
    const programs = await db.select().from(pdtpPrograms).where(eq(pdtpPrograms.status, "active"))
    for (const program of programs) {
      if (!program.activatedAt) continue
      const incidents = await db.select().from(preventionIncidents)
        .innerJoin(worksites, eq(worksites.id, preventionIncidents.worksiteId))
        .where(and(
          gte(preventionIncidents.createdAt, program.activatedAt),
          eq(worksites.isActive, true),
        ))
      for (const { prevention_incidents: incident } of incidents) {
        if (chileDateParts(incident.createdAt).year !== program.year) continue
        summary.incidentsScanned++
        try {
          await sweepIncident(program, incident, summary)
        } catch (err) {
          summary.errors++
          failures.push({ incidentId: incident.id, message: err instanceof Error ? err.message : String(err) })
        }
      }
    }
  } catch (err) {
    summary.errors++
    failures.push({ incidentId: "*", message: err instanceof Error ? err.message : String(err) })
  }
  if (failures.length > 0) {
    logger.error({ failures: failures.slice(0, 20), total: failures.length }, "[incident-pdtp-connector] El barrido RE-20 no pudo reparar algunos incidentes.")
  }
  return summary
}

async function sweepIncident(
  program: typeof pdtpPrograms.$inferSelect,
  incident: typeof preventionIncidents.$inferSelect,
  summary: IncidentRe20SweepSummary,
): Promise<void> {
  const classification = {
    eventType: incident.eventType as IncidentEventType,
    actualSeverity: incident.actualSeverity,
    potentialSeverity: incident.potentialSeverity,
    isFatalOrSerious: incident.isFatalOrSerious,
  }
  const expected = [66, 67, ...applicableRe20FilterableNumbers(classification)]
  const existing = await db.select({
    id: pdtpObligations.id,
    status: pdtpObligations.status,
    n: pdtpActivities.n,
  }).from(pdtpObligations)
    .innerJoin(pdtpActivities, eq(pdtpActivities.id, pdtpObligations.activityId))
    .where(and(
      eq(pdtpObligations.sourceType, "incident"),
      eq(pdtpObligations.sourceId, incident.id),
      eq(pdtpActivities.programId, program.id),
    ))
  const existingNumbers = new Set(existing.map((row) => row.n))
  const hasOpen = existing.some((row) => row.status === "pending" || row.status === "overdue")
  if (!hasOpen && expected.every((n) => existingNumbers.has(n))) return
  summary.incidentsWithOpenWork++

  const resolved = await resolvePdtpActivityIdsOrSkip({
    worksiteId: incident.worksiteId, occurredAt: incident.createdAt,
    activityNumbers: RE20_OBLIGATION_ACTIVITY_NUMBERS, sourceType: "incident", sourceId: incident.id,
  })
  // Sin programa, faena fuera de la membresía o fuera del año: no aplica.
  if (!resolved || resolved.programId !== program.id) {
    summary.skippedNotApplicable++
    return
  }

  const fallbackActor = await resolvePdtpProgramActorUserId(program.id)
  for (const n of expected) {
    const activityId = resolved.activityIdByN.get(n)
    if (!activityId || existingNumbers.has(n)) continue
    await createPdtpObligation({
      activityId, worksiteId: incident.worksiteId, origin: "integration", sourceType: "incident", sourceId: incident.id,
      sourceOccurredAt: incident.createdAt, userId: incident.reportedByUserId ?? fallbackActor, scope: "all",
    })
    summary.created++
  }

  // La reclasificación puede haber dejado de exigir alguna ya abierta.
  if (incident.triagedAt) {
    const before = await countCancelled(incident.id)
    await reconcileIncidentObligationsAfterTriage({
      incidentId: incident.id, worksiteId: incident.worksiteId, occurredAt: incident.createdAt,
      userId: incident.triagedByUserId ?? incident.reportedByUserId, ...classification,
    })
    summary.cancelled += Math.max(0, (await countCancelled(incident.id)) - before)
  }

  const milestones = await loadIncidentMilestones(incident)
  for (const n of expected) {
    const activityId = resolved.activityIdByN.get(n)
    const milestone = milestones.get(n)
    if (!activityId || !milestone) continue
    const obligation = await findPdtpObligationByIdempotencyKey(incidentObligationIdempotencyKey(activityId, incident.worksiteId, incident.id))
    if (!obligation || (obligation.status !== "pending" && obligation.status !== "overdue")) continue
    const [execution] = await db.select({ id: pdtpExecutions.id }).from(pdtpExecutions)
      .where(eq(pdtpExecutions.obligationId, obligation.id)).limit(1)
    if (execution) {
      summary.skippedExistingExecution++
      continue
    }
    const month = chileDateParts(milestone.at).month
    try {
      await assertPdtpPeriodOpen(program.id, incident.worksiteId, program.year, month)
    } catch {
      summary.skippedClosedPeriod++
      continue
    }
    const actor = milestone.actorUserId ?? fallbackActor
    if (!actor) {
      summary.skippedNoActor++
      continue
    }
    await reportPdtpObligation({
      obligationId: obligation.id, executedQuantity: 1, evidenceText: milestone.evidenceText,
      reportedAt: milestone.at, userId: actor, scope: "all",
    })
    summary.reported++
  }
}

async function countCancelled(incidentId: string): Promise<number> {
  const rows = await db.select({ id: pdtpObligations.id }).from(pdtpObligations).where(and(
    eq(pdtpObligations.sourceType, "incident"),
    eq(pdtpObligations.sourceId, incidentId),
    eq(pdtpObligations.status, "cancelled"),
  ))
  return rows.length
}
