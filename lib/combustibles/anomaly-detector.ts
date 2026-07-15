/**
 * Motor de detección batch de anomalías (sección 11).
 *
 * Cada función de detección escanea una fuente de datos específica
 * y crea casos para reglas que no se disparan inline durante la revisión TAE.
 * Se ejecuta como proceso batch — no dentro del request HTTP.
 */

import { and, eq, gte, inArray, isNotNull, ne, sql } from "drizzle-orm"
import { db } from "@/db"
import {
  fuelAnomalyExecutions, fuelAnomalyRules,
  fuelConsumptionRecords, fuelEquipmentTypes, fuelLoads, fuelOperationRecords,
  fuelTaeSubmissions, fuelVehicles,
} from "@/db/schema"
import { nanoid } from "@/lib/id"
import { createAnomalyCase } from "./anomaly-cases"
import { detectCorruptEvidence, getReusedEvidence } from "./evidence-management"
import { DEFAULT_OUTLIER_THRESHOLD_STDDEVS, MIN_CONCLUSIVE_SAMPLE, flagOutliers } from "./performance-statistics"

/** Techo defensivo para los escaneos sin ventana de fecha (sección 18). No hay volumen de
 *  producción con el que calibrarlo todavía; el valor es deliberadamente alto — sólo debe
 *  actuar como freno de emergencia contra un table scan sin límite, no como paginación real.
 *  ponytail: recalibrar (o mover a ventana temporal por consulta) cuando exista medición real. */
const BATCH_SCAN_ROW_LIMIT = 50_000

export const configOf = (rule: { config: string | null }): Record<string, unknown> => {
  try { return rule.config ? JSON.parse(rule.config) : {} } catch { return {} }
}

/** Buscar un override por tipo de equipo en `config.equipmentTypes[slug][key]`.
 *  Los detectores batch pueden definir umbrales distintos por tipo de equipo
 *  en el JSON de configuración de la regla, sin necesidad de crear una regla
 *  por cada combinación. Ejemplo de config:
 *  ```json
 *  { "thresholdPct": 50, "equipmentTypes": { "cargadora_frontal": { "thresholdPct": 30 } } }
 *  ``` */
function readEqTypeOverride(cfg: Record<string, unknown>, slug: string, key: string): unknown {
  const eqTypes = cfg["equipmentTypes"]
  if (!eqTypes || typeof eqTypes !== "object") return undefined
  const typeCfg = (eqTypes as Record<string, unknown>)[slug]
  if (!typeCfg || typeof typeCfg !== "object") return undefined
  return (typeCfg as Record<string, unknown>)[key]
}

/** Leer `minSample` del config de la regla, con fallback a la constante global. */
function minSampleOf(rule: { config: string | null }, globalDefault: number): number {
  const cfg = configOf(rule)
  if (typeof cfg["minSample"] === "number" && cfg["minSample"] >= 3) return cfg["minSample"] as number
  return globalDefault
}

/** Leer `batchRowLimit` del config de la regla, con fallback a la constante global.
 *  Cada regla puede definir su propio límite de filas a escanear en lugar del default genérico. */
function batchRowLimitOf(rule: { config: string | null }, globalDefault: number): number {
  const cfg = configOf(rule)
  if (typeof cfg["batchRowLimit"] === "number" && cfg["batchRowLimit"] >= 100) return cfg["batchRowLimit"] as number
  return globalDefault
}

/** Leer `thresholdPct` del config de la regla (variación brusca de consumo), con fallback.
 *  Si se provee `equipmentTypeSlug`, busca primero un override en `config.equipmentTypes[slug].thresholdPct`. */
export function thresholdPctOf(rule: { config: string | null }, globalDefault: number, equipmentTypeSlug?: string): number {
  const cfg = configOf(rule)
  if (equipmentTypeSlug) {
    const override = readEqTypeOverride(cfg, equipmentTypeSlug, "thresholdPct")
    if (typeof override === "number" && override >= 1) return override
  }
  if (typeof cfg["thresholdPct"] === "number" && cfg["thresholdPct"] >= 1) return cfg["thresholdPct"] as number
  return globalDefault
}

