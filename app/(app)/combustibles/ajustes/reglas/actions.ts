"use server"

import { eq } from "drizzle-orm"
import { db } from "@/db"
import { fuelAnomalyRules } from "@/db/schema/fuel-anomalies"
import { isNetworkError } from "@/lib/network-error"
import { recordAudit } from "@/lib/audit"
import { logger } from "@/lib/logger"
import { requirePermission } from "@/lib/auth/can"
import { anomalyRuleSchema } from "@/lib/combustibles/validation"
import {
  BATCH_ROW_LIMIT_PARAMETER,
  isBatchRuleCode,
  isKnownRuleCode,
  mergeRuleParameters,
  parseRuleConfig,
  ruleParametersFor,
} from "@/lib/combustibles/control/catalogs"
import { nanoid } from "@/lib/id"
import type { ActionState } from "@/lib/validation/masters"
import { FUEL_PATHS } from "@/lib/combustibles/routes"
import { revalidateFuel } from "@/lib/combustibles/revalidate"


/**
 * Lee el formulario. Los parámetros con campo propio (`param:<clave>`) se
 * mezclan en el JSON de «Avanzado» y ganan sobre él; el resto del JSON
 * (excepciones por tipo de equipo, claves propias) se conserva. Si el JSON no
 * se puede leer NO se reemplaza por `{}`: se entrega tal cual para que el
 * esquema lo rechace y quien edita no pierda su configuración sin enterarse.
 */
function readRuleInput(formData: FormData) {
  const code = String(formData.get("code") ?? "")
  const rawConfig = formData.get("config")
  const configText = typeof rawConfig === "string" ? rawConfig : ""
  const base = parseRuleConfig(configText)
  const paramErrors: Record<string, string[]> = {}
  let config = configText

  if (base === null) {
    // Un texto que no es JSON lo rechaza el esquema; uno que es JSON pero no un objeto (p. ej. una lista) lo rechazamos aquí.
    paramErrors.config = ["La configuración debe ser un objeto JSON, p. ej. {\"margin\": 0.05}"]
  } else {
    const parameters = [...ruleParametersFor(code), ...(isBatchRuleCode(code) ? [BATCH_ROW_LIMIT_PARAMETER] : [])]
    const raw: Record<string, string | undefined> = {}
    for (const parameter of parameters) {
      const value = formData.get(`param:${parameter.key}`)
      raw[parameter.key] = typeof value === "string" ? value : undefined
    }
    const merged = mergeRuleParameters(parameters, base, raw)
    for (const [key, message] of Object.entries(merged.errors)) paramErrors[`param:${key}`] = [message]
    config = JSON.stringify(merged.config)
  }

  return {
    data: {
      code,
      name: formData.get("name"),
      description: formData.get("description") || undefined,
      severity: formData.get("severity"),
      isActive: formData.get("isActive") === "on",
      config,
    },
    paramErrors,
  }
}

function invalidInput(parsedError: { flatten: () => { fieldErrors: Record<string, string[] | undefined> } } | null, paramErrors: Record<string, string[]>): ActionState {
  const fieldErrors: Record<string, string[]> = { ...paramErrors }
  if (parsedError) {
    for (const [key, messages] of Object.entries(parsedError.flatten().fieldErrors)) if (messages?.length) fieldErrors[key] = messages
  }
  return { ok: false, message: "Revisa los datos", fieldErrors }
}

export async function createAnomalyRuleAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  let session
  try { session = await requirePermission("combustibles:manage_anomaly_rules", FUEL_PATHS.ajustesReglas) }
  catch { return { ok: false, message: "Sin permisos" } }

  const { data: submitted, paramErrors } = readRuleInput(formData)
  const parsed = anomalyRuleSchema.safeParse(submitted)
  if (!parsed.success || Object.keys(paramErrors).length > 0) return invalidInput(parsed.success ? null : parsed.error, paramErrors)

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
    revalidateFuel()
    return { ok: true, message: "Regla creada", data: { id } }
  } catch (error) {
    logger.error("[createAnomalyRuleAction]", error)
    return { ok: false, message: error instanceof Error && isNetworkError(error) ? "Sin conexión al servidor. Verifica tu conexión a internet e inténtalo nuevamente." : "No se pudo crear la regla" }
  }
}

export async function updateAnomalyRuleAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  let session
  try { session = await requirePermission("combustibles:manage_anomaly_rules", FUEL_PATHS.ajustesReglas) }
  catch { return { ok: false, message: "Sin permisos" } }

  const id = String(formData.get("id") ?? "")
  if (!id) return { ok: false, message: "ID requerido" }
  const { data: submitted, paramErrors } = readRuleInput(formData)
  const parsed = anomalyRuleSchema.safeParse(submitted)
  if (!parsed.success || Object.keys(paramErrors).length > 0) return invalidInput(parsed.success ? null : parsed.error, paramErrors)

  const existing = await db.query.fuelAnomalyRules.findFirst({ where: eq(fuelAnomalyRules.id, id) })
  if (!existing) return { ok: false, message: "Regla no encontrada" }
  // El motor reconoce la regla por su código: cambiarlo en una del catálogo la dejaría inerte.
  if (parsed.data.code !== existing.code && isKnownRuleCode(existing.code)) {
    return { ok: false, message: "El código de una regla del catálogo no se puede cambiar", fieldErrors: { code: ["No se puede cambiar el código de una regla del catálogo"] } }
  }
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
    revalidateFuel()
    return { ok: true, message: "Regla actualizada" }
  } catch (error) {
    logger.error("[updateAnomalyRuleAction]", error)
    return { ok: false, message: error instanceof Error && isNetworkError(error) ? "Sin conexión al servidor. Verifica tu conexión a internet e inténtalo nuevamente." : "No se pudo actualizar la regla" }
  }
}

export async function setAnomalyRuleStatusAction(id: string, isActive: boolean): Promise<ActionState> {
  let session
  try { session = await requirePermission("combustibles:manage_anomaly_rules", FUEL_PATHS.ajustesReglas) }
  catch { return { ok: false, message: "Sin permisos" } }
  const existing = await db.query.fuelAnomalyRules.findFirst({ where: eq(fuelAnomalyRules.id, id) })
  if (!existing) return { ok: false, message: "Regla no encontrada" }
  const nextState = { isActive, updatedAt: new Date().toISOString() }
  try {
    await db.transaction(async (tx) => {
      await tx.update(fuelAnomalyRules).set(nextState).where(eq(fuelAnomalyRules.id, id))
      await recordAudit({ userId: session.user.id, userEmail: session.user.email ?? undefined, action: "update", entityType: "fuel_anomaly_rule", entityId: id, entityCode: existing.code, oldState: { isActive: existing.isActive }, newState: { isActive } }, tx)
    })
    revalidateFuel()
    return { ok: true, message: isActive ? "Regla activada" : "Regla desactivada" }
  } catch (error) {
    logger.error("[setAnomalyRuleStatusAction]", error)
    return { ok: false, message: error instanceof Error && isNetworkError(error) ? "Sin conexión al servidor. Verifica tu conexión a internet e inténtalo nuevamente." : "No se pudo cambiar el estado" }
  }
}
