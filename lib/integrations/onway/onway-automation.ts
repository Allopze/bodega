import { and, desc, eq, gte, isNull, sql } from "drizzle-orm"
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

/** Intentos fallidos tras los cuales la alerta deja de reintentarse y queda `blocked`. */
export const MAX_ONWAY_AUTOMATION_ATTEMPTS = 3

/**
 * Anota un fallo inesperado de la automatización (una caída de la base, un error al crear la CAPA).
 * La alerta sigue `new`, sin regla, y la próxima corrida la reintenta: un error transitorio no le
 * quita su CAPA para siempre. Al intento número `MAX_ONWAY_AUTOMATION_ATTEMPTS` queda `blocked`
 * con el motivo del último fallo. Devuelve el estado en que quedó.
 */
async function recordFailure(alert: OnwayAlert, rule: OnwayRule | undefined, error: unknown): Promise<"retry" | "blocked"> {
  const now = new Date().toISOString()
  const [row] = await db.update(fleetGpsAlerts).set({
    automationAttempts: sql`${fleetGpsAlerts.automationAttempts} + 1`,
    automationLastError: reasonOf(error).slice(0, 500),
    automationLastAttemptAt: now,
    updatedAt: now,
  }).where(and(eq(fleetGpsAlerts.id, alert.id), eq(fleetGpsAlerts.processingStatus, "new")))
    .returning({ attempts: fleetGpsAlerts.automationAttempts })
  if (!row || row.attempts < MAX_ONWAY_AUTOMATION_ATTEMPTS) return "retry"
  if (rule) await markAlert(alert.id, rule, "blocked")
  else {
    await db.update(fleetGpsAlerts).set({ processingStatus: "blocked", updatedAt: new Date().toISOString() })
      .where(and(eq(fleetGpsAlerts.id, alert.id), eq(fleetGpsAlerts.processingStatus, "new")))
  }
  return "blocked"
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
 * Una alerta nunca detiene la cola. Un fallo inesperado se reintenta en las corridas siguientes y
 * sólo al tercero la alerta queda `blocked` con su motivo (`recordFailure`). La cola atiende primero
 * las alertas sin intentos y después las de intento más antiguo, y dentro de cada grupo la más
 * antigua: una alerta que falla siempre no acapara el lote ni deja sin CAPA a las más nuevas.
 */
export async function applyOnwayAlertRules(limit = 200) {
  const fresh = await db.select().from(fleetGpsAlerts).where(and(
    eq(fleetGpsAlerts.provider, "onway"),
    eq(fleetGpsAlerts.processingStatus, "new"),
    isNull(fleetGpsAlerts.ruleId),
  )).orderBy(sql`${fleetGpsAlerts.automationLastAttemptAt} asc nulls first`, fleetGpsAlerts.occurredAt).limit(limit)
  let actioned = 0
  let blocked = 0
  let retrying = 0
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
      logger.warn("[flota/onway] no se pudo procesar una alerta", { alertId: alert.id, reason: reasonOf(error) })
      try {
        if (await recordFailure(alert, rule, error) === "blocked") blocked++
        else retrying++
      } catch (recordError) {
        // Sin poder anotar el fallo la alerta queda como estaba y la próxima corrida la vuelve a tomar.
        logger.warn("[flota/onway] tampoco se pudo anotar el fallo de la alerta", { alertId: alert.id, reason: reasonOf(recordError) })
      }
    }
  }
  return { actioned, blocked, retrying }
}