/** Leer `margin` del config de la regla (margen sobre capacidad), con fallback.
 *  Si se provee `equipmentTypeSlug`, busca primero un override en `config.equipmentTypes[slug].margin`. */
export function marginOf(rule: { config: string | null }, globalDefault: number, equipmentTypeSlug?: string): number {
  const cfg = configOf(rule)
  if (equipmentTypeSlug) {
    const override = readEqTypeOverride(cfg, equipmentTypeSlug, "margin")
    if (typeof override === "number" && override >= 0) return override
  }
  if (typeof cfg["margin"] === "number" && cfg["margin"] >= 0) return cfg["margin"] as number
  return globalDefault
}

/** Leer `windowHours` del config de la regla (ventana temporal), con fallback.
 *  Si se provee `equipmentTypeSlug`, busca primero un override en `config.equipmentTypes[slug].windowHours`. */
export function windowHoursOf(rule: { config: string | null }, globalDefault: number, equipmentTypeSlug?: string): number {
  const cfg = configOf(rule)
  if (equipmentTypeSlug) {
    const override = readEqTypeOverride(cfg, equipmentTypeSlug, "windowHours")
    if (typeof override === "number" && override >= 1) return override
  }
  if (typeof cfg["windowHours"] === "number" && cfg["windowHours"] >= 1) return cfg["windowHours"] as number
  return globalDefault
}

/** Leer `thresholdStdDevs` del config de la regla (umbral de desviaciones estándar para outlier), con fallback.
 *  Si se provee `equipmentTypeSlug`, busca primero un override en `config.equipmentTypes[slug].thresholdStdDevs`. */
export function thresholdStdDevsOf(rule: { config: string | null }, globalDefault: number, equipmentTypeSlug?: string): number {
  const cfg = configOf(rule)
  if (equipmentTypeSlug) {
    const override = readEqTypeOverride(cfg, equipmentTypeSlug, "thresholdStdDevs")
    if (typeof override === "number" && override >= 0.1) return override
  }
  if (typeof cfg["thresholdStdDevs"] === "number" && cfg["thresholdStdDevs"] >= 0.1) return cfg["thresholdStdDevs"] as number
  return globalDefault
}

/** Leer `maxLoads` del config de la regla (máximo de cargas permitidas en una ventana), con fallback.
 *  Si se provee `equipmentTypeSlug`, busca primero un override en `config.equipmentTypes[slug].maxLoads`. */
export function maxLoadsOf(rule: { config: string | null }, globalDefault: number, equipmentTypeSlug?: string): number {
  const cfg = configOf(rule)
  if (equipmentTypeSlug) {
    const override = readEqTypeOverride(cfg, equipmentTypeSlug, "maxLoads")
    if (typeof override === "number" && override >= 1) return override
  }
  if (typeof cfg["maxLoads"] === "number" && cfg["maxLoads"] >= 1) return cfg["maxLoads"] as number
  return globalDefault
}

/** Leer `requiredKinds` del config de la regla y devolver la cantidad de elementos esperados,
 *  con fallback. Usado por el detector inline `evidencia_faltante`. */
export function requiredEvidenceCountOf(rule: { config: string | null }, globalDefault: number): number {
  const kinds = configOf(rule)["requiredKinds"]
  return Array.isArray(kinds) ? kinds.length : globalDefault
}

/** Ejecuta todas las reglas batch activas. Cada regla se ejecuta en secuencia,
 *  registrando la ejecución y los casos creados. */
