import { db } from "@/db"
import { logger } from "@/lib/logger"
import { preventionCapaActions } from "@/db/schema"
import { notInArray } from "drizzle-orm"
import {
  createNotifications,
  getUserIdsWithPermissionForWorksite,
} from "@/lib/services/notifications"
import { todayInChile } from "@/lib/utils"

export interface CapaReminderResult {
  assignedActions: number
  overdueActions: number
  pendingVerificationActions: number
  notifiedUsers: number
  /** Entidades omitidas por error, para que una corrida degradada sea visible. */
  errors: number
}

/**
 * Job diario idempotente para vencimientos y acciones esperando verificación.
 * Los dedupe keys cambian por plazo/versión/nivel, por lo que una reprogramación
 * o reapertura genera una nueva alerta sin duplicar la misma condición.
 */
/** Tope por corrida: acota memoria y latencia sin perder acciones (se retoman en la siguiente). */
const MAX_ACTIONS_PER_RUN = 2000

export async function runPreventionCapaReminders(): Promise<CapaReminderResult> {
  // Contador de entidades omitidas por error: viaja en el JSON del cron para
  // que una corrida degradada sea visible en vez de parecer exitosa.
  let errors = 0
  // Cota explícita y proyección: `select()` sin columnas traía la fila entera
  // —incluidos los textos largos de hallazgo y acción— de TODAS las CAPA
  // abiertas. El tope evita que una corrida crezca sin límite; si se alcanza,
  // el resto entra en la corrida siguiente en vez de tumbar el job.
  const actions = await db.select({
    id: preventionCapaActions.id,
    code: preventionCapaActions.code,
    status: preventionCapaActions.status,
    worksiteId: preventionCapaActions.worksiteId,
    targetDate: preventionCapaActions.targetDate,
    responsibleUserId: preventionCapaActions.responsibleUserId,
    priority: preventionCapaActions.priority,
    version: preventionCapaActions.version,
  }).from(preventionCapaActions)
    .where(notInArray(preventionCapaActions.status, ["closed", "cancelled"]))
    .orderBy(preventionCapaActions.targetDate)
    .limit(MAX_ACTIONS_PER_RUN)
  // Día civil chileno: `today` decide si la acción está vencida y cuántos días
  // lleva. En UTC, entre las 20:00 y medianoche una acción que vence hoy se
  // notificaba como atrasada.
  const today = todayInChile()
  const notified = new Set<string>()
  let assignedActions = 0
  let overdueActions = 0
  let pendingVerificationActions = 0

  // Pre-resolver permission lookups por faena para evitar N+1
  const uniqueWorksiteIds = [...new Set(actions.map((a) => a.worksiteId))]
  const verifyByWs = new Map<string, string[]>()
  const closeByWs = new Map<string, string[]>()
  const manageByWs = new Map<string, string[]>()
  await Promise.all(uniqueWorksiteIds.map(async (wsId) => {
    const [verifiers, closers, managers] = await Promise.all([
      getUserIdsWithPermissionForWorksite("prevention:capa:verify", wsId),
      getUserIdsWithPermissionForWorksite("prevention:capa:close", wsId),
      getUserIdsWithPermissionForWorksite("prevention:capa:manage", wsId),
    ])
    verifyByWs.set(wsId, verifiers)
    closeByWs.set(wsId, closers)
    manageByWs.set(wsId, managers)
  }))

  for (const action of actions) {
    try {
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
        const verifiers = verifyByWs.get(action.worksiteId) ?? []
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
      const managers = manageByWs.get(action.worksiteId) ?? []
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
        const escalation = closeByWs.get(action.worksiteId) ?? []
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
    } catch (error) {
      errors++
      logger.error("[prevention-capa-reminders] entidad omitida por error", error)
    }
  }

  return { assignedActions, overdueActions, pendingVerificationActions, notifiedUsers: notified.size, errors }
}
