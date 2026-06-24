/**
 * lib/services/sst-alerts.ts
 * Cron service: detecta evaluaciones semanales del conductor líder
 * vencidas (+3 días desde desbloqueo sin completar) y envía alertas.
 *
 * Invocar desde: GET /api/cron/sst-weekly-alerts
 */

import { eq, and, lte, isNull, inArray } from 'drizzle-orm'
import { db } from '@/db'
import { sstWeeklyEvaluations, sstEvaluations } from '@/db/schema/sst'
import { worksites } from '@/db/schema/worksites'
import { userRoles, worksiteUsers } from '@/db/schema'
import { notifyManyUser, getUserIdsWithPermission } from '@/lib/services/notifications'
import { logger } from '@/lib/logger'

/**
 * Revisa todas las semanas pendientes cuya fecha de desbloqueo + 3 días ≤ hoy
 * y que aún no han recibido una alerta (alertSentAt IS NULL).
 *
 * Por cada semana vencida:
 * 1. Obtiene la faena de la evaluación
 * 2. Notifica a prevencionista_faena y admin_contrato de esa faena
 * 3. Notifica a la jefa de dpto de prevención (rol global 'prevencionista')
 * 4. Marca alertSentAt = now()
 */
export async function checkOverdueWeeklyAlerts(): Promise<{ processed: number; errors: number }> {
  const today = new Date()
  // Threshold date: 3 days ago
  const threshold = new Date(today)
  threshold.setDate(threshold.getDate() - 3)
  const thresholdStr = threshold.toISOString().slice(0, 10)

  // Find overdue pending weeks that haven't been alerted yet
  const overdueWeeks = await db
    .select({
      id:              sstWeeklyEvaluations.id,
      evaluationId:    sstWeeklyEvaluations.evaluationId,
      semana:          sstWeeklyEvaluations.semana,
      fechaDesbloqueo: sstWeeklyEvaluations.fechaDesbloqueo,
    })
    .from(sstWeeklyEvaluations)
    .where(
      and(
        eq(sstWeeklyEvaluations.estado, 'pendiente'),
        isNull(sstWeeklyEvaluations.alertSentAt),
        lte(sstWeeklyEvaluations.fechaDesbloqueo, thresholdStr),
      )
    )

  if (overdueWeeks.length === 0) {
    logger.info('[sst-alerts] No overdue weekly evaluations found')
    return { processed: 0, errors: 0 }
  }

  logger.info(`[sst-alerts] Processing ${overdueWeeks.length} overdue weekly evaluations`)

  // Get jefa de dpto prevención user IDs (global role 'prevencionista' — has sst:manage)
  const jefaPrevUserIds = await getUserIdsWithPermission('sst:manage')

  let processed = 0
  let errors = 0

  for (const week of overdueWeeks) {
    try {
      // Get evaluation → worksite info
      const [evalRow] = await db
        .select({
          worksiteId:   sstEvaluations.worksiteId,
          workerId:     sstEvaluations.workerId,
          worksiteName: worksites.name,
        })
        .from(sstEvaluations)
        .leftJoin(worksites, eq(sstEvaluations.worksiteId, worksites.id))
        .where(eq(sstEvaluations.id, week.evaluationId))
        .limit(1)

      if (!evalRow) {
        logger.warn(`[sst-alerts] Evaluation ${week.evaluationId} not found, skipping`)
        continue
      }

      // Get prevencionista_faena + admin_contrato users for this worksite
      const scopedUserIds = await getUsersWithSstInWorksite(evalRow.worksiteId)

      // Merge all target user IDs (deduplicated)
      const allTargetIds = [...new Set([...scopedUserIds, ...jefaPrevUserIds])]

      if (allTargetIds.length > 0) {
        await notifyManyUser(allTargetIds, {
          type:       'system_alert',
          title:      `⚠️ Semana ${week.semana} de acompañamiento sin evaluar`,
          body:       `El conductor líder lleva más de 3 días sin completar la evaluación de la Semana ${week.semana} en la faena "${evalRow.worksiteName ?? 'desconocida'}". Por favor verifica el estado.`,
          entityType: 'sst_evaluation',
          entityId:   week.evaluationId,
          entityHref: `/prevencion/${week.evaluationId}`,
        })
      }

      // Mark alert as sent
      await db
        .update(sstWeeklyEvaluations)
        .set({ alertSentAt: new Date().toISOString() })
        .where(eq(sstWeeklyEvaluations.id, week.id))

      processed++
    } catch (err) {
      logger.error(`[sst-alerts] Error processing week ${week.id}`, err)
      errors++
    }
  }

  logger.info(`[sst-alerts] Done: processed=${processed}, errors=${errors}`)
  return { processed, errors }
}

/**
 * Devuelve los user IDs con sst:view/sst:create scoped al worksite dado.
 * Cubre: prevencionista_faena (rol-prev-faena), admin_contrato (rol-admin-contrato)
 * y la jefa de prevención global (rol-prev).
 */
async function getUsersWithSstInWorksite(worksiteId: string): Promise<string[]> {
  // Scoped SST roles: prevencionista_faena and admin_contrato
  const SST_SCOPED_ROLE_IDS = ['rol-prev-faena', 'rol-admin-contrato']

  const rows = await db
    .select({ userId: userRoles.userId })
    .from(userRoles)
    .innerJoin(worksiteUsers, eq(userRoles.userId, worksiteUsers.userId))
    .where(
      and(
        inArray(userRoles.roleId, SST_SCOPED_ROLE_IDS),
        eq(worksiteUsers.worksiteId, worksiteId),
      )
    )

  return [...new Set(rows.map(r => r.userId))]
}
