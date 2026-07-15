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
import { pdtpActivities, pdtpActivitySchedule, pdtpExecutions, pdtpPrograms, worksites } from "@/db/schema"
import { currentPdtpPeriod, type PdtpPeriod } from "./period"
import { logger } from "@/lib/logger"
import { createNotifications, getUserIdsWithPermissionForWorksite } from "@/lib/services/notifications"
import { listVencidas } from "./followups"

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
 * Detecta faenas con actividades planificadas en el período actual (y el
 * anterior) que no tienen ejecución registrada. Devuelve una lista
 * agrupada por faena con los IDs de actividades pendientes.
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
    .select({ id: pdtpActivities.id, worksiteScope: pdtpActivitySchedule.sourceColumn })
    .from(pdtpActivities)
    .innerJoin(pdtpActivitySchedule, eq(pdtpActivitySchedule.activityId, pdtpActivities.id))
    .where(and(
      eq(pdtpActivities.programId, program.id),
      eq(pdtpActivitySchedule.year, period.year),
      inArray(pdtpActivitySchedule.month, [period.month, period.month - 1].filter((m) => m >= 1 && m <= 12)),
    ))

  if (activityRows.length === 0) return []

  const activityIds = [...new Set(activityRows.map((row) => row.id))]

  const executionRows = await db
    .select({ activityId: pdtpExecutions.activityId, worksiteId: pdtpExecutions.worksiteId, month: pdtpExecutions.month, week: pdtpExecutions.week })
    .from(pdtpExecutions)
    .where(and(
      inArray(pdtpExecutions.activityId, activityIds),
      eq(pdtpExecutions.year, period.year),
    ))

  const executedKeys = new Set(
    executionRows
      .filter((row) => row.month === period.month || row.month === period.month - 1)
      .map((row) => `${row.activityId}::${row.worksiteId}::${row.month}::${row.week}`),
  )

  const allWorksites = await db.select({ id: worksites.id, name: worksites.name }).from(worksites)
  if (allWorksites.length === 0) return []

  const byWorksite = new Map<string, Set<string>>()
  for (const ws of allWorksites) byWorksite.set(ws.id, new Set())

  for (const activity of activityRows) {
    for (const [worksiteId, set] of byWorksite) {
      const key = `${activity.id}::${worksiteId}::${period.month}::${period.week}`
      if (!executedKeys.has(key)) set.add(activity.id)
    }
  }

  const targets: PdtpPendingTarget[] = []
  for (const ws of allWorksites) {
    const ids = byWorksite.get(ws.id)
    if (!ids || ids.size === 0) continue
    targets.push({ worksiteId: ws.id, worksiteName: ws.name, activityIds: [...ids] })
  }
  return targets
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
  for (const target of targets) {
    const userIds = await getUserIdsWithPermissionForWorksite("prevention:pdtp:manage", target.worksiteId)
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
