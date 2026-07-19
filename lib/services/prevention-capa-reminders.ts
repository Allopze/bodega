import { db } from "@/db"
import { preventionCapaActions } from "@/db/schema"
import { notInArray } from "drizzle-orm"
import {
  createNotifications,
  getUserIdsWithPermissionForWorksite,
} from "@/lib/services/notifications"

export interface CapaReminderResult {
  assignedActions: number
  overdueActions: number
  pendingVerificationActions: number
  notifiedUsers: number
}

/**
 * Job diario idempotente para vencimientos y acciones esperando verificación.
 * Los dedupe keys cambian por plazo/versión/nivel, por lo que una reprogramación
 * o reapertura genera una nueva alerta sin duplicar la misma condición.
 */
export async function runPreventionCapaReminders(): Promise<CapaReminderResult> {
  const actions = await db.select().from(preventionCapaActions)
    .where(notInArray(preventionCapaActions.status, ["closed", "cancelled"]))
  const today = new Date().toISOString().slice(0, 10)
  const notified = new Set<string>()
  let assignedActions = 0
  let overdueActions = 0
  let pendingVerificationActions = 0

  for (const action of actions) {
    const href = `/prevencion/capa/${action.id}`
    if (action.responsibleUserId) {
      assignedActions++
      notified.add(action.responsibleUserId)
      await createNotifications([action.responsibleUserId], {
        type: "system_alert",
        title: `CAPA asignada: ${action.code}`,
        body: `Tienes una acción ${action.priority} con plazo ${action.targetDate}. Revisa la medida, evidencia requerida y seguimiento.`,
        entityType: "prevention_capa",
        entityId: action.id,
        entityHref: href,
        dedupeKey: `capa-assigned:${action.id}:${action.responsibleUserId}:${action.targetDate}`,
      })
    }

    if (action.status === "pending_verification") {
      pendingVerificationActions++
      const verifiers = await getUserIdsWithPermissionForWorksite("prevention:capa:verify", action.worksiteId)
      verifiers.forEach((id) => notified.add(id))
      await createNotifications(verifiers, {
        type: "system_alert",
        title: `CAPA por verificar: ${action.code}`,
        body: `La implementación declarada requiere revisión de evidencia y eficacia antes del cierre.`,
        entityType: "prevention_capa",
        entityId: action.id,
        entityHref: href,
        dedupeKey: `capa-pending-verification:${action.id}:v${action.version}`,
      })
    }

    if (action.targetDate >= today || ["verified", "closed", "cancelled"].includes(action.status)) continue
    overdueActions++
    const overdueDays = Math.max(1, Math.floor((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${action.targetDate}T00:00:00Z`)) / 86_400_000))
    const managers = await getUserIdsWithPermissionForWorksite("prevention:capa:manage", action.worksiteId)
    const owners = action.responsibleUserId ? [action.responsibleUserId] : []
    const firstLevel = [...new Set([...owners, ...managers])]
    firstLevel.forEach((id) => notified.add(id))
    await createNotifications(firstLevel, {
      type: "system_alert",
      title: `CAPA vencida: ${action.code}`,
      body: `La acción venció el ${action.targetDate} (hace ${overdueDays} día${overdueDays === 1 ? "" : "s"}) y sigue ${action.status}.`,
      entityType: "prevention_capa",
      entityId: action.id,
      entityHref: href,
      dedupeKey: `capa-overdue:${action.id}:${action.targetDate}:owner`,
    })

    if (overdueDays >= 3 || action.priority === "high" || action.priority === "critical") {
      const escalation = await getUserIdsWithPermissionForWorksite("prevention:capa:close", action.worksiteId)
      escalation.forEach((id) => notified.add(id))
      await createNotifications(escalation, {
        type: "system_alert",
        title: `Escalamiento CAPA: ${action.code}`,
        body: `Acción ${action.priority} vencida sin cierre. Jefatura debe revisar responsable, plazo y control compensatorio.`,
        entityType: "prevention_capa",
        entityId: action.id,
        entityHref: href,
        dedupeKey: `capa-overdue:${action.id}:${action.targetDate}:escalation`,
      })
    }
  }

  return { assignedActions, overdueActions, pendingVerificationActions, notifiedUsers: notified.size }
}