export async function runAllBatchRules(): Promise<Array<{ ruleCode: string; created: number; skipped: number }>> {
  const rules = await db.select().from(fuelAnomalyRules).where(eq(fuelAnomalyRules.isActive, true))
  const results: Array<{ ruleCode: string; created: number; skipped: number }> = []

  for (const rule of rules) {
    const execId = nanoid()
    await db.insert(fuelAnomalyExecutions).values({
      id: execId, ruleId: rule.id, status: "running", casesCreated: 0, casesSkipped: 0, totalScanned: 0,
    })

    try {
      const detector = BATCH_DETECTORS[rule.code]
      if (!detector) {
        await db.update(fuelAnomalyExecutions).set({ status: "completed", completedAt: new Date().toISOString() }).where(eq(fuelAnomalyExecutions.id, execId))
        results.push({ ruleCode: rule.code, created: 0, skipped: 0 })
        continue
      }

      const { created, skipped, scanned } = await detector(rule)
      await db.update(fuelAnomalyExecutions).set({
        status: "completed", completedAt: new Date().toISOString(),
        casesCreated: created, casesSkipped: skipped, totalScanned: scanned,
      }).where(eq(fuelAnomalyExecutions.id, execId))
      results.push({ ruleCode: rule.code, created, skipped })
    } catch (error) {
      await db.update(fuelAnomalyExecutions).set({
        status: "failed", error: String(error), completedAt: new Date().toISOString(),
      }).where(eq(fuelAnomalyExecutions.id, execId))
      results.push({ ruleCode: rule.code, created: 0, skipped: 0 })
    }
  }
  return results
}

type DetectorFn = (rule: { id: string; code: string; config: string | null }) => Promise<{ created: number; skipped: number; scanned: number }>

/**
 * Observaciones de rendimiento con id de fila propio, para las reglas de
 * outlier. Sólo el log operacional (`fuel_operation_records`) tiene una fila
 * por transacción con id propio; TCT sólo tiene rendimiento agregado por
 * período (`fuel_consumption_records`, sin una "carga" individual que
 * referenciar) y TAE no calcula rendimiento en absoluto (ver el comentario
 * en `equipment-performance.ts`) — por eso estas dos reglas sólo cubren el
 * log operacional, no las tres fuentes.
 */
async function getOperationPerformanceObservations(rowLimit: number) {
  const rows = await db.select({
    id: fuelOperationRecords.id, vehicleId: fuelVehicles.id, plate: fuelVehicles.plate,
    worksiteId: fuelOperationRecords.worksiteId, comparisonGroup: fuelVehicles.comparisonGroup,
    performanceUnit: fuelVehicles.performanceUnit, rendimiento: fuelOperationRecords.rendimiento,
    equipmentTypeSlug: fuelEquipmentTypes.slug,
  })
    .from(fuelOperationRecords)
    .innerJoin(fuelVehicles, eq(fuelOperationRecords.vehicleId, fuelVehicles.id))
    .leftJoin(fuelEquipmentTypes, eq(fuelVehicles.equipmentTypeId, fuelEquipmentTypes.id))
    .where(and(isNotNull(fuelOperationRecords.rendimiento), sql`${fuelVehicles.performanceUnit} <> 'not_applicable'`))
    .limit(rowLimit)
  return rows.filter((r) => Number(r.rendimiento) > 0).map((r) => ({ ...r, rendimiento: Number(r.rendimiento) }))
}

