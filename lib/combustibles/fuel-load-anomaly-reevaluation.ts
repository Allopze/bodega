import { and, desc, eq } from "drizzle-orm"
import { db } from "@/db"
import { fuelAnomalyCases, fuelAnomalyRules, fuelLoads, fuelVehicles } from "@/db/schema"
import { addAnomalyComment, createAnomalyCase, type AnomalySeverity } from "./anomaly-cases"

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
    const now = new Date().toISOString()
    await db.update(fuelAnomalyCases).set({
      status: "resolved",
      resolution: "Cierre automático: la carga fue corregida y el proveedor ya coincide con el habitual.",
      resolvedById: actorUserId,
      resolvedAt: now,
      updatedAt: now,
    }).where(eq(fuelAnomalyCases.id, currentCase.id))
    await addAnomalyComment(currentCase.id, actorUserId, "Caso resuelto automáticamente tras editar la carga y corregir el proveedor.")
    return { created: 0, reopened: 0, resolved: 1 }
  }

  const description = `Carga de ${row.plate} facturada con un proveedor distinto del habitual declarado para el equipo.`
  if (currentCase) {
    await db.update(fuelAnomalyCases).set({
      severity: rule.severity as AnomalySeverity,
      worksiteId: row.worksiteId,
      vehicleId: row.vehicleId,
      description,
      observedValue: row.supplierId,
      expectedValue: row.usualSupplierId,
      updatedAt: new Date().toISOString(),
    }).where(eq(fuelAnomalyCases.id, currentCase.id))
    return { created: 0, reopened: 0, resolved: 0 }
  }

  if (latestClosedCase) {
    const now = new Date().toISOString()
    await db.update(fuelAnomalyCases).set({
      status: "reopened",
      severity: rule.severity as AnomalySeverity,
      worksiteId: row.worksiteId,
      vehicleId: row.vehicleId,
      description,
      observedValue: row.supplierId,
      expectedValue: row.usualSupplierId,
      resolution: null,
      resolvedById: null,
      resolvedAt: null,
      detectedAt: now,
      updatedAt: now,
    }).where(eq(fuelAnomalyCases.id, latestClosedCase.id))
    await addAnomalyComment(latestClosedCase.id, actorUserId, "Caso reabierto automáticamente tras editar la carga: el proveedor vuelve a diferir del habitual.")
    return { created: 0, reopened: 1, resolved: 0 }
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
