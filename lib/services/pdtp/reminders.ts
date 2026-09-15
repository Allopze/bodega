/**
 * lib/services/pdtp/reminders.ts
 *
 * Servicio del motor de recordatorios semanales PDTP. Detecta, para el
 * programa activo y el período actual, faenas con actividades planeadas
 * sin ejecución registrada, y arma la lista de destinatarios por permiso
 * y faena. El envío real lo hace el route /api/cron/pdtp-weekly-reminders
 * (calca de sst-weekly-alerts).
 */

import { and, eq, inArray } from "drizzle-orm"
import { db } from "@/db"
import {
  pdtpActivities, pdtpExecutions, pdtpObligationReminders, pdtpPrograms, pdtpProgramWorksites,
  preventionEmergencyPlans, preventionRiskMatrices,
  sstDocuments, sstDocumentVersions, worksites,
} from "@/db/schema"
import { MATRIX_PERMISSION, MATRIX_TRANSITIONS } from "@/lib/services/prevention-risk-legal"
import { currentPdtpPeriod, isPdtpPeriodOnOrAfterActivation, type PdtpPeriod } from "./period"
import { logger } from "@/lib/logger"
import { createNotifications, getUserIdsWithPermissionForWorksite } from "@/lib/services/notifications"
import { listVencidas } from "./followups"
import { loadProgramScheduleAndExecutions } from "./helpers"
import { listPdtpObligationReminderCandidates, recordPdtpObligationReminder, type PdtpReminderWindow } from "./obligations"
import { isPdtpActivityEffectiveForPeriod } from "./retirement"

export type PdtpPendingTarget = {
  worksiteId: string
  worksiteName: string
  /** IDs de actividades con plan pendiente en el período (sin ejecución). */
  activityIds: string[]
}

export type PdtpWeeklyPendingResult = {
  period: PdtpPeriod
  programId: string
  year: number
  targets: PdtpPendingTarget[]
  notifiedUsers: number
}

/**
 * Detecta faenas activas con actividades planificadas en la semana actual
 * que no tienen ejecución registrada. Usa el cronograma efectivo por faena,
 * por lo que un override a 0 no genera recordatorios y uno que agrega una
 * celda sí queda cubierto.
 */
export async function findPdtpWeeklyPending(period: PdtpPeriod = currentPdtpPeriod()): Promise<PdtpPendingTarget[]> {
  // H4: antes se tomaba la versión más alta del año y se exigía que ESA
  // fuera "active" — si existía un draft más nuevo (vN+1) mientras vN
  // seguía activo, esto devolvía [] y el programa activo real nunca
  // recibía recordatorios. Consultamos "active" directo, como
  // getActivePdtpProgram/getPdtpComplianceIndicators.
  const [program] = await db
    .select()
    .from(pdtpPrograms)
    .where(and(eq(pdtpPrograms.year, period.year), eq(pdtpPrograms.status, "active")))
    .limit(1)
  if (!program) return []
  // Una consulta retrospectiva (o un cron desfasado) no puede reclamar trabajo
  // de una semana en que la versión aún no estaba activa.
  if (!isPdtpPeriodOnOrAfterActivation(period, program.activatedAt)) return []

  const activityRows = await db
    .select({
      id: pdtpActivities.id,
      status: pdtpActivities.status,
      retiredEffectiveFrom: pdtpActivities.retiredEffectiveFrom,
    })
    .from(pdtpActivities)
    .where(eq(pdtpActivities.programId, program.id))

  if (activityRows.length === 0) return []

  const activityIds = activityRows
    .filter((row) => isPdtpActivityEffectiveForPeriod(row, period.year, period.month, period.week))
    .map((row) => row.id)
  if (activityIds.length === 0) return []
  const [visibleWorksites, memberRows] = await Promise.all([
    db.select({ id: worksites.id, name: worksites.name })
      .from(worksites)
      .where(eq(worksites.isActive, true)),
    db.select({ worksiteId: pdtpProgramWorksites.worksiteId })
      .from(pdtpProgramWorksites)
      .where(and(
        eq(pdtpProgramWorksites.programId, program.id),
        eq(pdtpProgramWorksites.isActive, true),
      )),
  ])
  const memberIds = new Set(memberRows.map((row) => row.worksiteId))
  const allWorksites = memberIds.size > 0
    ? visibleWorksites.filter((worksite) => memberIds.has(worksite.id))
    : visibleWorksites
  if (allWorksites.length === 0) return []

  const targetResults = await Promise.all(allWorksites.map(async (ws) => {
    const { scheduleRows, executionRows } = await loadProgramScheduleAndExecutions(activityIds, period.year, ws.id)
    const executedActivityIds = new Set(
      executionRows
        .filter((row) => row.month === period.month && row.week === period.week)
        .map((row) => row.activityId),
    )
    const pendingActivityIds = new Set(
      scheduleRows.reduce<string[]>((activityIds, row) => {
        if (
          row.year === period.year
          && row.month === period.month
          && row.week === period.week
          && row.plannedQuantity > 0
          && !executedActivityIds.has(row.activityId)
        ) {
          activityIds.push(row.activityId)
        }
        return activityIds
      }, []),
    )
    if (pendingActivityIds.size > 0) {
      return { worksiteId: ws.id, worksiteName: ws.name, activityIds: [...pendingActivityIds] }
    }
    return null
  }))
  return targetResults.reduce<PdtpPendingTarget[]>((targets, target) => {
    if (target) targets.push(target)
    return targets
  }, [])
}

