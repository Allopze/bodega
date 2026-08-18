import { and, eq, inArray, isNotNull } from "drizzle-orm"
import { todayInChile } from "@/lib/utils"
import { logger } from "@/lib/logger"
import { db } from "@/db"
import {
  preventionIncidentNotifications,
  preventionIncidents,
} from "@/db/schema"
import { markOverdueIncidentNotifications } from "@/lib/services/prevention-incidents"
import {
  createNotifications,
  getUserIdsWithPermissionForWorksite,
} from "@/lib/services/notifications"

export interface IncidentReminderResult {
  upcomingLanes: number
  overdueLanes: number
  fatalImmediateLanes: number
  notifiedUsers: number
  /** Entidades omitidas por error, para que una corrida degradada sea visible. */
  errors: number
}

export async function runPreventionIncidentReminders(now = new Date()): Promise<IncidentReminderResult> {
  // Contador de entidades omitidas por error: viaja en el JSON del cron para
  // que una corrida degradada sea visible en vez de parecer exitosa.
  let errors = 0
  await markOverdueIncidentNotifications({ now })
  const lanes = await db.select({
    lane: preventionIncidentNotifications,
    incidentCode: preventionIncidents.code,
    worksiteId: preventionIncidents.worksiteId,
    incidentStatus: preventionIncidents.status,
    fatalOrSerious: preventionIncidents.isFatalOrSerious,
  }).from(preventionIncidentNotifications)
    .innerJoin(preventionIncidents, and(
      inArray(preventionIncidentNotifications.status, ["pending", "overdue"]),
      isNotNull(preventionIncidentNotifications.deadlineAt),
      eq(preventionIncidentNotifications.incidentId, preventionIncidents.id),
    ))

  // Pre-resolver permission lookups per worksite
  const uniqueWorksiteIds = [...new Set(lanes.map((l) => l.worksiteId))]
  const notifyByWs = new Map<string, string[]>()
  const closeByWs = new Map<string, string[]>()
  await Promise.all(uniqueWorksiteIds.map(async (wsId) => {
    const [notifiers, closers] = await Promise.all([
      getUserIdsWithPermissionForWorksite("prevention:incidents:notify", wsId),
      getUserIdsWithPermissionForWorksite("prevention:incidents:close", wsId),
    ])
    notifyByWs.set(wsId, notifiers)
    closeByWs.set(wsId, closers)
  }))

  const notified = new Set<string>()
  let upcomingLanes = 0
  let overdueLanes = 0
  let fatalImmediateLanes = 0
  const nowMs = now.getTime()
  // Día civil CHILENO, no UTC: con `toISOString()` una corrida a las 20:30 de
  // Chile grababa la clave con la fecha del día siguiente, y la corrida de la
  // mañana quedaba deduplicada — el carril DT/SEREMI atrasado perdía su
  // recordatorio. Es el peor sitio posible para un corrimiento de día.
  const day = todayInChile(now)

  for (const { lane, incidentCode, worksiteId, fatalOrSerious } of lanes) {
    try {
      if (!lane.deadlineAt) continue
      const remainingMs = new Date(lane.deadlineAt).getTime() - nowMs
      const isImmediateFatalLane = fatalOrSerious && ["fatal_dt", "fatal_seremi"].includes(lane.notificationType)
      const isUpcoming = lane.status === "pending" && remainingMs > 0 && remainingMs <= 6 * 60 * 60 * 1000
      const isOverdue = lane.status === "overdue" || remainingMs <= 0
      if (!isImmediateFatalLane && !isUpcoming && !isOverdue) continue

      const owners = lane.responsibleUserId ? [lane.responsibleUserId] : []
      const managers = notifyByWs.get(worksiteId) ?? []
      const recipients = [...new Set([...owners, ...managers])]
      recipients.forEach((id) => notified.add(id))
      if (isImmediateFatalLane) fatalImmediateLanes++
      else if (isOverdue) overdueLanes++
      else upcomingLanes++

      const urgency = isImmediateFatalLane
        ? "Notificación fatal/grave inmediata"
        : isOverdue
          ? "Notificación legal atrasada"
          : "Notificación legal próxima a vencer"
      await createNotifications(recipients, {
        type: "system_alert",
        title: `${urgency}: ${incidentCode}`,
        body: `${lane.notificationType.toUpperCase()} · plazo ${lane.deadlineAt}. El sistema controla la presentación y evidencia; no declara envío automático a la autoridad.`,
        entityType: "prevention_incident",
        entityId: lane.incidentId,
        entityHref: `/prevencion/incidentes/${lane.incidentId}`,
        dedupeKey: `incident-notification:${lane.id}:${isImmediateFatalLane ? "immediate" : isOverdue ? `overdue:${day}` : "six-hours"}`,
      })

      if (isOverdue || isImmediateFatalLane) {
        const escalation = closeByWs.get(worksiteId) ?? []
        escalation.forEach((id) => notified.add(id))
        await createNotifications(escalation, {
          type: "system_alert",
          title: `Escalamiento ${lane.notificationType.toUpperCase()}: ${incidentCode}`,
          body: isImmediateFatalLane
            ? "Evento clasificado fatal/grave: revisar medidas inmediatas, DT/SEREMI y suspensión antes de cualquier reinicio."
            : `El plazo ${lane.deadlineAt} fue superado y el carril sigue sin evidencia de presentación.`,
          entityType: "prevention_incident",
          entityId: lane.incidentId,
          entityHref: `/prevencion/incidentes/${lane.incidentId}`,
          dedupeKey: `incident-notification-escalation:${lane.id}:${isImmediateFatalLane ? "immediate" : day}`,
        })
      }
    } catch (error) {
      errors++
      logger.error("[prevention-incident-reminders] entidad omitida por error", error)
    }
  }

  return { upcomingLanes, overdueLanes, fatalImmediateLanes, notifiedUsers: notified.size, errors }
}
