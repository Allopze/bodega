import { and, inArray, lte } from "drizzle-orm"
import { db } from "@/db"
import { feedbackReports } from "@/db/schema/feedback"
import { todayInChile } from "@/lib/utils"
import { createNotifications } from "@/lib/services/notification-create"
import { getUserIdsWithPermission } from "@/lib/services/notification-targeting"

export interface FeedbackSlaReminderResult {
  examined: number
  dueSoon: number
  overdue: number
  deliveries: number
}

/** Sends one daily, idempotent reminder to support managers for open tickets. */
export async function runFeedbackSlaReminders(now = new Date()): Promise<FeedbackSlaReminderResult> {
  const warningAt = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString()
  const [tickets, managerIds] = await Promise.all([
    db.select({
      id: feedbackReports.id,
      titulo: feedbackReports.titulo,
      dueAt: feedbackReports.dueAt,
    }).from(feedbackReports).where(and(
      inArray(feedbackReports.estado, ["abierto", "en_progreso"]),
      lte(feedbackReports.dueAt, warningAt),
    )),
    getUserIdsWithPermission("feedback:manage"),
  ])
  const day = todayInChile(now)

  let dueSoon = 0
  let overdue = 0
  let deliveries = 0
  for (const ticket of tickets) {
    if (!ticket.dueAt || managerIds.length === 0) continue
    const isOverdue = new Date(ticket.dueAt).getTime() < now.getTime()
    const stage = isOverdue ? "overdue" : "due-soon"
    if (isOverdue) overdue += 1
    else dueSoon += 1

    await createNotifications(managerIds, {
      type: isOverdue ? "feedback_sla_overdue" : "feedback_sla_due_soon",
      title: isOverdue ? `Ticket fuera de SLA: ${ticket.titulo}` : `Ticket próximo a vencer: ${ticket.titulo}`,
      body: isOverdue
        ? "El ticket sigue abierto después de su compromiso. Actualiza su estado o documenta el avance."
        : "El ticket vence dentro de las próximas 24 horas.",
      entityType: "feedback_report",
      entityId: ticket.id,
      entityHref: `/soporte/${ticket.id}`,
      dedupeKey: `feedback-sla:${ticket.id}:${stage}:${day}`,
    })
    deliveries += managerIds.length
  }

  return { examined: tickets.length, dueSoon, overdue, deliveries }
}