/**
 * Recorre los targets, resuelve destinatarios por permiso+faena y envía
 * una notificación por cada uno. Devuelve el conteo de usuarios
 * efectivamente notificados (deduplicado).
 */
export async function runPdtpWeeklyReminders(period: PdtpPeriod = currentPdtpPeriod()): Promise<PdtpWeeklyPendingResult> {
  // Mismo criterio que findPdtpWeeklyPending: el programId reportado debe
  // ser el activo que realmente generó los targets, no "la versión más
  // alta" (que puede ser un draft sin relación con los pendientes).
  const [program] = await db
    .select()
    .from(pdtpPrograms)
    .where(and(eq(pdtpPrograms.year, period.year), eq(pdtpPrograms.status, "active")))
    .limit(1)
  if (!program) {
    logger.info("[pdtp/reminders] no active program found, skipping")
    return { period, programId: "", year: period.year, targets: [], notifiedUsers: 0 }
  }

  const targets = await findPdtpWeeklyPending(period)
  if (targets.length === 0) {
    logger.info("[pdtp/reminders] no pending targets, nothing to do")
    return { period, programId: program.id, year: period.year, targets, notifiedUsers: 0 }
  }

  // Consolida targets por (userId, worksiteId) para no spamear al mismo
  // destinatario si tiene varias faenas con pendientes. Dedupe por
  // (userId, dedupeKey) en `notifications` previene duplicados si el
  // cron se ejecuta varias veces en el mismo período.
  const userWorksiteMap = new Map<string, { userId: string; worksiteId: string; worksiteName: string; activityIds: Set<string> }>()
  const recipientsByTarget = await Promise.all(targets.map(async (target) => ({
    target,
    userIds: await getUserIdsWithPermissionForWorksite("prevention:pdtp:execute", target.worksiteId),
  })))
  for (const { target, userIds } of recipientsByTarget) {
    for (const userId of userIds) {
      const key = `${userId}::${target.worksiteId}`
      const existing = userWorksiteMap.get(key)
      if (existing) {
        for (const aid of target.activityIds) existing.activityIds.add(aid)
      } else {
        userWorksiteMap.set(key, {
          userId,
          worksiteId: target.worksiteId,
          worksiteName: target.worksiteName,
          activityIds: new Set(target.activityIds),
        })
      }
    }
  }

  const notifiedUserIds = new Set<string>()
  for (const entry of userWorksiteMap.values()) {
    notifiedUserIds.add(entry.userId)
    // dedupeKey estable: 1 notificación por (user, faena, semana, mes, año)
    // hasta que el usuario ejecute las actividades o cambie el período.
    const dedupeKey = `pdtp-weekly:${entry.userId}:${entry.worksiteId}:${period.year}:${period.month}:W${period.week}`
    await createNotifications([entry.userId], {
      type: "system_alert",
      title: `📋 PDTP semana ${period.week} con ${entry.activityIds.size} actividad(es) pendiente(s)`,
      body: `La faena "${entry.worksiteName}" tiene actividades del programa preventivo SG-SST ${period.year} sin registrar esta semana.`,
      entityType: "pdtp_program",
      entityId: program.id,
      entityHref: "/prevencion/pdtp",
      dedupeKey,
    })
  }

  return {
    period,
    programId: program.id,
    year: period.year,
    targets,
    notifiedUsers: notifiedUserIds.size,
  }
}

