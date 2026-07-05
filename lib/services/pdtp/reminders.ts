/**
 * lib/services/pdtp/reminders.ts
 *
 * Servicio del motor de recordatorios semanales PDTP. Detecta, para el
 * programa activo y el período actual, faenas con actividades planeadas
 * sin ejecución registrada, y arma la lista de destinatarios por permiso
 * y faena. El envío real lo hace el route /api/cron/pdtp-weekly-reminders
 * (calca de sst-weekly-alerts).
 */

import { and, desc, eq, inArray } from "drizzle-orm"
import { db } from "@/db"
import { pdtpActivities, pdtpActivitySchedule, pdtpExecutions, pdtpPrograms, worksites } from "@/db/schema"
import { currentPdtpPeriod, type PdtpPeriod } from "./period"
import { logger } from "@/lib/logger"
import { createNotifications, getUserIdsWithPermissionForWorksite } from "@/lib/services/notifications"

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
  const [program] = await db
    .select()
    .from(pdtpPrograms)
    .where(eq(pdtpPrograms.year, period.year))
    .orderBy(desc(pdtpPrograms.version))
    .limit(1)
  if (!program || program.status !== "active") return []

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
  const [program] = await db
    .select()
    .from(pdtpPrograms)
    .where(eq(pdtpPrograms.year, period.year))
    .orderBy(desc(pdtpPrograms.version))
    .limit(1)
  if (!program) {
    logger.info("[pdtp/reminders] no program found, skipping")
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
