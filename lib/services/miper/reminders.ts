/**
 * Barrido diario del Programa de Trabajo MIPER (§9.1 y §7.4, F3).
 *
 * Lo que el flujo **no puede ver en línea**: una ocurrencia cuya fecha pasó sin
 * registro, y una ocurrencia registrada como «No se hizo». Ambas se descubren
 * mirando el calendario, así que viven en un cron
 * (`app/api/cron/prevention-miper-daily-sweep`) y no en un servicio de guardado.
 *
 * Sólo lee y notifica: **no abre transacción**. Los destinatarios los resuelve
 * el thunk de `notifications.ts` (con `getUserIdsWithPermissionForWorksite`,
 * que usa la conexión global `db`), y el aviso se deduplica por ocurrencia con
 * `notifications_user_dedupe_unique`, así que volver a correr el barrido —o
 * correrlo dos veces el mismo día— no duplica nada.
 */
import { and, eq, lt } from "drizzle-orm"
import { db } from "@/db"
import { preventionRiskProgramActions, preventionRiskProgramOccurrences, preventionRiskPrograms } from "@/db/schema"
import { todayInChile } from "@/lib/utils"
import { logger } from "@/lib/logger"
import { cachedMiperRecipients, planMiperOccurrenceNotDone, planMiperOccurrenceOverdue } from "./notifications"

export type MiperOccurrenceSweepResult = {
  /** Ocurrencias pendientes con la fecha ya pasada. */
  overdue: number
  /** Ocurrencias vencidas con al menos un aviso NUEVO (una por ocurrencia). */
  overdueNotified: number
  /** Ocurrencias registradas como «No se hizo». */
  notDone: number
  /** Ocurrencias «No se hizo» con al menos un aviso NUEVO. */
  notDoneNotified: number
  notifiedUsers: number
}

const occurrenceColumns = {
  occurrenceId: preventionRiskProgramOccurrences.id,
  dueOn: preventionRiskProgramOccurrences.dueOn,
  actionNumber: preventionRiskProgramActions.actionNumber,
  actionDescription: preventionRiskProgramActions.description,
  responsibleUserId: preventionRiskProgramActions.responsibleUserId,
  worksiteId: preventionRiskPrograms.worksiteId,
  matrixId: preventionRiskPrograms.matrixId,
}

/**
 * Recorre las ocurrencias vencidas y las «No se hizo» del programa vigente y
 * avisa lo que nadie registró.
 *
 * `overdueNotified` cuenta **avisos**, no destinatarios: una ocurrencia vencida
 * es un aviso, aunque le llegue al responsable y al prevencionista de la faena.
 * Sólo cuenta si nació al menos una notificación nueva, que es lo que hace
 * idempotente la segunda corrida del día (devuelve 0).
 */
export async function runMiperOccurrenceSweep(asOf: Date = new Date()): Promise<MiperOccurrenceSweepResult> {
  const today = todayInChile(asOf)
  const recipients = cachedMiperRecipients()

  const [overdueRows, notDoneRows] = await Promise.all([
    db.select(occurrenceColumns)
      .from(preventionRiskProgramOccurrences)
      .innerJoin(preventionRiskProgramActions, eq(preventionRiskProgramActions.id, preventionRiskProgramOccurrences.actionId))
      .innerJoin(preventionRiskPrograms, eq(preventionRiskPrograms.id, preventionRiskProgramActions.programId))
      .where(and(
        eq(preventionRiskProgramOccurrences.outcome, "pending"),
        lt(preventionRiskProgramOccurrences.dueOn, today),
      )),
    db.select(occurrenceColumns)
      .from(preventionRiskProgramOccurrences)
      .innerJoin(preventionRiskProgramActions, eq(preventionRiskProgramActions.id, preventionRiskProgramOccurrences.actionId))
      .innerJoin(preventionRiskPrograms, eq(preventionRiskPrograms.id, preventionRiskProgramActions.programId))
      .where(eq(preventionRiskProgramOccurrences.outcome, "not_done")),
  ])

  const notifiedUsers = new Set<string>()
  let overdueNotified = 0
  let notDoneNotified = 0

  for (const row of overdueRows) {
    try {
      const fresh = await planMiperOccurrenceOverdue({
        occurrenceId: row.occurrenceId,
        matrixId: row.matrixId,
        worksiteId: row.worksiteId,
        actionNumber: row.actionNumber,
        actionDescription: row.actionDescription,
        dueOn: row.dueOn,
        responsibleUserId: row.responsibleUserId,
        recipients,
      })()
      if (fresh.length > 0) overdueNotified += 1
      for (const userId of fresh) notifiedUsers.add(userId)
    } catch (err) {
      /* Una ocurrencia que falla no puede silenciar el resto del barrido. */
      logger.error({ err, occurrenceId: row.occurrenceId }, "[miper-reminders] no se pudo avisar la ocurrencia vencida")
    }
  }

  for (const row of notDoneRows) {
    try {
      const fresh = await planMiperOccurrenceNotDone({
        occurrenceId: row.occurrenceId,
        matrixId: row.matrixId,
        worksiteId: row.worksiteId,
        actionNumber: row.actionNumber,
        actionDescription: row.actionDescription,
        dueOn: row.dueOn,
        recipients,
      })()
      if (fresh.length > 0) notDoneNotified += 1
      for (const userId of fresh) notifiedUsers.add(userId)
    } catch (err) {
      logger.error({ err, occurrenceId: row.occurrenceId }, "[miper-reminders] no se pudo avisar la ocurrencia «No se hizo»")
    }
  }

  const result = {
    overdue: overdueRows.length,
    overdueNotified,
    notDone: notDoneRows.length,
    notDoneNotified,
    notifiedUsers: notifiedUsers.size,
  }
  logger.info("[miper-reminders] barrido diario completado", result)
  return result
}
