import { asc, eq, sql } from "drizzle-orm"
import { z } from "zod"
import { db } from "@/db"
import { preventionRiskEntries, preventionRiskFactors } from "@/db/schema"
import { recordModuleHistory } from "@/lib/audit"
import { nanoid } from "@/lib/id"
import { riskFactorSaveSchema } from "@/lib/validation/prevention-module/miper"
import { RiskLegalDomainError } from "@/lib/services/prevention-risk-legal-errors"
import { type MiperAccess, nowIso, requireAccess } from "./shared"

/**
 * El catálogo de factores es transversal (no cuelga de una faena), así que su
 * permiso tampoco: `requireAccess` se usa sin `worksiteId` y el alcance no
 * recorta nada.
 */
const MANAGE = "prevention:risk:catalog:manage"

/**
 * Vista del catálogo tal como la usa la pantalla de administración: el
 * `usageCount` viene en la misma consulta para poder avisar antes de desactivar
 * un factor que todavía clasifica filas del RE-04, sin una segunda vuelta por
 * cada uno.
 */
export async function listRiskFactors(): Promise<Array<{ id: string; code: string; name: string; sortOrder: number; isActive: boolean; usageCount: number }>> {
  const rows = await db.select({
    id: preventionRiskFactors.id, code: preventionRiskFactors.code, name: preventionRiskFactors.name,
    sortOrder: preventionRiskFactors.sortOrder, isActive: preventionRiskFactors.isActive,
    usageCount: sql<number>`(select count(*)::int from ${preventionRiskEntries} where ${preventionRiskEntries.riskFactorId} = ${preventionRiskFactors.id})`,
  }).from(preventionRiskFactors).orderBy(asc(preventionRiskFactors.sortOrder), asc(preventionRiskFactors.name))
  return rows
}

export async function saveRiskFactor(input: unknown, access: MiperAccess): Promise<{ id: string }> {
  const data = riskFactorSaveSchema.parse(input)
  requireAccess(access, MANAGE)
  const now = nowIso()
  const id = data.id ?? `riskfactor-${nanoid(10)}`
  try {
    if (data.id) {
      const [updated] = await db.update(preventionRiskFactors).set({ code: data.code, name: data.name, sortOrder: data.sortOrder, updatedAt: now }).where(eq(preventionRiskFactors.id, data.id)).returning({ id: preventionRiskFactors.id })
      if (!updated) throw new RiskLegalDomainError("Factor de riesgo no encontrado.")
    } else {
      await db.insert(preventionRiskFactors).values({ id, code: data.code, name: data.name, sortOrder: data.sortOrder, createdAt: now, updatedAt: now })
    }
  } catch (error) {
    if (error instanceof RiskLegalDomainError) throw error
    // Postgres rechaza por los índices únicos de código y nombre; Drizzle
    // envuelve el error, así que el código `23505` puede viajar en `cause`.
    // Se traduce a mensaje de dominio para que la pantalla lo muestre tal cual.
    if (String((error as { code?: string }).code ?? (error as { cause?: { code?: string } }).cause?.code) === "23505") throw new RiskLegalDomainError("Ya existe un factor de riesgo con ese código o nombre.")
    throw error
  }
  await recordModuleHistory(db, { module: "risk_legal:risk", entityType: "risk_factor", entityId: id, changeType: data.id ? "updated" : "created", afterState: data, actorUserId: access.userId })
  return { id }
}

/**
 * Desactivar no borra: un factor en uso queda referenciado por filas del RE-04
 * (FK con `restrict`), así que la baja tiene que ser lógica para no perder esa
 * clasificación histórica.
 */
export async function setRiskFactorActive(input: unknown, access: MiperAccess): Promise<void> {
  const data = z.object({ id: z.string().min(1), isActive: z.boolean() }).parse(input)
  requireAccess(access, MANAGE)
  const [updated] = await db.update(preventionRiskFactors).set({ isActive: data.isActive, updatedAt: nowIso() }).where(eq(preventionRiskFactors.id, data.id)).returning({ id: preventionRiskFactors.id })
  if (!updated) throw new RiskLegalDomainError("Factor de riesgo no encontrado.")
  await recordModuleHistory(db, { module: "risk_legal:risk", entityType: "risk_factor", entityId: data.id, changeType: data.isActive ? "reactivated" : "deactivated", actorUserId: access.userId })
}
