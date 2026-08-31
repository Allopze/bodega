import { and, desc, eq, inArray, isNotNull, lt, or } from "drizzle-orm"
import { db } from "@/db"
import { fuelAnomalyCases, fuelAnomalyRules, fuelLoads, fuelVehicles } from "@/db/schema"
import { METER_RESET_RULE_CODES } from "@/lib/combustibles/anomaly-labels"
import { accountableFuelLoadsWhere } from "@/lib/combustibles/load-status"
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

/**
 * Cierra los casos de medidor de una carga cuya lectura acaba de corregirse.
 *
 * Antes, corregir el número no tocaba el caso: quedaba abierto para siempre —el
 * detector batch tampoco lo cierra, sólo crea— y el revisor terminaba
 * resolviéndolo a mano, lo que hasta esta versión equivalía a declarar un reset
 * de medidor y cortaba la serie del equipo. Acá se cierra con la causa correcta,
 * `lectura_corregida`, que Flota y Mantenciones ignoran a propósito.
 *
 * También REABRE: `createAnomalyCase` deduplica por (regla, entidad) en
 * cualquier estado —correcto para la evidencia inmutable de un proveedor, no
 * para una carga propia que se puede volver a editar— así que sin esta rama un
 * caso ya cerrado dejaba a esa carga sin vigilancia para siempre. Lo que no hace
 * es crear el primer caso: eso es del detector batch, que ve la serie completa.
 */
export async function resolveCorrectedMeterCases(loadId: string, actorUserId: string) {
  const [load] = await db.select({
    id: fuelLoads.id,
    vehicleId: fuelLoads.vehicleId,
    loadDate: fuelLoads.loadDate,
    createdAt: fuelLoads.createdAt,
    odometerReading: fuelLoads.odometerReading,
    hourMeterReading: fuelLoads.hourMeterReading,
  }).from(fuelLoads).where(eq(fuelLoads.id, loadId)).limit(1)
  if (!load) return { resolved: 0, reopened: 0 }

  const meterCases = await db.query.fuelAnomalyCases.findMany({
    where: and(
      inArray(fuelAnomalyCases.ruleCode, [...METER_RESET_RULE_CODES]),
      eq(fuelAnomalyCases.referenceEntityType, "fuel_load"),
      eq(fuelAnomalyCases.referenceEntityId, loadId),
    ),
    orderBy: [desc(fuelAnomalyCases.detectedAt)],
  })
  if (meterCases.length === 0) return { resolved: 0, reopened: 0 }

  let resolved = 0
  let reopened = 0
  for (const item of meterCases) {
    const isActive = ACTIVE_CASE_STATUSES.has(item.status)
    // Un caso cerrado como reset de medidor describe un hecho físico, no un
    // error de dato: editar la carga no lo invalida y no se reabre.
    if (!isActive && item.resolutionKind === "reset_medidor") continue
    const isHourMeter = item.ruleCode === "horometro_regresivo"
    const column = isHourMeter ? fuelLoads.hourMeterReading : fuelLoads.odometerReading
    const current = isHourMeter ? load.hourMeterReading : load.odometerReading

    let stillRegressive = false
    if (current != null && load.vehicleId) {
      // Misma serie que usa el detector: cargas contabilizables del equipo,
      // anteriores a ésta por fecha y desempatadas por `createdAt`.
      const [previous] = await db.select({ reading: column })
        .from(fuelLoads)
        .where(and(
          eq(fuelLoads.vehicleId, load.vehicleId),
          isNotNull(column),
          accountableFuelLoadsWhere(),
          or(
            lt(fuelLoads.loadDate, load.loadDate),
            and(eq(fuelLoads.loadDate, load.loadDate), lt(fuelLoads.createdAt, load.createdAt)),
          ),
        ))
        .orderBy(desc(fuelLoads.loadDate), desc(fuelLoads.createdAt))
        .limit(1)
      stillRegressive = previous?.reading != null && Number(current) < Number(previous.reading)
    }
    if (stillRegressive) {
      if (isActive) continue
      const back = await db.transaction(async (tx) => {
        const [locked] = await tx.select().from(fuelAnomalyCases).where(and(
          eq(fuelAnomalyCases.id, item.id),
          inArray(fuelAnomalyCases.status, ["resolved", "dismissed"]),
        )).for("update").limit(1)
        if (!locked) return false
        const now = new Date().toISOString()
        const reason = "La carga editada vuelve a declarar una lectura menor que la anterior"
        const newState = {
          status: "reopened" as const, resolution: null, resolutionKind: null,
          resolvedById: null, resolvedAt: null, detectedAt: now, updatedAt: now,
        }
        await tx.update(fuelAnomalyCases).set(newState)
          .where(and(eq(fuelAnomalyCases.id, item.id), eq(fuelAnomalyCases.status, locked.status)))
        await addAnomalyCommentWithClient(tx, item.id, actorUserId, "Caso reabierto automáticamente: la lectura editada vuelve a retroceder.")
        await recordStatusChange({ entityType: "fuel_anomaly_case", entityId: item.id, fromStatus: locked.status, toStatus: "reopened", changedBy: actorUserId, reason }, tx)
        await recordAudit({ userId: actorUserId, action: "status_change", entityType: "fuel_anomaly_case", entityId: item.id, oldState: { status: locked.status, resolutionKind: locked.resolutionKind }, newState, reason }, tx)
        return true
      })
      if (back) reopened++
      continue
    }
    if (!isActive) continue

    const changed = await db.transaction(async (tx) => {
      const [locked] = await tx.select().from(fuelAnomalyCases).where(and(
        eq(fuelAnomalyCases.id, item.id),
        inArray(fuelAnomalyCases.status, [...ACTIVE_CASE_STATUSES]),
      )).for("update").limit(1)
      if (!locked) return false
      const now = new Date().toISOString()
      const resolution = "Cierre automático: la lectura del medidor se corrigió y ya no retrocede."
      await tx.update(fuelAnomalyCases).set({
        status: "resolved", resolution, resolutionKind: "lectura_corregida",
        resolvedById: actorUserId, resolvedAt: now, updatedAt: now,
      }).where(and(eq(fuelAnomalyCases.id, item.id), eq(fuelAnomalyCases.status, locked.status)))
      await addAnomalyCommentWithClient(tx, item.id, actorUserId, "Caso resuelto automáticamente tras corregir la lectura del medidor en la carga.")
      await recordStatusChange({ entityType: "fuel_anomaly_case", entityId: item.id, fromStatus: locked.status, toStatus: "resolved", changedBy: actorUserId, reason: resolution }, tx)
      await recordAudit({ userId: actorUserId, action: "status_change", entityType: "fuel_anomaly_case", entityId: item.id, oldState: { status: locked.status }, newState: { status: "resolved", resolution, resolutionKind: "lectura_corregida" }, reason: resolution }, tx)
      return true
    })
    if (changed) resolved++
  }
  return { resolved, reopened }
}
