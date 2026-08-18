import { and, eq, sql } from "drizzle-orm"
import { logger } from "@/lib/logger"
import { db } from "@/db"
import {
  preventionCompetencyRequirements,
  preventionTrainingCourses,
  preventionWorkerCompetencies,
  users,
  workers,
} from "@/db/schema"
import {
  createNotifications,
  getUserIdsWithPermissionForWorksite,
} from "@/lib/services/notifications"
import { expireLapsedCompetencies } from "@/lib/services/prevention-training"
import { todayInChile } from "@/lib/utils"

export interface TrainingReminderResult {
  expiredCompetencies: number
  expiringSoon: number
  blockingGaps: number
  notifiedUsers: number
  /** Entidades omitidas por error, para que una corrida degradada sea visible. */
  errors: number
}

/**
 * Ventana de aviso previo al vencimiento. 60 días alcanzan para programar una
 * sesión de 8 horas y convocar dotación sin que la competencia caduque.
 */
const EXPIRY_WARNING_DAYS = 60

function addDays(date: string, days: number) {
  const value = new Date(`${date}T12:00:00.000Z`)
  value.setUTCDate(value.getUTCDate() + days)
  return value.toISOString().slice(0, 10)
}

/**
 * Job diario idempotente de competencias. Primero marca vencidas las que ya
 * caducaron, luego avisa las próximas a vencer y finalmente escala las brechas
 * bloqueantes. Los dedupe keys incluyen la fecha de vencimiento, de modo que
 * renovar la competencia genera una alerta nueva en vez de silenciarse.
 */
export async function runPreventionTrainingReminders(): Promise<TrainingReminderResult> {
  // Contador de entidades omitidas por error: viaja en el JSON del cron para
  // que una corrida degradada sea visible en vez de parecer exitosa.
  let errors = 0
  const today = todayInChile()
  const horizon = addDays(today, EXPIRY_WARNING_DAYS)
  const notified = new Set<string>()

  const { expired } = await expireLapsedCompetencies()

  // Una faena se repite en muchas filas: resolver sus gestores una sola vez
  // evita un N+1 de permisos dentro de los bucles de notificación.
  const managersByWorksite = new Map<string, string[]>()
  async function managersFor(worksiteId: string) {
    const cached = managersByWorksite.get(worksiteId)
    if (cached) return cached
    const resolved = await getUserIdsWithPermissionForWorksite("prevention:training:manage", worksiteId)
    managersByWorksite.set(worksiteId, resolved)
    return resolved
  }

  const expiring = await db.select({
    competencyId: preventionWorkerCompetencies.id,
    expiresAt: preventionWorkerCompetencies.expiresAt,
    workerId: workers.id,
    firstName: workers.firstName,
    lastName: workers.lastName,
    worksiteId: workers.worksiteId,
    courseName: preventionTrainingCourses.name,
    courseId: preventionTrainingCourses.id,
    workerUserId: users.id,
  })
    .from(preventionWorkerCompetencies)
    .innerJoin(workers, eq(preventionWorkerCompetencies.workerId, workers.id))
    .innerJoin(preventionTrainingCourses, eq(preventionWorkerCompetencies.courseId, preventionTrainingCourses.id))
    .leftJoin(users, eq(users.workerId, workers.id))
    .where(and(
      eq(preventionWorkerCompetencies.status, "valid"),
      eq(workers.isActive, true),
      sql`${preventionWorkerCompetencies.expiresAt} IS NOT NULL`,
      sql`${preventionWorkerCompetencies.expiresAt} <= ${horizon}`,
      sql`${preventionWorkerCompetencies.expiresAt} >= ${today}`,
    ))

  for (const row of expiring) {
    try {
      const managers = await managersFor(row.worksiteId)
      const audience = [...new Set([...managers, ...(row.workerUserId ? [row.workerUserId] : [])])]
      audience.forEach((id) => notified.add(id))
      await createNotifications(audience, {
        type: "system_alert",
        title: `Competencia por vencer: ${row.courseName}`,
        body: `${row.firstName} ${row.lastName} pierde la habilitación el ${row.expiresAt}. Programa la reinducción antes de esa fecha.`,
        entityType: "prevention_training",
        entityId: row.competencyId,
        entityHref: `/prevencion/capacitacion/competencias?workerId=${row.workerId}`,
        dedupeKey: `training-expiring:${row.competencyId}:${row.expiresAt}`,
      })
    } catch (error) {
      errors++
      logger.error("[prevention-training-reminders] entidad omitida por error", error)
    }
  }

  // Brechas bloqueantes: alguien exigido por un requisito activo sin ninguna
  // competencia vigente. Se calcula en SQL para no traer toda la dotación.
  const blocking = await db.select({
    workerId: workers.id,
    firstName: workers.firstName,
    lastName: workers.lastName,
    position: workers.position,
    worksiteId: workers.worksiteId,
    courseId: preventionTrainingCourses.id,
    courseName: preventionTrainingCourses.name,
    requirementId: preventionCompetencyRequirements.id,
  })
    .from(preventionCompetencyRequirements)
    .innerJoin(preventionTrainingCourses, eq(preventionCompetencyRequirements.courseId, preventionTrainingCourses.id))
    .innerJoin(workers, sql`
      ${workers.isActive} = true AND (
        ${preventionCompetencyRequirements.scopeType} = 'global'
        OR (${preventionCompetencyRequirements.scopeType} = 'worksite' AND ${preventionCompetencyRequirements.worksiteId} = ${workers.worksiteId})
        OR (${preventionCompetencyRequirements.scopeType} = 'position' AND lower(btrim(${preventionCompetencyRequirements.scopeValue})) = lower(btrim(${workers.position})))
      )
    `)
    .where(and(
      eq(preventionCompetencyRequirements.isActive, true),
      eq(preventionCompetencyRequirements.enforcement, "blocking"),
      eq(preventionTrainingCourses.isActive, true),
      sql`NOT EXISTS (
        SELECT 1 FROM prevention_worker_competencies c
        WHERE c.worker_id = ${workers.id}
          AND c.course_id = ${preventionTrainingCourses.id}
          AND c.status = 'valid'
          AND (c.expires_at IS NULL OR c.expires_at >= ${today})
      )`,
    ))

  for (const gap of blocking) {
    try {
      const managers = await managersFor(gap.worksiteId)
      managers.forEach((id) => notified.add(id))
      await createNotifications(managers, {
        type: "system_alert",
        title: `Brecha bloqueante de competencia: ${gap.courseName}`,
        body: `${gap.firstName} ${gap.lastName} (${gap.position ?? "sin cargo"}) no está habilitado y el requisito es bloqueante. No debe asignarse a la tarea hasta regularizar.`,
        entityType: "prevention_training",
        entityId: gap.requirementId,
        entityHref: "/prevencion/capacitacion/brechas",
        dedupeKey: `training-blocking-gap:${gap.workerId}:${gap.courseId}:${today}`,
      })
    } catch (error) {
      errors++
      logger.error("[prevention-training-reminders] entidad omitida por error", error)
    }
  }

  return {
    expiredCompetencies: expired,
    expiringSoon: expiring.length,
    blockingGaps: blocking.length,
    notifiedUsers: notified.size,
    errors
  }
}