export type PdtpActionVencidasReminderResult = {
  vencidas: number
  notifiedUsers: number
}

export type PdtpObligationReminderResult = {
  candidates: number
  notificationsCreated: number
  notifiedUsers: number
}

const OBLIGATION_WINDOW_COPY: Record<PdtpReminderWindow, { title: string; body: string }> = {
  due_7d: { title: "Obligación preventiva próxima a vencer", body: "vence dentro de los próximos 7 días" },
  due_1d: { title: "Obligación preventiva por vencer", body: "vence dentro de 1 día" },
  overdue: { title: "Obligación preventiva vencida", body: "está vencida y requiere atención" },
}

/**
 * Extiende el cron PDTP a las obligaciones nacidas de necesidades o eventos.
 * La deduplicación funcional queda en `pdtp_obligation_reminders`; la clave de
 * `notifications` protege además frente a dos procesos cron concurrentes.
 */
export async function runPdtpObligationReminders(asOf = new Date()): Promise<PdtpObligationReminderResult> {
  const candidates = await listPdtpObligationReminderCandidates({ scope: "all", asOf })
  const notifiedUserIds = new Set<string>()
  let notificationsCreated = 0

  for (const candidate of candidates) {
    const recipientIds = await getUserIdsWithPermissionForWorksite(
      "prevention:pdtp:execute",
      candidate.obligation.worksiteId,
    )
    for (const recipientUserId of recipientIds) {
      const [alreadyRecorded] = await db.select({ id: pdtpObligationReminders.id })
        .from(pdtpObligationReminders)
        .where(and(
          eq(pdtpObligationReminders.obligationId, candidate.obligation.id),
          eq(pdtpObligationReminders.recipientUserId, recipientUserId),
          eq(pdtpObligationReminders.reminderWindow, candidate.window),
        ))
        .limit(1)
      if (alreadyRecorded) continue

      const copy = OBLIGATION_WINDOW_COPY[candidate.window]
      const dedupeKey = `pdtp-obligation:${candidate.obligation.id}:${recipientUserId}:${candidate.window}`
      await createNotifications([recipientUserId], {
        type: "system_alert",
        title: copy.title,
        body: `Actividad N°${candidate.activityNumber} en “${candidate.worksiteName}”: ${candidate.activityName} ${copy.body}.`,
        entityType: "pdtp_obligation",
        entityId: candidate.obligation.id,
        entityHref: "/prevencion/pdtp/obligaciones",
        dedupeKey,
      })
      const recorded = await recordPdtpObligationReminder({
        obligationId: candidate.obligation.id,
        recipientUserId,
        window: candidate.window,
      })
      if (recorded.created) notificationsCreated += 1
      notifiedUserIds.add(recipientUserId)
    }
  }

  return { candidates: candidates.length, notificationsCreated, notifiedUsers: notifiedUserIds.size }
}