/** Detectar rendimiento fuera del historial propio del equipo (outlier dentro de sus propias observaciones). */
const detectPerformanceOutlierHistory: DetectorFn = async (rule) => {
  let created = 0, skipped = 0, scanned = 0
  const minSample = minSampleOf(rule, MIN_CONCLUSIVE_SAMPLE)
  const rowLimit = batchRowLimitOf(rule, BATCH_SCAN_ROW_LIMIT)
  const observations = await getOperationPerformanceObservations(rowLimit)

  const byVehicle = new Map<string, typeof observations>()
  for (const obs of observations) byVehicle.set(obs.vehicleId, [...(byVehicle.get(obs.vehicleId) ?? []), obs])

  for (const [, rows] of byVehicle) {
    if (rows.length < minSample) continue
    const vehicleSlug = rows[0]?.equipmentTypeSlug ?? undefined
    const perVehicleThreshold = thresholdStdDevsOf(rule, DEFAULT_OUTLIER_THRESHOLD_STDDEVS, vehicleSlug)
    const flagged = flagOutliers(rows, (r) => r.rendimiento, perVehicleThreshold)
    for (const row of flagged) {
      if (!row.atipico) continue
      scanned++
      try {
        await createAnomalyCase({
          ruleId: rule.id, ruleCode: "rendimiento_fuera_historico", severity: "high",
          worksiteId: row.worksiteId ?? undefined, vehicleId: row.vehicleId,
          referenceEntityType: "fuel_operation_record", referenceEntityId: row.id,
          description: `Rendimiento de ${row.plate} (${row.rendimiento}) se aparta más de ${perVehicleThreshold} desviaciones estándar de su propio historial.`,
          observedValue: String(row.rendimiento),
        })
        created++
      } catch { skipped++ }
    }
  }
  return { created, skipped, scanned }
}

/** Detectar rendimiento fuera del grupo comparable (outlier dentro del pool de equipos con el mismo `comparisonGroup`). */
const detectPerformanceOutlierGroup: DetectorFn = async (rule) => {
  let created = 0, skipped = 0, scanned = 0
  const minSample = minSampleOf(rule, MIN_CONCLUSIVE_SAMPLE)
  const rowLimit = batchRowLimitOf(rule, BATCH_SCAN_ROW_LIMIT)
  const observations = (await getOperationPerformanceObservations(rowLimit)).filter((o) => o.comparisonGroup)

  const byGroup = new Map<string, typeof observations>()
  for (const obs of observations) {
    const key = `${obs.comparisonGroup}::${obs.performanceUnit}`
    byGroup.set(key, [...(byGroup.get(key) ?? []), obs])
  }

  for (const [, rows] of byGroup) {
    if (rows.length < minSample) continue
    const vehicleSlug = rows[0]?.equipmentTypeSlug ?? undefined
    const perGroupThreshold = thresholdStdDevsOf(rule, DEFAULT_OUTLIER_THRESHOLD_STDDEVS, vehicleSlug)
    const flagged = flagOutliers(rows, (r) => r.rendimiento, perGroupThreshold)
    for (const row of flagged) {
      if (!row.atipico) continue
      scanned++
      try {
        await createAnomalyCase({
          ruleId: rule.id, ruleCode: "rendimiento_fuera_grupo", severity: "medium",
          worksiteId: row.worksiteId ?? undefined, vehicleId: row.vehicleId,
          referenceEntityType: "fuel_operation_record", referenceEntityId: row.id,
          description: `Rendimiento de ${row.plate} (${row.rendimiento}) se aparta más de ${perGroupThreshold} desviaciones estándar de su grupo comparable ("${row.comparisonGroup}").`,
          observedValue: String(row.rendimiento),
        })
        created++
      } catch { skipped++ }
    }
  }
  return { created, skipped, scanned }
}

