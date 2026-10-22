import { eq } from "drizzle-orm"
import { z } from "zod"
import { db, type DB, type Tx } from "@/db"
import { fuelAnomalyRules, systemSettings } from "@/db/schema"
import { recordAudit } from "@/lib/audit"
import { configOf, thresholdStdDevsOf } from "@/lib/combustibles/anomaly-detector"
import {
  DEFAULT_PERFORMANCE_CONTROL_SETTINGS,
  PERFORMANCE_SETTINGS_KEY,
  type PerformanceControlSettings,
} from "./contracts"

/**
 * Umbrales del control de rendimiento.
 *
 * Muestras mínimas, cotas físicas y ventana de duplicados viven en
 * `system_settings` (clave `combustibles.control.performance`, JSON). El k de
 * atípicos NO se duplica: sale de la regla de anomalías existente
 * `rendimiento_fuera_historico`, con sus excepciones por tipo de equipo
 * (`config.equipmentTypes[slug].thresholdStdDevs`). Guardar el k actualiza esa
 * regla, así el detector batch y el control nunca discrepan.
 */

export const PERFORMANCE_RULE_CODE = "rendimiento_fuera_historico"

export const performanceControlSettingsSchema = z.object({
  thresholdStdDevs: z.number({ error: "El umbral de desviaciones debe ser un número" })
    .min(0.5, "El umbral de desviaciones debe ser al menos 0,5").max(10, "El umbral de desviaciones no puede superar 10"),
  minSamples: z.number({ error: "Las muestras mínimas deben ser un número" })
    .int("Las muestras mínimas deben ser un número entero").min(2, "Se necesitan al menos 2 muestras").max(100, "Las muestras mínimas no pueden superar 100"),
  maxKmPerLiter: z.number({ error: "El máximo de km/L debe ser un número" })
    .positive("El máximo de km/L debe ser mayor que cero").max(200, "El máximo de km/L no puede superar 200"),
  maxLitersPerHour: z.number({ error: "El máximo de L/h debe ser un número" })
    .positive("El máximo de L/h debe ser mayor que cero").max(2000, "El máximo de L/h no puede superar 2.000"),
  duplicateWindowMinutes: z.number({ error: "La ventana de duplicados debe ser un número" })
    .int("La ventana de duplicados debe estar en minutos enteros").min(1, "La ventana de duplicados debe ser de al menos 1 minuto").max(1440, "La ventana de duplicados no puede superar 24 horas"),
  duplicateLitersTolerance: z.number({ error: "La tolerancia de litros debe ser un número" })
    .min(0, "La tolerancia de litros no puede ser negativa").max(100, "La tolerancia de litros no puede superar 100 L"),
})

type ReadClient = Pick<DB, "select">

/** Lee el JSON guardado campo a campo: un campo inválido vuelve a su valor por defecto sin arrastrar a los demás. */
export function mergeStoredSettings(raw: string | null | undefined): PerformanceControlSettings {
  const merged: PerformanceControlSettings = { ...DEFAULT_PERFORMANCE_CONTROL_SETTINGS }
  if (!raw) return merged
  let parsed: unknown
  try { parsed = JSON.parse(raw) } catch { return merged }
  if (!parsed || typeof parsed !== "object") return merged
  const shape = performanceControlSettingsSchema.shape
  for (const key of Object.keys(shape) as Array<keyof PerformanceControlSettings>) {
    const result = shape[key].safeParse((parsed as Record<string, unknown>)[key])
    if (result.success) merged[key] = result.data
  }
  return merged
}

/** k para un tipo de equipo: excepción de la regla para ese slug, o el k general. */
export function thresholdForEquipmentType(
  settings: PerformanceControlSettings,
  ruleConfig: string | null | undefined,
  equipmentTypeSlug: string | null | undefined,
): number {
  return thresholdStdDevsOf({ config: ruleConfig ?? null }, settings.thresholdStdDevs, equipmentTypeSlug ?? undefined)
}

export interface PerformanceControlContext {
  settings: PerformanceControlSettings
  /** JSON de la regla `rendimiento_fuera_historico` (null si no está sembrada). */
  ruleConfig: string | null
}

export async function loadPerformanceControlContext(client: ReadClient = db): Promise<PerformanceControlContext> {
  const [stored, rule] = await Promise.all([
    client.select({ value: systemSettings.value }).from(systemSettings).where(eq(systemSettings.key, PERFORMANCE_SETTINGS_KEY)).limit(1),
    client.select({ config: fuelAnomalyRules.config }).from(fuelAnomalyRules).where(eq(fuelAnomalyRules.code, PERFORMANCE_RULE_CODE)).limit(1),
  ])
  const settings = mergeStoredSettings(stored[0]?.value)
  const ruleConfig = rule[0]?.config ?? null
  // El k general de la regla manda sobre el guardado en la clave de ajustes.
  settings.thresholdStdDevs = thresholdStdDevsOf({ config: ruleConfig }, settings.thresholdStdDevs)
  return { settings, ruleConfig }
}

export async function getPerformanceControlSettings(client: ReadClient = db): Promise<PerformanceControlSettings> {
  return (await loadPerformanceControlContext(client)).settings
}

/** Valida, guarda y audita. Lanza `Error` con mensaje en español si la entrada no es válida. */
export async function savePerformanceControlSettings(
  tx: Tx,
  input: PerformanceControlSettings,
  actor: { userId: string; userEmail?: string | null },
): Promise<void> {
  const parsed = performanceControlSettingsSchema.safeParse(input)
  if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? "Configuración de rendimiento inválida")
  const next = parsed.data
  const { settings: previous, ruleConfig } = await loadPerformanceControlContext(tx)
  const now = new Date().toISOString()

  await tx.insert(systemSettings)
    .values({ key: PERFORMANCE_SETTINGS_KEY, value: JSON.stringify(next), updatedAt: now })
    .onConflictDoUpdate({ target: systemSettings.key, set: { value: JSON.stringify(next), updatedAt: now } })

  // Si la regla no está sembrada, el k queda solo en la clave de ajustes (y se lee de ahí).
  const config = { ...configOf({ config: ruleConfig }), thresholdStdDevs: next.thresholdStdDevs }
  await tx.update(fuelAnomalyRules)
    .set({ config: JSON.stringify(config), updatedAt: now })
    .where(eq(fuelAnomalyRules.code, PERFORMANCE_RULE_CODE))

  await recordAudit({
    userId: actor.userId,
    userEmail: actor.userEmail ?? undefined,
    action: "update",
    entityType: "fuel_control_settings",
    entityId: PERFORMANCE_SETTINGS_KEY,
    oldState: { ...previous },
    newState: { ...next },
  }, tx)
}