/**
 * Notifica acciones correctivas vencidas del plan de acción (plan §2.4/§4).
 * Si la acción tiene responsableUserId, notifica directo; si no, notifica a
 * quienes tengan `prevention:pdtp:action:manage` en la faena de la ejecución.
 */
export async function runPdtpActionPlanVencidasReminders(): Promise<PdtpActionVencidasReminderResult> {
  const vencidas = await listVencidas()
  if (vencidas.length === 0) {
    logger.info("[pdtp/reminders] no vencidas action-plan items, nothing to do")
    return { vencidas: 0, notifiedUsers: 0 }
  }

  const executionIds = [...new Set(vencidas.map((v) => v.executionId))]
  const executionRows = await db.select({ id: pdtpExecutions.id, worksiteId: pdtpExecutions.worksiteId })
    .from(pdtpExecutions).where(inArray(pdtpExecutions.id, executionIds))
  const worksiteByExecution = new Map(executionRows.map((r) => [r.id, r.worksiteId]))

  const notifiedUserIds = new Set<string>()
  for (const item of vencidas) {
    const worksiteId = worksiteByExecution.get(item.executionId)
    const targetUserIds = item.responsableUserId
      ? [item.responsableUserId]
      : worksiteId ? await getUserIdsWithPermissionForWorksite("prevention:pdtp:action:manage", worksiteId) : []

    for (const userId of targetUserIds) {
      notifiedUserIds.add(userId)
      // dedupeKey estable por acción+plazo: no repite hasta que cambie el plazo o se cierre.
      const dedupeKey = `pdtp-action-vencida:${item.id}:${item.plazo}`
      await createNotifications([userId], {
        type: "system_alert",
        title: `⏰ Acción PDTP vencida: ${item.hallazgo.slice(0, 60)}`,
        body: `La acción correctiva N°${item.n} venció el ${item.plazo} y sigue en estado "${item.estado}".`,
        entityType: "pdtp_action_plan",
        entityId: item.id,
        entityHref: "/prevencion/pdtp",
        dedupeKey,
      })
    }
  }

  return { vencidas: vencidas.length, notifiedUsers: notifiedUserIds.size }
}

// ── Firma pendiente (N°35, N°43, N°80, N°83) ──────────────────────────────

/**
 * Cuántos días lleva un registro esperando su firma antes de avisar, y cuántas
 * veces se avisa.
 *
 * Tres escalones y no un aviso diario: el modo de falla de estas actividades es
 * lento —un plan de emergencia puede pasar semanas en borrador— y un correo
 * cada mañana se convierte en ruido que nadie abre a la tercera semana.
 */
const SIGNATURE_BUCKETS = [
  { days: 30, bucket: "30d", copy: "lleva más de un mes esperando firma" },
  { days: 15, bucket: "15d", copy: "lleva más de quince días esperando firma" },
  { days: 7, bucket: "7d", copy: "lleva más de una semana esperando firma" },
] as const

export type PdtpSignaturePendingResult = {
  /** Registros esperando firma, hayan cruzado un escalón o no. */
  pending: number
  /**
   * Los que cruzaron un escalón y tienen a quién avisarle.
   *
   * No es "correos enviados": `createNotifications` deduplica por
   * `(userId, dedupeKey)`, así que la corrida del día siguiente cuenta los
   * mismos registros y no manda nada. Llamarlo `notificationsCreated` hacía que
   * el JSON del cron reportara siete avisos nuevos cada mañana.
   */
  remindersDue: number
  notifiedUsers: number
}

type PendingSignature = {
  entityType: string
  entityId: string
  worksiteId: string
  title: string
  status: string
  updatedAt: string
  /** Permiso de quien tiene que firmar el paso siguiente. */
  permission: string
  href: string
}

/** El escalón que corresponde, o `null` si todavía no cumple el primero. */
function signatureBucketFor(updatedAt: string, asOf: Date): typeof SIGNATURE_BUCKETS[number] | null {
  const elapsedDays = Math.floor((asOf.getTime() - new Date(updatedAt).getTime()) / 86_400_000)
  return SIGNATURE_BUCKETS.find((step) => elapsedDays >= step.days) ?? null
}