/** Detectar litros superiores a capacidad del estanque. */
const detectLitersExceedCapacity: DetectorFn = async (rule) => {
  const vehicles = await db.select({
    vehicleId: fuelVehicles.id, plate: fuelVehicles.plate,
    tankCapacityLiters: fuelVehicles.tankCapacityLiters,
    worksiteId: fuelVehicles.worksiteId,
    equipmentTypeSlug: fuelEquipmentTypes.slug,
  }).from(fuelVehicles)
    .leftJoin(fuelEquipmentTypes, eq(fuelVehicles.equipmentTypeId, fuelEquipmentTypes.id))
    .where(isNotNull(fuelVehicles.tankCapacityLiters))

  let created = 0, skipped = 0, scanned = 0

  for (const v of vehicles) {
    if (!v.tankCapacityLiters) continue
    const margin = marginOf(rule, 0.05, v.equipmentTypeSlug ?? undefined)
    const threshold = Number(v.tankCapacityLiters) * (1 + margin)

    // Escanear TAE
    const taeRows = await db.select({ id: fuelTaeSubmissions.id, liters: fuelTaeSubmissions.liters })
      .from(fuelTaeSubmissions).where(and(eq(fuelTaeSubmissions.vehicleId, v.vehicleId), gte(fuelTaeSubmissions.liters, sql`${threshold}`)))
    for (const row of taeRows) {
      scanned++
      try {
        await createAnomalyCase({
          ruleId: rule.id, ruleCode: "litros_supera_capacidad", severity: "critical",
          worksiteId: v.worksiteId, vehicleId: v.vehicleId,
          referenceEntityType: "fuel_tae_submission", referenceEntityId: row.id,
          description: `${Number(row.liters).toLocaleString("es-CL")} L supera la capacidad declarada de ${Number(v.tankCapacityLiters).toLocaleString("es-CL")} L (+${Math.round(margin * 100)}% margen) para el equipo ${v.plate}.`,
          observedValue: String(row.liters), expectedValue: `≤ ${Number(v.tankCapacityLiters)} L`,
        })
        created++
      } catch { skipped++ }
    }
  }
  return { created, skipped, scanned }
}

/** Detectar variación brusca de consumo entre períodos consecutivos. */
const detectSharpConsumptionChange: DetectorFn = async (rule) => {
  const rowLimit = batchRowLimitOf(rule, BATCH_SCAN_ROW_LIMIT)
  let created = 0, skipped = 0, scanned = 0

  // Escanear consumo TCT: comparar cada patente+período con el período anterior
  const periods = await db.select({
    vehicleId: fuelConsumptionRecords.vehicleId,
    periodoDesde: fuelConsumptionRecords.periodoDesde,
    cantidad: fuelConsumptionRecords.cantidadUnidad,
    worksiteId: fuelConsumptionRecords.worksiteId,
    equipmentTypeSlug: fuelEquipmentTypes.slug,
  })
    .from(fuelConsumptionRecords)
    .leftJoin(fuelVehicles, eq(fuelConsumptionRecords.vehicleId, fuelVehicles.id))
    .leftJoin(fuelEquipmentTypes, eq(fuelVehicles.equipmentTypeId, fuelEquipmentTypes.id))
    .where(and(isNotNull(fuelConsumptionRecords.vehicleId), gte(fuelConsumptionRecords.cantidadUnidad, 1)))
    .orderBy(fuelConsumptionRecords.vehicleId, fuelConsumptionRecords.periodoDesde)
    .limit(rowLimit)

  // Agrupar por vehicleId
  const byVehicle = new Map<string, typeof periods>()
  for (const row of periods) byVehicle.set(row.vehicleId!, [...(byVehicle.get(row.vehicleId!) ?? []), row])

  for (const [, rows] of byVehicle) {
    const vehicleSlug = rows[0]?.equipmentTypeSlug ?? undefined
    const perVehicleThreshold = thresholdPctOf(rule, 50, vehicleSlug)
    for (let i = 1; i < rows.length; i++) {
      const prev = rows[i - 1]!
      const curr = rows[i]!
      if (!prev || !curr || prev.cantidad <= 0) continue
      const pct = Math.abs((curr.cantidad - prev.cantidad) / prev.cantidad * 100)
      if (pct >= perVehicleThreshold) {
        scanned++
        try {
          await createAnomalyCase({
            ruleId: rule.id, ruleCode: "variacion_brusca_consumo", severity: "medium",
            worksiteId: curr.worksiteId ?? undefined, vehicleId: curr.vehicleId ?? undefined,
            referenceEntityType: "fuel_consumption_records", referenceEntityId: `${curr.vehicleId}:${curr.periodoDesde}`,
            description: `Consumo varió ${Math.round(pct)}% respecto al período anterior (${Number(curr.cantidad).toLocaleString("es-CL")} L vs ${Number(prev.cantidad).toLocaleString("es-CL")} L).`,
            observedValue: `+${Math.round(pct)}%`,            expectedValue: `< ${perVehicleThreshold}%`,
          })
          created++
        } catch { skipped++ }
      }
    }
  }
  return { created, skipped, scanned }
}

