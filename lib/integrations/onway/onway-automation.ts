import { and, desc, eq, gte, isNull } from "drizzle-orm"
import { db } from "@/db"
import { fleetGpsAlertRules, fleetGpsAlerts } from "@/db/schema"
import { logger } from "@/lib/logger"
import { createCapaActionWithClient } from "@/lib/services/prevention-capa"
import { getUserIdsWithPermissionForWorksite } from "@/lib/services/notification-targeting"
import { addDaysToPlainDate, todayInChile } from "@/lib/utils"

export function onwayCapaPolicy(priority: string | null) {
  if (priority?.toLowerCase() === "critical") return { priority: "critical" as const, dueInDays: 1 }
  if (priority?.toLowerCase() === "high") return { priority: "high" as const, dueInDays: 7 }
  return { priority: "medium" as const, dueInDays: 14 }
}

export function isActionableOnwayDestination(destination: string): destination is "capa" {
  return destination === "capa"
}

type OnwayAlert = typeof fleetGpsAlerts.$inferSelect & { vehicleId: string; worksiteId: string }
type OnwayRule = typeof fleetGpsAlertRules.$inferSelect

/**
 * La faena de la alerta cambió entre la lectura y la escritura (un traslado la
 * re-estampó): la regla y los elegibles se calcularon para otra faena. Queda
 * `new` y la próxima corrida la evalúa con su faena nueva.
 */
class AlertWorksiteChanged extends Error {}

function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

async function markAlert(alertId: string, rule: OnwayRule, status: "blocked" | "ignored") {
  await db.update(fleetGpsAlerts).set({ ruleId: rule.id, category: rule.category, processingStatus: status, updatedAt: new Date().toISOString() })
    .where(and(eq(fleetGpsAlerts.id, alertId), eq(fleetGpsAlerts.processingStatus, "new")))
}

/**
 * La regla vigente de la faena de la alerta. Esa faena es la del día en que
 * ocurrió (la fija la ingesta y la corrige un traslado), no la actual del
 * equipo: una alerta anterior a un traslado se atiende donde ocurrió.
 */
async function ruleFor(alert: OnwayAlert): Promise<OnwayRule | undefined> {
  const [rule] = await db.select().from(fleetGpsAlertRules).where(and(
    eq(fleetGpsAlertRules.provider, "onway"),
    eq(fleetGpsAlertRules.isEnabled, true),
    eq(fleetGpsAlertRules.alertType, alert.alertType),
    eq(fleetGpsAlertRules.worksiteId, alert.worksiteId),
  )).orderBy(desc(fleetGpsAlertRules.updatedAt)).limit(1)
  return rule
}

async function applyRule(alert: OnwayAlert, rule: OnwayRule): Promise<"actioned" | "blocked" | "ignored" | "skipped"> {
  if (!rule.ownerUserId || !isActionableOnwayDestination(rule.destination)) {
    await markAlert(alert.id, rule, "blocked")
    return "blocked"
  }
  const ownerUserId = rule.ownerUserId
  const eligible = await getUserIdsWithPermissionForWorksite("prevention:capa:manage", alert.worksiteId)
  if (!eligible.includes(ownerUserId)) {
    await markAlert(alert.id, rule, "blocked")
    return "blocked"
  }
  const cooldown = new Date(new Date(alert.occurredAt).getTime() - rule.cooldownMinutes * 60_000).toISOString()
  const [recent] = await db.select({ id: fleetGpsAlerts.id }).from(fleetGpsAlerts).where(and(
    eq(fleetGpsAlerts.vehicleId, alert.vehicleId), eq(fleetGpsAlerts.ruleId, rule.id),
    eq(fleetGpsAlerts.processingStatus, "actioned"), gte(fleetGpsAlerts.occurredAt, cooldown),
  )).limit(1)
  if (recent) {
    await markAlert(alert.id, rule, "ignored")
    return "ignored"
  }
  const actioned = await db.transaction(async (tx) => {
    // Bajo candado: sigue `new` y en la faena con que se eligieron regla y elegibles.
    const [current] = await tx.select({ worksiteId: fleetGpsAlerts.worksiteId, processingStatus: fleetGpsAlerts.processingStatus })
      .from(fleetGpsAlerts).where(eq(fleetGpsAlerts.id, alert.id)).for("update")
    if (!current || current.processingStatus !== "new") return false
    if (current.worksiteId !== alert.worksiteId) throw new AlertWorksiteChanged()
    const policy = onwayCapaPolicy(alert.priority)
    const capa = await createCapaActionWithClient(tx, {
      sourceType: "gps_onway", sourceId: alert.id, sourceItemId: alert.externalEventKey,
      worksiteId: alert.worksiteId, finding: alert.title,
      actionDescription: `Revisar alerta OnWay: ${alert.alertType}.`, responsibleUserId: null,
      priority: policy.priority, targetDate: addDaysToPlainDate(todayInChile(), policy.dueInDays),
      evidenceRequired: true, requiresImmediateStop: false,
      sourceRef: { provider: "onway", gpsAlertId: alert.id },
    }, ownerUserId)
    await tx.update(fleetGpsAlerts).set({
      ruleId: rule.id, category: rule.category, processingStatus: "actioned", linkedEntityType: "capa", linkedEntityId: capa.id, updatedAt: new Date().toISOString(),
    }).where(eq(fleetGpsAlerts.id, alert.id))
    return true
  })
  return actioned ? "actioned" : "skipped"
}

/**
 * Procesa solamente alertas ya normalizadas y con tipo previamente observado.
 * Las reglas se crean desactivadas; ningún tipo desconocido llega a esta capa.
 *
 * Una alerta nunca detiene la cola. La cola va de la más antigua a la más nueva:
 * una que fallara siempre tumbaba cada corrida y ninguna faena volvía a recibir
 * CAPA. La que falla queda `blocked` con su regla y el motivo va al registro.
 */
export async function applyOnwayAlertRules(limit = 200) {
  const fresh = await db.select().from(fleetGpsAlerts).where(and(
    eq(fleetGpsAlerts.provider, "onway"),
    eq(fleetGpsAlerts.processingStatus, "new"),
    isNull(fleetGpsAlerts.ruleId),
  )).orderBy(fleetGpsAlerts.occurredAt).limit(limit)
  let actioned = 0
  let blocked = 0
  for (const row of fresh) {
    const { vehicleId, worksiteId } = row
    if (!vehicleId || !worksiteId) continue
    const alert: OnwayAlert = { ...row, vehicleId, worksiteId }
    let rule: OnwayRule | undefined
    try {
      rule = await ruleFor(alert)
      if (!rule) continue
      const outcome = await applyRule(alert, rule)
      if (outcome === "actioned") actioned++
      else if (outcome === "blocked") blocked++
    } catch (error) {
      if (error instanceof AlertWorksiteChanged) {
        logger.info("[flota/onway] la alerta cambió de faena durante la corrida: se evalúa en la próxima", { alertId: alert.id })
        continue
      }
      logger.warn("[flota/onway] no se pudo procesar una alerta: queda bloqueada", { alertId: alert.id, reason: reasonOf(error) })
      // Sin regla (falló la lectura de reglas) no hay con qué anotarla: queda `new` para la próxima corrida.
      if (!rule) continue
      try {
        await markAlert(alert.id, rule, "blocked")
        blocked++
      } catch (markError) {
        logger.warn("[flota/onway] tampoco se pudo bloquear la alerta", { alertId: alert.id, reason: reasonOf(markError) })
      }
    }
  }
  return { actioned, blocked }
}
