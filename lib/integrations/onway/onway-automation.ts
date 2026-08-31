import { and, desc, eq, gte, isNull } from "drizzle-orm"
import { db } from "@/db"
import { fleetGpsAlertRules, fleetGpsAlerts, fuelVehicles } from "@/db/schema"
import { nanoid } from "@/lib/id"
import { createMaintenanceRecordWithClient } from "@/lib/services/maintenance"
import { createCapaActionWithClient } from "@/lib/services/prevention-capa"
import { getUserIdsWithPermissionForWorksite } from "@/lib/services/notification-targeting"
import { addDaysToPlainDate, todayInChile } from "@/lib/utils"

export function onwayCapaPolicy(priority: string | null) {
  if (priority?.toLowerCase() === "critical") return { priority: "critical" as const, dueInDays: 1 }
  if (priority?.toLowerCase() === "high") return { priority: "high" as const, dueInDays: 7 }
  return { priority: "medium" as const, dueInDays: 14 }
}

/**
 * Procesa solamente alertas ya normalizadas y con tipo previamente observado.
 * Las reglas se crean desactivadas; ningún tipo desconocido llega a esta capa.
 */
export async function applyOnwayAlertRules(limit = 200) {
  const fresh = await db.select().from(fleetGpsAlerts).where(and(
    eq(fleetGpsAlerts.provider, "onway"),
    eq(fleetGpsAlerts.processingStatus, "new"),
    isNull(fleetGpsAlerts.ruleId),
  )).orderBy(fleetGpsAlerts.occurredAt).limit(limit)
  let actioned = 0
  let blocked = 0
  for (const alert of fresh) {
    if (!alert.vehicleId || !alert.worksiteId) continue
    const [rule] = await db.select().from(fleetGpsAlertRules).where(and(
      eq(fleetGpsAlertRules.provider, "onway"),
      eq(fleetGpsAlertRules.isEnabled, true),
      eq(fleetGpsAlertRules.alertType, alert.alertType),
      eq(fleetGpsAlertRules.worksiteId, alert.worksiteId),
    )).orderBy(desc(fleetGpsAlertRules.updatedAt)).limit(1)
    if (!rule) continue
    if (!rule.ownerUserId || rule.destination === "none") {
      await db.update(fleetGpsAlerts).set({ ruleId: rule.id, category: rule.category, processingStatus: "blocked", updatedAt: new Date().toISOString() })
        .where(and(eq(fleetGpsAlerts.id, alert.id), eq(fleetGpsAlerts.processingStatus, "new")))
      blocked++
      continue
    }
    const requiredPermission = rule.destination === "maintenance" ? "mantenciones:create" : "prevention:capa:manage"
    const eligible = await getUserIdsWithPermissionForWorksite(requiredPermission, alert.worksiteId)
    if (!eligible.includes(rule.ownerUserId)) {
      await db.update(fleetGpsAlerts).set({ ruleId: rule.id, category: rule.category, processingStatus: "blocked", updatedAt: new Date().toISOString() })
        .where(and(eq(fleetGpsAlerts.id, alert.id), eq(fleetGpsAlerts.processingStatus, "new")))
      blocked++
      continue
    }
    const cooldown = new Date(new Date(alert.occurredAt).getTime() - rule.cooldownMinutes * 60_000).toISOString()
    const [recent] = await db.select({ id: fleetGpsAlerts.id }).from(fleetGpsAlerts).where(and(
      eq(fleetGpsAlerts.vehicleId, alert.vehicleId), eq(fleetGpsAlerts.ruleId, rule.id),
      eq(fleetGpsAlerts.processingStatus, "actioned"), gte(fleetGpsAlerts.occurredAt, cooldown),
    )).limit(1)
    if (recent) {
      await db.update(fleetGpsAlerts).set({ ruleId: rule.id, category: rule.category, processingStatus: "ignored", updatedAt: new Date().toISOString() })
        .where(and(eq(fleetGpsAlerts.id, alert.id), eq(fleetGpsAlerts.processingStatus, "new")))
      continue
    }
    await db.transaction(async (tx) => {
      const [vehicle] = await tx.select({ id: fuelVehicles.id, worksiteId: fuelVehicles.worksiteId }).from(fuelVehicles).where(eq(fuelVehicles.id, alert.vehicleId!)).limit(1)
      if (!vehicle || vehicle.worksiteId !== alert.worksiteId) throw new Error("ONWAY_VEHICLE_SCOPE_CHANGED")
      let linkedEntityType: "maintenance" | "capa"
      let linkedEntityId: string
      if (rule.destination === "maintenance") {
        linkedEntityType = "maintenance"
        linkedEntityId = await createMaintenanceRecordWithClient(tx, {
          vehicleId: vehicle.id, maintenanceDate: todayInChile(), maintenanceType: "preventiva",
          status: "scheduled", odometerReading: null, hourMeterReading: null,
          netAmount: 0, taxAmount: 0, totalAmount: 0, documentNumber: "", documentName: "",
          notes: `Alerta GPS OnWay ${alert.alertType} · ${alert.id}`,
          priority: alert.priority?.toLowerCase() === "critical" ? "critical" : alert.priority?.toLowerCase() === "high" ? "high" : "normal",
          assignedToUserId: null, operationalImpact: "none",
        }, { actorUserId: rule.ownerUserId!, vehicle })
      } else {
        linkedEntityType = "capa"
        const policy = onwayCapaPolicy(alert.priority)
        const capa = await createCapaActionWithClient(tx, {
          sourceType: "gps_onway", sourceId: alert.id, sourceItemId: alert.externalEventKey,
          worksiteId: alert.worksiteId!, finding: alert.title,
          actionDescription: `Revisar alerta OnWay: ${alert.alertType}.`, responsibleUserId: null,
          priority: policy.priority, targetDate: addDaysToPlainDate(todayInChile(), policy.dueInDays),
          evidenceRequired: true, requiresImmediateStop: false,
          sourceRef: { provider: "onway", gpsAlertId: alert.id },
        }, rule.ownerUserId!)
        linkedEntityId = capa.id
      }
      const updated = await tx.update(fleetGpsAlerts).set({
        ruleId: rule.id, category: rule.category, processingStatus: "actioned", linkedEntityType, linkedEntityId, updatedAt: new Date().toISOString(),
      }).where(and(eq(fleetGpsAlerts.id, alert.id), eq(fleetGpsAlerts.processingStatus, "new"))).returning({ id: fleetGpsAlerts.id })
      if (updated.length === 0) throw new Error("ONWAY_ALERT_ALREADY_PROCESSED")
    })
    actioned++
  }
  return { actioned, blocked }
}
