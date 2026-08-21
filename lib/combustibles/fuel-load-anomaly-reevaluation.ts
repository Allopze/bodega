import { and, desc, eq, inArray } from "drizzle-orm"
import { db } from "@/db"
import { fuelAnomalyCases, fuelAnomalyRules, fuelLoads, fuelVehicles } from "@/db/schema"
import { recordAudit, recordStatusChange } from "@/lib/audit"
import { addAnomalyCommentWithClient, createAnomalyCase, type AnomalySeverity } from "./anomaly-cases"

const RULE_CODE = "proveedor_no_habitual"
const ACTIVE_CASE_STATUSES = new Set(["open", "in_review", "reopened"])

/**
 * Reevalúa las anomalías que dependen de una carga facturada editable. El
 * detector batch cubre el mismo caso para el histórico completo; esta ruta
 * focalizada mantiene consistente el caso inmediatamente después de editar.
 */
export async function reevaluateFuelLoadAnomalies(loadId: string, actorUserId: string) {
  const [rule, load] = await Promise.all([
    db.query.fuelAnomalyRules.findFirst({
      where: and(eq(fuelAnomalyRules.code, RULE_CODE), eq(fuelAnomalyRules.isActive, true)),
    }),
    db.select({
      id: fuelLoads.id,
      worksiteId: fuelLoads.worksiteId,
      vehicleId: fuelLoads.vehicleId,
      supplierId: fuelLoads.fuelSupplierId,
      plate: fuelVehicles.plate,
      usualSupplierId: fuelVehicles.usualFuelSupplierId,
    })
      .from(fuelLoads)
      .innerJoin(fuelVehicles, eq(fuelLoads.vehicleId, fuelVehicles.id))
      .where(eq(fuelLoads.id, loadId))
      .limit(1),
  ])
  const row = load[0]
  if (!rule || !row) return { created: 0, reopened: 0, resolved: 0 }

  const cases = await db.query.fuelAnomalyCases.findMany({
    where: and(
      eq(fuelAnomalyCases.ruleCode, RULE_CODE),
      eq(fuelAnomalyCases.referenceEntityType, "fuel_load"),
      eq(fuelAnomalyCases.referenceEntityId, loadId),
    ),
    orderBy: [desc(fuelAnomalyCases.detectedAt)],
  })
  const currentCase = cases.find((item) => ACTIVE_CASE_STATUSES.has(item.status))
  const latestClosedCase = cases.find((item) => item.status === "resolved" || item.status === "dismissed")
  const violates = Boolean(row.usualSupplierId && row.supplierId !== row.usualSupplierId)

  if (!violates) {
    if (!currentCase) return { created: 0, reopened: 0, resolved: 0 }
    const changed = await db.transaction(async (tx) => {
      const [locked] = await tx.select().from(fuelAnomalyCases).where(and(
        eq(fuelAnomalyCases.id, currentCase.id),
        inArray(fuelAnomalyCases.status, [...ACTIVE_CASE_STATUSES]),
      )).for("update").limit(1)
      if (!locked) return false
      const now = new Date().toISOString()
      const resolution = "Cierre automático: la carga fue corregida y el proveedor ya coincide con el habitual."
      await tx.update(fuelAnomalyCases).set({ status: "resolved", resolution, resolvedById: actorUserId, resolvedAt: now, updatedAt: now })
        .where(and(eq(fuelAnomalyCases.id, currentCase.id), eq(fuelAnomalyCases.status, locked.status)))
      await addAnomalyCommentWithClient(tx, currentCase.id, actorUserId, "Caso resuelto automáticamente tras editar la carga y corregir el proveedor.")
      await recordStatusChange({ entityType: "fuel_anomaly_case", entityId: currentCase.id, fromStatus: locked.status, toStatus: "resolved", changedBy: actorUserId, reason: resolution }, tx)
      await recordAudit({ userId: actorUserId, action: "status_change", entityType: "fuel_anomaly_case", entityId: currentCase.id, oldState: { status: locked.status }, newState: { status: "resolved", resolution }, reason: resolution }, tx)
      return true
    })
    return { created: 0, reopened: 0, resolved: changed ? 1 : 0 }
  }

  const description = `Carga de ${row.plate} facturada con un proveedor distinto del habitual declarado para el equipo.`
  if (currentCase) {
    await db.transaction(async (tx) => {
      const [locked] = await tx.select().from(fuelAnomalyCases).where(and(
        eq(fuelAnomalyCases.id, currentCase.id),
        inArray(fuelAnomalyCases.status, [...ACTIVE_CASE_STATUSES]),
      )).for("update").limit(1)
      if (!locked) return
      const newState = {
        severity: rule.severity as AnomalySeverity,
        worksiteId: row.worksiteId,
        vehicleId: row.vehicleId,
        description,
        observedValue: row.supplierId,
        expectedValue: row.usualSupplierId,
        updatedAt: new Date().toISOString(),
      }
      await tx.update(fuelAnomalyCases).set(newState).where(and(eq(fuelAnomalyCases.id, currentCase.id), eq(fuelAnomalyCases.status, locked.status)))
      await recordAudit({ userId: actorUserId, action: "update", entityType: "fuel_anomaly_case", entityId: currentCase.id, oldState: { severity: locked.severity, worksiteId: locked.worksiteId, vehicleId: locked.vehicleId, description: locked.description, observedValue: locked.observedValue, expectedValue: locked.expectedValue }, newState }, tx)
    })
    return { created: 0, reopened: 0, resolved: 0 }
  }

  if (latestClosedCase) {
    const changed = await db.transaction(async (tx) => {
      const [locked] = await tx.select().from(fuelAnomalyCases).where(and(
        eq(fuelAnomalyCases.id, latestClosedCase.id),
        inArray(fuelAnomalyCases.status, ["resolved", "dismissed"]),
      )).for("update").limit(1)
      if (!locked) return false
      const now = new Date().toISOString()
      const newState = { status: "reopened" as const, severity: rule.severity as AnomalySeverity, worksiteId: row.worksiteId, vehicleId: row.vehicleId, description, observedValue: row.supplierId, expectedValue: row.usualSupplierId, resolution: null, resolvedById: null, resolvedAt: null, detectedAt: now, updatedAt: now }
      await tx.update(fuelAnomalyCases).set(newState).where(and(eq(fuelAnomalyCases.id, latestClosedCase.id), eq(fuelAnomalyCases.status, locked.status)))
      await addAnomalyCommentWithClient(tx, latestClosedCase.id, actorUserId, "Caso reabierto automáticamente tras editar la carga: el proveedor vuelve a diferir del habitual.")
      await recordStatusChange({ entityType: "fuel_anomaly_case", entityId: latestClosedCase.id, fromStatus: locked.status, toStatus: "reopened", changedBy: actorUserId, reason: "La carga editada vuelve a diferir del proveedor habitual" }, tx)
      await recordAudit({ userId: actorUserId, action: "status_change", entityType: "fuel_anomaly_case", entityId: latestClosedCase.id, oldState: { status: locked.status, resolution: locked.resolution }, newState, reason: "Reevaluación automática de la carga" }, tx)
      return true
    })
    return { created: 0, reopened: changed ? 1 : 0, resolved: 0 }
  }

  await createAnomalyCase({
    ruleId: rule.id,
    ruleCode: RULE_CODE,
    severity: rule.severity as AnomalySeverity,
    worksiteId: row.worksiteId,
    vehicleId: row.vehicleId,
    referenceEntityType: "fuel_load",
    referenceEntityId: row.id,
    description,
    observedValue: row.supplierId,
    expectedValue: row.usualSupplierId ?? undefined,
  })
  return { created: 1, reopened: 0, resolved: 0 }
}