/** Detectar consumo durante inactividad del equipo. */
const detectConsumptionWhileInactive: DetectorFn = async (rule) => {
  let created = 0, skipped = 0, scanned = 0

  // Equipos inactivos
  const inactive = await db.select({ vehicleId: fuelVehicles.id, plate: fuelVehicles.plate, worksiteId: fuelVehicles.worksiteId, operationalStatus: fuelVehicles.operationalStatus })
    .from(fuelVehicles).where(ne(fuelVehicles.operationalStatus, "operativo"))

  const today = new Date().toISOString().slice(0, 10)
  for (const v of inactive) {
    const rows = await db.select({ id: fuelTaeSubmissions.id })
      .from(fuelTaeSubmissions).where(eq(fuelTaeSubmissions.vehicleId, v.vehicleId)).limit(1)
    if (rows.length === 0) continue
    scanned++
    try {
      // referenceEntityId incluye la fecha: a diferencia de las demás reglas batch (que
      // referencian un registro histórico inmutable), ésta vigila una condición vigente
      // — debe poder resurgir en una corrida futura aunque el caso de hoy se haya descartado.
      await createAnomalyCase({
        ruleId: rule.id, ruleCode: "consumo_durante_inactividad", severity: "high",
        worksiteId: v.worksiteId ?? undefined, vehicleId: v.vehicleId,
        referenceEntityType: "fuel_vehicle", referenceEntityId: `${v.vehicleId}:${today}`,
        description: `El equipo ${v.plate} está en estado "${v.operationalStatus}" y tiene cargas registradas.`,
        observedValue: "inactivo con cargas",
      })
      created++
    } catch { skipped++ }
  }
  return { created, skipped, scanned }
}

/** Detectar cargas facturadas (TCT/TAE) con un proveedor distinto del habitual del equipo.
 *  Sólo aplica a `fuel_loads` (facturación): la PWA TAE no registra proveedor por carga. */
const detectUnusualSupplier: DetectorFn = async (rule) => {
  const rowLimit = batchRowLimitOf(rule, BATCH_SCAN_ROW_LIMIT)
  let created = 0, skipped = 0, scanned = 0

  const rows = await db.select({
    loadId: fuelLoads.id, worksiteId: fuelLoads.worksiteId, vehicleId: fuelLoads.vehicleId,
    fuelSupplierId: fuelLoads.fuelSupplierId, plate: fuelVehicles.plate,
    usualFuelSupplierId: fuelVehicles.usualFuelSupplierId,
  })
    .from(fuelLoads)
    .innerJoin(fuelVehicles, eq(fuelLoads.vehicleId, fuelVehicles.id))
    .where(isNotNull(fuelVehicles.usualFuelSupplierId))
    .limit(rowLimit)

  for (const row of rows) {
    if (row.fuelSupplierId === row.usualFuelSupplierId) continue
    scanned++
    try {
      await createAnomalyCase({
        ruleId: rule.id, ruleCode: "proveedor_no_habitual", severity: "low",
        worksiteId: row.worksiteId, vehicleId: row.vehicleId,
        referenceEntityType: "fuel_load", referenceEntityId: row.loadId,
        description: `Carga de ${row.plate} facturada con un proveedor distinto del habitual declarado para el equipo.`,
        observedValue: row.fuelSupplierId, expectedValue: row.usualFuelSupplierId ?? undefined,
      })
      created++
    } catch { skipped++ }
  }
  return { created, skipped, scanned }
}

