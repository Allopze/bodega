import { and, eq, inArray, isNull, or } from "drizzle-orm"
import { db } from "@/db"
import {
  pdtpActivities,
  pdtpActivityExecutionConfigs,
  pdtpActivityReminderRules,
  pdtpReminderDeliveries,
  pdtpScheduledInstances,
  worksites,
} from "@/db/schema"
import { nanoid } from "@/lib/id"
import { logger } from "@/lib/logger"
import { createNotifications, getUserIdsWithPermissionForWorksite } from "@/lib/services/notifications"
import { getPdtpExecutionConnector } from "./connectors"

export type PdtpReminderOffsetUnit = "hour" | "day"

/** Momento civil de referencia para una fecha de programa (mediodía UTC). */
export function pdtpReminderTargetAt(
  scheduledFor: string,
  offsetValue: number,
  offsetUnit: PdtpReminderOffsetUnit,
): string {
  const base = new Date(`${scheduledFor}T12:00:00.000Z`)
  if (Number.isNaN(base.getTime())) throw new Error("La fecha programada no es válida.")
  const milliseconds = offsetValue * (offsetUnit === "hour" ? 3_600_000 : 86_400_000)
  return new Date(base.getTime() + milliseconds).toISOString()
}

export type PdtpScheduledReminderResult = {
  candidates: number
  notificationsCreated: number
  notifiedUsers: number
  failed: number
}

/** Entrega recordatorios configurados sin duplicar por instancia/regla/usuario. */
export async function runPdtpScheduledInstanceReminders(asOf = new Date()): Promise<PdtpScheduledReminderResult> {
  const rows = await db.select({
    instance: pdtpScheduledInstances,
    activity: pdtpActivities,
    rule: pdtpActivityReminderRules,
    config: pdtpActivityExecutionConfigs,
    worksiteName: worksites.name,
  }).from(pdtpScheduledInstances)
    .innerJoin(pdtpActivities, eq(pdtpActivities.id, pdtpScheduledInstances.activityId))
    .innerJoin(pdtpActivityReminderRules, and(
      eq(pdtpActivityReminderRules.activityId, pdtpScheduledInstances.activityId),
      eq(pdtpActivityReminderRules.isActive, true),
    ))
    .leftJoin(pdtpActivityExecutionConfigs, eq(pdtpActivityExecutionConfigs.activityId, pdtpScheduledInstances.activityId))
    .innerJoin(worksites, eq(worksites.id, pdtpScheduledInstances.worksiteId))
    .where(inArray(pdtpScheduledInstances.status, ["pending", "in_progress", "submitted"]))

  const notifiedUserIds = new Set<string>()
  let notificationsCreated = 0
  let failed = 0

  for (const row of rows) {
    const targetAt = pdtpReminderTargetAt(row.instance.scheduledFor, row.rule.offsetValue, row.rule.offsetUnit as PdtpReminderOffsetUnit)
    if (asOf.getTime() < new Date(targetAt).getTime()) continue
    const connector = getPdtpExecutionConnector(row.config?.destinationConnectorKey)
    if (!connector) continue

    const fallbackRecipients = async () => getUserIdsWithPermissionForWorksite(connector.executePermission, row.instance.worksiteId)
    const recipientIds = row.rule.recipientKind === "user" && row.rule.recipientUserId
      ? [row.rule.recipientUserId]
      : row.instance.responsibleUserId
        ? [row.instance.responsibleUserId]
        : await fallbackRecipients()

    for (const recipientUserId of recipientIds) {
      let [delivery] = await db.insert(pdtpReminderDeliveries).values({
        id: `pdtp-reminder-delivery-${nanoid()}`,
        scheduledInstanceId: row.instance.id,
        reminderRuleId: row.rule.id,
        recipientUserId,
        status: "sent",
        deliveredAt: null,
        createdAt: asOf.toISOString(),
      }).onConflictDoNothing({
        target: [pdtpReminderDeliveries.scheduledInstanceId, pdtpReminderDeliveries.reminderRuleId, pdtpReminderDeliveries.recipientUserId],
      }).returning()
      if (!delivery) {
        // Si el proceso cayó después de reservar la deduplicación pero antes
        // de crear la notificación, `deliveredAt` quedó nulo. Se reintenta ese
        // caso igual que un fallo explícito; createNotifications protege el
        // envío concurrente con su propia clave única.
        const [failedDelivery] = await db.select().from(pdtpReminderDeliveries).where(and(
          eq(pdtpReminderDeliveries.scheduledInstanceId, row.instance.id),
          eq(pdtpReminderDeliveries.reminderRuleId, row.rule.id),
          eq(pdtpReminderDeliveries.recipientUserId, recipientUserId),
          or(
            eq(pdtpReminderDeliveries.status, "failed"),
            isNull(pdtpReminderDeliveries.deliveredAt),
          ),
        )).limit(1)
        if (!failedDelivery) continue
        delivery = failedDelivery
      }

      try {
        await createNotifications([recipientUserId], {
          type: "system_alert",
          title: `Actividad preventiva próxima: ${row.activity.activity}`,
          body: `La actividad programada para ${row.instance.scheduledFor} en ${row.worksiteName} requiere atención en ${connector.label}.`,
          entityType: "pdtp_scheduled_instance",
          entityId: row.instance.id,
          entityHref: connector.buildStartHref({
            id: row.instance.id,
            programId: row.instance.programId,
            activityId: row.instance.activityId,
            worksiteId: row.instance.worksiteId,
          }),
          dedupeKey: `pdtp-scheduled-reminder:${row.instance.id}:${row.rule.id}:${recipientUserId}`,
        })
        await db.update(pdtpReminderDeliveries).set({ status: "sent", deliveredAt: asOf.toISOString(), errorMessage: null }).where(eq(pdtpReminderDeliveries.id, delivery.id))
        notificationsCreated += 1
        notifiedUserIds.add(recipientUserId)
      } catch (error) {
        failed += 1
        await db.update(pdtpReminderDeliveries).set({ status: "failed", errorMessage: error instanceof Error ? error.message.slice(0, 500) : "Error desconocido" }).where(eq(pdtpReminderDeliveries.id, delivery.id))
        logger.error({ error, scheduledInstanceId: row.instance.id, recipientUserId }, "[pdtp-reminders] No se pudo entregar un recordatorio configurado.")
      }
    }
  }

  return { candidates: rows.length, notificationsCreated, notifiedUsers: notifiedUserIds.size, failed }
}
