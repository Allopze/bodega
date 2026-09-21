import { asc, eq, sql } from "drizzle-orm"
import { z } from "zod"
import { db } from "@/db"
import { preventionEmergencyDrills, preventionEmergencyScenarioTypes, preventionEmergencyScenarios } from "@/db/schema"
import { recordAudit } from "@/lib/audit"
import { nanoid } from "@/lib/id"

const emergencyScenarioTypeInputSchema = z.object({
  label: z.string().trim().min(2).max(120),
  sortOrder: z.coerce.number().int().min(0).max(10_000),
})

export type EmergencyScenarioCatalogActor = { userId: string; userEmail?: string }

export async function listEmergencyScenarioTypes(options: { includeInactive?: boolean } = {}) {
  return db.select({
    code: preventionEmergencyScenarioTypes.code,
    label: preventionEmergencyScenarioTypes.label,
    obligation: preventionEmergencyScenarioTypes.obligation,
    isSystem: preventionEmergencyScenarioTypes.isSystem,
    isActive: preventionEmergencyScenarioTypes.isActive,
    sortOrder: preventionEmergencyScenarioTypes.sortOrder,
  }).from(preventionEmergencyScenarioTypes)
    .where(options.includeInactive ? undefined : eq(preventionEmergencyScenarioTypes.isActive, true))
    .orderBy(asc(preventionEmergencyScenarioTypes.sortOrder), asc(preventionEmergencyScenarioTypes.label))
}

export async function listEmergencyScenarioTypeAdminRows() {
  return db.select({
    code: preventionEmergencyScenarioTypes.code,
    label: preventionEmergencyScenarioTypes.label,
    obligation: preventionEmergencyScenarioTypes.obligation,
    isSystem: preventionEmergencyScenarioTypes.isSystem,
    isActive: preventionEmergencyScenarioTypes.isActive,
    sortOrder: preventionEmergencyScenarioTypes.sortOrder,
    scenarioCount: sql<number>`(
      SELECT count(*)::int FROM ${preventionEmergencyScenarios} s
      WHERE s.type = ${preventionEmergencyScenarioTypes.code}
    )`,
    drillCount: sql<number>`(
      SELECT count(*)::int FROM ${preventionEmergencyDrills} d
      WHERE d.scenario_type = ${preventionEmergencyScenarioTypes.code}
    )`,
  }).from(preventionEmergencyScenarioTypes)
    .orderBy(asc(preventionEmergencyScenarioTypes.sortOrder), asc(preventionEmergencyScenarioTypes.label))
}

export async function createEmergencyScenarioType(input: unknown, actor: EmergencyScenarioCatalogActor) {
  const data = emergencyScenarioTypeInputSchema.parse(input)
  const now = new Date().toISOString()
  const values = {
    code: `custom-${nanoid()}`,
    label: data.label,
    obligation: "custom",
    isSystem: false,
    isActive: true,
    sortOrder: data.sortOrder,
    createdAt: now,
    updatedAt: now,
  }

  return db.transaction(async (tx) => {
    const [created] = await tx.insert(preventionEmergencyScenarioTypes).values(values).returning()
    if (!created) throw new Error("No se pudo crear el tipo de escenario.")
    await recordAudit({
      userId: actor.userId,
      userEmail: actor.userEmail,
      action: "create",
      entityType: "emergency_scenario_type",
      entityId: created.code,
      newState: created,
    }, tx)
    return created
  })
}

export async function updateEmergencyScenarioType(code: string, input: unknown, actor: EmergencyScenarioCatalogActor) {
  const data = emergencyScenarioTypeInputSchema.parse(input)
  return db.transaction(async (tx) => {
    const [existing] = await tx.select().from(preventionEmergencyScenarioTypes)
      .where(eq(preventionEmergencyScenarioTypes.code, code)).limit(1)
    if (!existing) throw new Error("Tipo de escenario no encontrado.")
    if (existing.isSystem) throw new Error("Los tipos base de emergencia están protegidos.")

    const nextState = { label: data.label, sortOrder: data.sortOrder, updatedAt: new Date().toISOString() }
    const [updated] = await tx.update(preventionEmergencyScenarioTypes).set(nextState)
      .where(eq(preventionEmergencyScenarioTypes.code, code)).returning()
    if (!updated) throw new Error("No se pudo actualizar el tipo de escenario.")
    await recordAudit({
      userId: actor.userId,
      userEmail: actor.userEmail,
      action: "update",
      entityType: "emergency_scenario_type",
      entityId: code,
      oldState: existing,
      newState: updated,
    }, tx)
    return updated
  })
}

export async function setEmergencyScenarioTypeActive(code: string, isActive: boolean, actor: EmergencyScenarioCatalogActor) {
  return db.transaction(async (tx) => {
    const [existing] = await tx.select().from(preventionEmergencyScenarioTypes)
      .where(eq(preventionEmergencyScenarioTypes.code, code)).limit(1)
    if (!existing) throw new Error("Tipo de escenario no encontrado.")
    if (existing.isSystem) throw new Error("Los tipos base de emergencia están protegidos.")

    const nextState = { isActive, updatedAt: new Date().toISOString() }
    const [updated] = await tx.update(preventionEmergencyScenarioTypes).set(nextState)
      .where(eq(preventionEmergencyScenarioTypes.code, code)).returning()
    if (!updated) throw new Error("No se pudo cambiar el estado del tipo de escenario.")
    await recordAudit({
      userId: actor.userId,
      userEmail: actor.userEmail,
      action: "update",
      entityType: "emergency_scenario_type",
      entityId: code,
      oldState: { isActive: existing.isActive },
      newState: { isActive },
    }, tx)
    return updated
  })
}