/**
 * Actos del programa que quedaron esperando una firma que nadie dio.
 *
 * Es el modo de falla propio de las actividades segregadas —la N°35, la N°43,
 * la N°80 y la N°83—: el responsable hace su parte, el registro queda a la
 * espera de otra persona, y esa persona no sabe que le toca. Nada lo detectaba;
 * los 7 planes de emergencia del 2026 llevaban meses en borrador y la N°84
 * esperando detrás sin que ninguna alerta lo dijera.
 *
 * **Mide "días sin movimiento en este estado", no "días desde que se pidió la
 * firma".** Ninguna de las cuatro tablas tiene `awaiting_signature_since`, así
 * que se usa `updated_at`, que se reescribe en cada transición. Para las
 * matrices y los documentos la aproximación es buena —quedaron en ese estado y
 * nadie las tocó—; para los planes de emergencia es más débil, porque no existe
 * un estado `in_review`: el plan nace `draft` y salta a `approved`, así que lo
 * que se mide ahí es un borrador estancado. Sirve para avisar, y no exige
 * migración. La fecha exacta vive en las tablas de historia
 * (`prevention_risk_legal_history`, `sst_document_audit`,
 * `prevention_emergency_history`) si algún día hace falta ser preciso.
 */
async function findPendingSignatures(): Promise<PendingSignature[]> {
  const [plans, riskMatrices, documentVersions] = await Promise.all([
    db.select({
      id: preventionEmergencyPlans.id,
      worksiteId: preventionEmergencyPlans.worksiteId,
      title: preventionEmergencyPlans.title,
      status: preventionEmergencyPlans.status,
      updatedAt: preventionEmergencyPlans.updatedAt,
    }).from(preventionEmergencyPlans).where(eq(preventionEmergencyPlans.status, "draft")),
    db.select({
      id: preventionRiskMatrices.id,
      worksiteId: preventionRiskMatrices.worksiteId,
      title: preventionRiskMatrices.title,
      status: preventionRiskMatrices.status,
      updatedAt: preventionRiskMatrices.updatedAt,
    }).from(preventionRiskMatrices).where(inArray(preventionRiskMatrices.status, ["in_review", "reviewed", "approved"])),
    db.select({
      id: sstDocumentVersions.id,
      status: sstDocumentVersions.status,
      updatedAt: sstDocumentVersions.updatedAt,
      documentId: sstDocumentVersions.documentId,
      title: sstDocuments.title,
      // La faena cuelga del documento padre, no de la versión.
      worksiteId: sstDocuments.worksiteId,
    }).from(sstDocumentVersions)
      .innerJoin(sstDocuments, eq(sstDocuments.id, sstDocumentVersions.documentId))
      .where(inArray(sstDocumentVersions.status, ["en_revision", "aprobado"])),
  ])

  const pending: PendingSignature[] = []

  for (const plan of plans) {
    pending.push({
      entityType: "emergency_plan", entityId: plan.id, worksiteId: plan.worksiteId,
      title: plan.title, status: plan.status, updatedAt: plan.updatedAt,
      permission: "prevention:emergency:approve",
      href: `/prevencion/emergencias/${plan.id}`,
    })
  }

  /* El permiso sale del paso SIGUIENTE, no del actual: una matriz en
   * `in_review` espera a quien pueda llevarla a `reviewed`. Los dos mapas son
   * los del propio servicio de transición — si cambia la máquina de estados,
   * cambia esto con ella. */
  for (const matrix of riskMatrices) {
    const next = MATRIX_TRANSITIONS[matrix.status]?.find((to) => to !== "draft")
    const permission = next ? MATRIX_PERMISSION[next] : undefined
    if (!permission) continue
    pending.push({
      entityType: "risk_matrix", entityId: matrix.id, worksiteId: matrix.worksiteId,
      title: matrix.title, status: matrix.status, updatedAt: matrix.updatedAt,
      permission, href: `/prevencion/miper`,
    })
  }

  for (const version of documentVersions) {
    // Sin faena no hay a quién avisarle: los destinatarios se resuelven por
    // permiso Y faena, y un documento corporativo no tiene una.
    if (!version.worksiteId) continue
    pending.push({
      entityType: "sst_document_version", entityId: version.id, worksiteId: version.worksiteId,
      title: version.title, status: version.status, updatedAt: version.updatedAt,
      permission: version.status === "en_revision" ? "prevention:docs:approve" : "prevention:docs:publish",
      href: `/prevencion/documentacion/${version.documentId}`,
    })
  }

  return pending
}

