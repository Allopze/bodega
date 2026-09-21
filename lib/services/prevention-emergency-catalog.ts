import { eq, sql } from "drizzle-orm"
import { z } from "zod"
import { db } from "@/db"
import { preventionEmergencyDrills, preventionEmergencyScenarioTypes, preventionEmergencyScenarios } from "@/db/schema"
import { recordAudit } from "@/lib/audit"
import { nanoid } from "@/lib/id"

const emergencyScenarioTypeInputSchema = z.object({
  label: z.string().trim().min(2).max(120),
})

const emergencyScenarioTypeLabelCollator = new Intl.Collator("es-CL", { sensitivity: "base" })
const emergencyScenarioTypeLabelTieBreaker = new Intl.Collator("es-CL", { sensitivity: "variant" })

function sortScenarioTypesAlphabetically<T extends { label: string }>(rows: T[]): T[] {
  return rows.sort((left, right) =>
    emergencyScenarioTypeLabelCollator.compare(left.label, right.label)
    || emergencyScenarioTypeLabelTieBreaker.compare(left.label, right.label),
  )
}

export type EmergencyScenarioCatalogActor = { userId: string; userEmail?: string }

export async function listEmergencyScenarioTypes(options: { includeInactive?: boolean } = {}) {
  const rows = await db.select({
    code: preventionEmergencyScenarioTypes.code,
    label: preventionEmergencyScenarioTypes.label,
    obligation: preventionEmergencyScenarioTypes.obligation,
    isActive: preventionEmergencyScenarioTypes.isActive,
  }).from(preventionEmergencyScenarioTypes)
    .where(options.includeInactive ? undefined : eq(preventionEmergencyScenarioTypes.isActive, true))
  return sortScenarioTypesAlphabetically(rows)
}

export async function listEmergencyScenarioTypeAdminRows() {
  const rows = await db.select({
    code: preventionEmergencyScenarioTypes.code,
    label: preventionEmergencyScenarioTypes.label,
    obligation: preventionEmergencyScenarioTypes.obligation,
    isActive: preventionEmergencyScenarioTypes.isActive,
    scenarioCount: sql<number>`(
      SELECT count(*)::int FROM ${preventionEmergencyScenarios} s
      WHERE s.type = ${preventionEmergencyScenarioTypes.code}
    )`,
    drillCount: sql<number>`(
      SELECT count(*)::int FROM ${preventionEmergencyDrills} d
      WHERE d.scenario_type = ${preventionEmergencyScenarioTypes.code}
    )`,
  }).from(preventionEmergencyScenarioTypes)
  return sortScenarioTypesAlphabetically(rows)
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

    const nextState = { label: data.label, updatedAt: new Date().toISOString() }
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