/** Detectar evidencia reutilizada entre cargas (mismo SHA-256 en más de una carga). */
const detectDuplicateEvidenceRule: DetectorFn = async (rule) => {
  let created = 0, skipped = 0, scanned = 0
  const reused = await getReusedEvidence()

  for (const [hash, items] of reused) {
    scanned++
    const submissionIds = [...new Set(items.map((i) => i.submissionId))]
    const submissions = await db.select({ id: fuelTaeSubmissions.id, worksiteId: fuelTaeSubmissions.worksiteId, vehicleId: fuelTaeSubmissions.vehicleId })
      .from(fuelTaeSubmissions).where(inArray(fuelTaeSubmissions.id, submissionIds))
    const first = submissions[0]
    try {
      await createAnomalyCase({
        ruleId: rule.id, ruleCode: "evidencia_duplicada", severity: "low",
        worksiteId: first?.worksiteId ?? undefined, vehicleId: first?.vehicleId ?? undefined,
        referenceEntityType: "fuel_tae_evidence_hash", referenceEntityId: hash,
        description: `La misma fotografía (SHA-256 ${hash.slice(0, 12)}…) aparece en ${submissionIds.length} cargas distintas: ${submissionIds.join(", ")}.`,
        observedValue: `${submissionIds.length} cargas`, expectedValue: "1 carga",
      })
      created++
    } catch { skipped++ }
  }
  return { created, skipped, scanned }
}

/** Detectar evidencia ilegible o corrupta (tamaño 0, MIME no imagen, sin archivo). */
const detectCorruptEvidenceRule: DetectorFn = async (rule) => {
  let created = 0, skipped = 0, scanned = 0
  const corrupt = await detectCorruptEvidence()

  for (const item of corrupt) {
    scanned++
    const [submission] = await db.select({ worksiteId: fuelTaeSubmissions.worksiteId, vehicleId: fuelTaeSubmissions.vehicleId })
      .from(fuelTaeSubmissions).where(eq(fuelTaeSubmissions.id, item.submissionId)).limit(1)
    try {
      await createAnomalyCase({
        ruleId: rule.id, ruleCode: "evidencia_ilegible", severity: "medium",
        worksiteId: submission?.worksiteId ?? undefined, vehicleId: submission?.vehicleId ?? undefined,
        referenceEntityType: "fuel_tae_evidence", referenceEntityId: item.evidenceId,
        description: `Evidencia "${item.fileName ?? item.evidenceId}" ilegible: ${item.reason}.`,
        observedValue: item.reason,
      })
      created++
    } catch { skipped++ }
  }
  return { created, skipped, scanned }
}

const BATCH_DETECTORS: Record<string, DetectorFn> = {
  litros_supera_capacidad: detectLitersExceedCapacity,
  variacion_brusca_consumo: detectSharpConsumptionChange,
  consumo_durante_inactividad: detectConsumptionWhileInactive,
  evidencia_duplicada: detectDuplicateEvidenceRule,
  evidencia_ilegible: detectCorruptEvidenceRule,
  proveedor_no_habitual: detectUnusualSupplier,
  rendimiento_fuera_historico: detectPerformanceOutlierHistory,
  rendimiento_fuera_grupo: detectPerformanceOutlierGroup,
}

import { KNOWN_RULE_CODES } from "./validation"
export { KNOWN_RULE_CODES }

/** Guard runtime: si una clave de `BATCH_DETECTORS` falta en `KNOWN_RULE_CODES`
 *  (definido en `validation.ts`), alguien olvidó actualizar la lista compartida
 *  después de añadir un nuevo detector batch. El error se dispara en server startup
 *  y tests, no en producción (console.warn + no throw para evitar cascada). */
{
  const missing = Object.keys(BATCH_DETECTORS).filter((k) => !KNOWN_RULE_CODES.includes(k as (typeof KNOWN_RULE_CODES)[number]))
  if (missing.length > 0) {
    console.warn(
      `[anomaly-detector] Batch detectors sin código en KNOWN_RULE_CODES: ${missing.join(", ")}.\n` +
      "Agrega los códigos faltantes a export const KNOWN_RULE_CODES en lib/combustibles/validation.ts " +
      "para que los Client Components puedan importarlos sin arrastrar db."
    )
  }
}