const SIGNATURE_ENTITY_LABEL: Record<string, string> = {
  emergency_plan: "El plan de emergencia",
  risk_matrix: "La matriz MIPER",
  sst_document_version: "El documento",
}

/**
 * Avisa a quien tiene que firmar. Se encadena en el cron semanal del PDTP, bajo
 * el mismo lock que los otros tres jobs.
 */
export async function runPdtpSignaturePendingReminders(asOf = new Date()): Promise<PdtpSignaturePendingResult> {
  const pending = await findPendingSignatures()
  const notifiedUserIds = new Set<string>()
  let remindersDue = 0

  /* Los destinatarios se resuelven una vez por (permiso, faena) y no una por
   * registro: son pocas faenas y muchos registros, y `getUserIds…` es una
   * consulta con dos joins. Mismo criterio que los recordatorios de CAPA. */
  const recipientsByKey = new Map<string, string[]>()
  async function recipientsFor(permission: string, worksiteId: string): Promise<string[]> {
    const key = `${permission}::${worksiteId}`
    const cached = recipientsByKey.get(key)
    if (cached) return cached
    const resolved = await getUserIdsWithPermissionForWorksite(permission, worksiteId)
    recipientsByKey.set(key, resolved)
    return resolved
  }

  for (const item of pending) {
    const step = signatureBucketFor(item.updatedAt, asOf)
    if (!step) continue

    let recipients: string[]
    try {
      recipients = await recipientsFor(item.permission, item.worksiteId)
    } catch (err) {
      // Una faena que falla no debe silenciar las demás.
      logger.error({ err, entityId: item.entityId, permission: item.permission }, "[pdtp-firma-pendiente] No se pudo resolver destinatarios.")
      continue
    }
    if (recipients.length === 0) {
      /* Nadie con ese permiso en esa faena: la actividad está esperando una
       * firma que ninguna persona puede dar. Es más grave que un atraso, así
       * que queda dicho en el log aunque no haya a quién notificar. */
      logger.warn(
        { entityType: item.entityType, entityId: item.entityId, worksiteId: item.worksiteId, permission: item.permission },
        "[pdtp-firma-pendiente] Registro esperando una firma que nadie en la faena puede dar.",
      )
      continue
    }

    /* El estado va en la clave: si el registro avanza y vuelve a quedarse
     * esperando, es una espera nueva y merece un aviso nuevo. El escalón evita
     * repetir el mismo aviso todos los días. */
    const dedupeKey = `pdtp-firma-pendiente:${item.entityType}:${item.entityId}:${item.status}:${step.bucket}`
    await createNotifications(recipients, {
      type: "system_alert",
      title: "Hay un registro de Prevención esperando tu firma",
      body: `${SIGNATURE_ENTITY_LABEL[item.entityType] ?? "El registro"} “${item.title}” ${step.copy}.`,
      entityType: item.entityType,
      entityId: item.entityId,
      entityHref: item.href,
      dedupeKey,
    })
    remindersDue += 1
    for (const userId of recipients) notifiedUserIds.add(userId)
  }

  return { pending: pending.length, remindersDue, notifiedUsers: notifiedUserIds.size }
}
