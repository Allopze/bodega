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
import { pdtpActivities, pdtpExecutions, pdtpPrograms, worksites } from "@/db/schema"
import { currentPdtpPeriod, type PdtpPeriod } from "./period"
import { logger } from "@/lib/logger"
import { createNotifications, getUserIdsWithPermissionForWorksite } from "@/lib/services/notifications"
import { listVencidas } from "./followups"
import { loadProgramScheduleAndExecutions } from "./helpers"

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

  const activityRows = await db
    .select({ id: pdtpActivities.id })
    .from(pdtpActivities)
    .where(eq(pdtpActivities.programId, program.id))

  if (activityRows.length === 0) return []

  const activityIds = activityRows.map((row) => row.id)
  const allWorksites = await db
    .select({ id: worksites.id, name: worksites.name })
    .from(worksites)
    .where(eq(worksites.isActive, true))
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
