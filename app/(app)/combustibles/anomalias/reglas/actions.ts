"use server"

import { revalidatePath } from "next/cache"
import { eq } from "drizzle-orm"
import { db } from "@/db"
import { fuelAnomalyRules } from "@/db/schema/fuel-anomalies"
import { isNetworkError } from "@/lib/network-error"
import { recordAudit } from "@/lib/audit"
import { logger } from "@/lib/logger"
import { requirePermission } from "@/lib/auth/can"
import { anomalyRuleSchema } from "@/lib/combustibles/validation"
import { nanoid } from "@/lib/id"
import type { ActionState } from "@/lib/validation/masters"

const PATH = "/combustibles/anomalias/reglas"

function input(formData: FormData) {
  // Leer config base desde el textarea JSON
  const rawConfig = formData.get("config")
  let configObj: Record<string, unknown> = {}
  if (typeof rawConfig === "string" && rawConfig.trim()) {
    try { configObj = JSON.parse(rawConfig) } catch { /* se validará después */ }
  }

  // Mergear minSample y batchRowLimit si vienen de campos dedicados
  const minSample = formData.get("minSample")
  const batchRowLimit = formData.get("batchRowLimit")

  if (minSample !== null && minSample !== "") {
    configObj["minSample"] = Number(minSample)
  } else {
    delete configObj["minSample"]
  }
  if (batchRowLimit !== null && batchRowLimit !== "") {
    configObj["batchRowLimit"] = Number(batchRowLimit)
  } else {
    delete configObj["batchRowLimit"]
  }

  return {
    code: formData.get("code"),
    name: formData.get("name"),
    description: formData.get("description") || undefined,
    severity: formData.get("severity"),
    isActive: formData.get("isActive") === "on",
    config: JSON.stringify(configObj),
  }
}

export async function createAnomalyRuleAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  let session
  try { session = await requirePermission("combustibles:manage_anomaly_rules") }
  catch { return { ok: false, message: "Sin permisos" } }

  const parsed = anomalyRuleSchema.safeParse(input(formData))
  if (!parsed.success) return { ok: false, message: "Revisa los datos", fieldErrors: parsed.error.flatten().fieldErrors }

  const existing = await db.query.fuelAnomalyRules.findFirst({ where: eq(fuelAnomalyRules.code, parsed.data.code) })
  if (existing) return { ok: false, message: `Ya existe una regla con el código "${parsed.data.code}"`, fieldErrors: { code: ["Código ya usado"] } }

  const id = nanoid()
  const values = {
    id, code: parsed.data.code, name: parsed.data.name, description: parsed.data.description ?? null,
    severity: parsed.data.severity, isActive: parsed.data.isActive,
    config: parsed.data.config || "{}", createdBy: session.user.id,
  }
  try {
    await db.transaction(async (tx) => {
      await tx.insert(fuelAnomalyRules).values(values)
      await recordAudit({ userId: session.user.id, userEmail: session.user.email ?? undefined, action: "create", entityType: "fuel_anomaly_rule", entityId: id, entityCode: values.code, newState: values }, tx)
    })
    revalidatePath(PATH)
    return { ok: true, message: "Regla creada", data: { id } }
  } catch (error) {
    logger.error("[createAnomalyRuleAction]", error)
    return { ok: false, message: error instanceof Error && isNetworkError(error) ? "Sin conexión al servidor. Verifica tu conexión a internet e inténtalo nuevamente." : "No se pudo crear la regla" }
  }
}

export async function updateAnomalyRuleAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  let session
  try { session = await requirePermission("combustibles:manage_anomaly_rules") }
  catch { return { ok: false, message: "Sin permisos" } }

  const id = String(formData.get("id") ?? "")
  if (!id) return { ok: false, message: "ID requerido" }
  const parsed = anomalyRuleSchema.safeParse(input(formData))
  if (!parsed.success) return { ok: false, message: "Revisa los datos", fieldErrors: parsed.error.flatten().fieldErrors }

  const existing = await db.query.fuelAnomalyRules.findFirst({ where: eq(fuelAnomalyRules.id, id) })
  if (!existing) return { ok: false, message: "Regla no encontrada" }
  if (parsed.data.code !== existing.code) {
    const codeTaken = await db.query.fuelAnomalyRules.findFirst({ where: eq(fuelAnomalyRules.code, parsed.data.code) })
    if (codeTaken) return { ok: false, message: `Ya existe una regla con el código "${parsed.data.code}"`, fieldErrors: { code: ["Código ya usado"] } }
  }

  const nextState = {
    code: parsed.data.code, name: parsed.data.name, description: parsed.data.description ?? null,
    severity: parsed.data.severity, isActive: parsed.data.isActive,
    config: parsed.data.config || "{}", updatedAt: new Date().toISOString(),
  }
  try {
    await db.transaction(async (tx) => {
      await tx.update(fuelAnomalyRules).set(nextState).where(eq(fuelAnomalyRules.id, id))
      await recordAudit({
        userId: session.user.id, userEmail: session.user.email ?? undefined, action: "update", entityType: "fuel_anomaly_rule", entityId: id, entityCode: nextState.code,
        oldState: { name: existing.name, severity: existing.severity, isActive: existing.isActive, config: existing.config },
        newState: nextState,
      }, tx)
    })
    revalidatePath(PATH)
    return { ok: true, message: "Regla actualizada" }
  } catch (error) {
    logger.error("[updateAnomalyRuleAction]", error)
    return { ok: false, message: error instanceof Error && isNetworkError(error) ? "Sin conexión al servidor. Verifica tu conexión a internet e inténtalo nuevamente." : "No se pudo actualizar la regla" }
  }
}

export async function setAnomalyRuleStatusAction(id: string, isActive: boolean): Promise<ActionState> {
  let session
  try { session = await requirePermission("combustibles:manage_anomaly_rules") }
  catch { return { ok: false, message: "Sin permisos" } }
  const existing = await db.query.fuelAnomalyRules.findFirst({ where: eq(fuelAnomalyRules.id, id) })
  if (!existing) return { ok: false, message: "Regla no encontrada" }
  const nextState = { isActive, updatedAt: new Date().toISOString() }
  try {
    await db.transaction(async (tx) => {
      await tx.update(fuelAnomalyRules).set(nextState).where(eq(fuelAnomalyRules.id, id))
      await recordAudit({ userId: session.user.id, userEmail: session.user.email ?? undefined, action: "update", entityType: "fuel_anomaly_rule", entityId: id, entityCode: existing.code, oldState: { isActive: existing.isActive }, newState: { isActive } }, tx)
    })
    revalidatePath(PATH)
    return { ok: true, message: isActive ? "Regla activada" : "Regla desactivada" }
  } catch (error) {
    logger.error("[setAnomalyRuleStatusAction]", error)
    return { ok: false, message: error instanceof Error && isNetworkError(error) ? "Sin conexión al servidor. Verifica tu conexión a internet e inténtalo nuevamente." : "No se pudo cambiar el estado" }
  }
}
