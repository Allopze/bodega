/**
 * Motor de detección batch de anomalías (sección 11).
 *
 * Cada función de detección escanea una fuente de datos específica
 * y crea casos para reglas que no se disparan inline durante la revisión TAE.
 * Se ejecuta como proceso batch — no dentro del request HTTP.
 */

import { and, desc, eq, gt, inArray, isNotNull, isNull, ne, sql } from "drizzle-orm"
import { db } from "@/db"
import {
  fuelAnomalyExecutions, fuelAnomalyRules,
  fuelConsumptionRecords, fuelEquipmentTypes, fuelLoads, fuelMeterReadings, fuelOperationRecords,
  fuelTaeSubmissions, fuelVehicleOperationalIntervals, fuelVehicles,
} from "@/db/schema"
import { nanoid } from "@/lib/id"
import { todayInChile } from "@/lib/utils"
import { createAnomalyCase, type AnomalySeverity } from "./anomaly-cases"
import { detectCorruptEvidence, getReusedEvidence } from "./evidence-management"
import { fuelOperationOccurredAtSql } from "./fuel-log"
import { accountableFuelLoadsWhere } from "./load-status"
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

export interface BatchRuleResult {
  ruleCode: string
  created: number
  skipped: number
  /** Distingue "corrió y no encontró nada" de "reventó" — antes ambos casos
   *  volvían `{created:0, skipped:0}` y el cron respondía 200 aunque las 8
   *  reglas hubieran fallado (CO-029/CO-039). `no_detector` es una regla activa
   *  sin detector batch registrado (config huérfana, no un fallo de ejecución). */
  status: "completed" | "failed" | "no_detector"
}

/** Ejecuta todas las reglas batch activas. Cada regla se ejecuta en secuencia,
 *  registrando la ejecución y los casos creados. */
export async function runAllBatchRules(): Promise<BatchRuleResult[]> {
  const rules = await db.select().from(fuelAnomalyRules).where(eq(fuelAnomalyRules.isActive, true))
  const results: BatchRuleResult[] = []

  for (const rule of rules) {
    const execId = nanoid()
    await db.insert(fuelAnomalyExecutions).values({
      id: execId, ruleId: rule.id, status: "running", casesCreated: 0, casesSkipped: 0, totalScanned: 0,
    })

    try {
      const detector = BATCH_DETECTORS[rule.code]
      if (!detector) {
        await db.update(fuelAnomalyExecutions).set({ status: "completed", completedAt: new Date().toISOString() }).where(eq(fuelAnomalyExecutions.id, execId))
        results.push({ ruleCode: rule.code, created: 0, skipped: 0, status: "no_detector" })
        continue
      }

      const { created, skipped, scanned } = await detector(rule)
      await db.update(fuelAnomalyExecutions).set({
        status: "completed", completedAt: new Date().toISOString(),
        casesCreated: created, casesSkipped: skipped, totalScanned: scanned,
      }).where(eq(fuelAnomalyExecutions.id, execId))
      results.push({ ruleCode: rule.code, created, skipped, status: "completed" })
    } catch (error) {
      await db.update(fuelAnomalyExecutions).set({
        status: "failed", error: String(error), completedAt: new Date().toISOString(),
      }).where(eq(fuelAnomalyExecutions.id, execId))
      results.push({ ruleCode: rule.code, created: 0, skipped: 0, status: "failed" })
    }
  }
  return results
}

type DetectorFn = (rule: { id: string; code: string; config: string | null; severity?: string | null }) => Promise<{ created: number; skipped: number; scanned: number }>

/**
 * La severidad configurada en la regla gobierna el caso.
 *
 * El formulario de reglas ofrece elegirla, pero cada detector escribía un
 * literal: cambiarla en pantalla no movía ni un caso. El literal queda como
 * valor por omisión para una regla sin severidad válida.
 */
export function severityOf(rule: { severity?: string | null }, fallback: AnomalySeverity): AnomalySeverity {
  const value = rule.severity
  return value === "low" || value === "medium" || value === "high" || value === "critical" ? value : fallback
}

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
    // Sin ORDER BY, qué filas caían dentro del LIMIT era arbitrario — el mismo
    // vehículo podía tener suficiente muestra (≥ minSample) en una corrida y no
    // en la siguiente, sin que cambiara ni un dato real (CO-029/CO-039).
    .orderBy(fuelOperationRecords.vehicleId, fuelOperationRecords.id)
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
        const outcome = await createAnomalyCase({
          ruleId: rule.id, ruleCode: "rendimiento_fuera_historico", severity: severityOf(rule, "high"),
          worksiteId: row.worksiteId ?? undefined, vehicleId: row.vehicleId,
          referenceEntityType: "fuel_operation_record", referenceEntityId: row.id,
          description: `Rendimiento de ${row.plate} (${row.rendimiento}) se aparta más de ${perVehicleThreshold} desviaciones estándar de su propio historial.`,
          observedValue: String(row.rendimiento),
        })
        if (outcome.wasCreated) created++; else skipped++
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
    // Tipo de equipo MÁS FRECUENTE del grupo, no el de la primera fila que
    // devuelva Postgres (sin ORDER BY, ese orden es arbitrario y podía
    // cambiar entre corridas). Un `comparisonGroup` puede mezclar tipos de
    // equipo; con la mayoría se acierta más veces que con una fila al azar.
    const slugCounts = new Map<string, number>()
    for (const row of rows) {
      if (!row.equipmentTypeSlug) continue
      slugCounts.set(row.equipmentTypeSlug, (slugCounts.get(row.equipmentTypeSlug) ?? 0) + 1)
    }
    let vehicleSlug: string | undefined
    let topCount = 0
    for (const [slug, count] of slugCounts) {
      if (count > topCount) { vehicleSlug = slug; topCount = count }
    }
    const perGroupThreshold = thresholdStdDevsOf(rule, DEFAULT_OUTLIER_THRESHOLD_STDDEVS, vehicleSlug)
    const flagged = flagOutliers(rows, (r) => r.rendimiento, perGroupThreshold)
    for (const row of flagged) {
      if (!row.atipico) continue
      scanned++
      try {
        const outcome = await createAnomalyCase({
          ruleId: rule.id, ruleCode: "rendimiento_fuera_grupo", severity: severityOf(rule, "medium"),
          worksiteId: row.worksiteId ?? undefined, vehicleId: row.vehicleId,
          referenceEntityType: "fuel_operation_record", referenceEntityId: row.id,
          description: `Rendimiento de ${row.plate} (${row.rendimiento}) se aparta más de ${perGroupThreshold} desviaciones estándar de su grupo comparable ("${row.comparisonGroup}").`,
          observedValue: String(row.rendimiento),
        })
        if (outcome.wasCreated) created++; else skipped++
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

    // Escanear TAE. Se excluyen las cargas anuladas: una carga corregida por
    // anulación seguía generando un caso crítico contra un dato ya descartado.
    // `gt` y no `gte`: el caso dice "supera la capacidad", no "la alcanza".
    const taeRows = await db.select({ id: fuelTaeSubmissions.id, liters: fuelTaeSubmissions.liters })
      .from(fuelTaeSubmissions).where(and(
        eq(fuelTaeSubmissions.vehicleId, v.vehicleId),
        ne(fuelTaeSubmissions.status, "voided"),
        gt(fuelTaeSubmissions.liters, sql`${threshold}`),
      ))
    for (const row of taeRows) {
      scanned++
      try {
        const outcome = await createAnomalyCase({
          ruleId: rule.id, ruleCode: "litros_supera_capacidad", severity: severityOf(rule, "critical"),
          worksiteId: v.worksiteId, vehicleId: v.vehicleId,
          referenceEntityType: "fuel_tae_submission", referenceEntityId: row.id,
          description: `${Number(row.liters).toLocaleString("es-CL")} L supera la capacidad declarada de ${Number(v.tankCapacityLiters).toLocaleString("es-CL")} L (+${Math.round(margin * 100)}% margen) para el equipo ${v.plate}.`,
          observedValue: String(row.liters), expectedValue: `≤ ${Number(v.tankCapacityLiters)} L`,
        })
        if (outcome.wasCreated) created++; else skipped++
      } catch { skipped++ }
    }
  }
  return { created, skipped, scanned }
}

/** Detectar variación brusca de consumo entre períodos consecutivos. */
const detectSharpConsumptionChange: DetectorFn = async (rule) => {
  const rowLimit = batchRowLimitOf(rule, BATCH_SCAN_ROW_LIMIT)
  let created = 0, skipped = 0, scanned = 0

  // Acotar por VEHÍCULO, no por fila cruda: un LIMIT plano sobre filas podía
  // partir la secuencia de un vehículo a la mitad (comparación de borde
  // incompleta) y, peor, dejar vehículos enteros sin analizar según dónde
  // cayera el corte alfabético de su id — ningún vehículo real se acerca al
  // techo, así que en la práctica esto no limita nada todavía (CO-029/CO-039).
  const vehicleIdsInWindow = await db.selectDistinct({ vehicleId: fuelConsumptionRecords.vehicleId })
    .from(fuelConsumptionRecords)
    .where(isNotNull(fuelConsumptionRecords.vehicleId))
    .orderBy(fuelConsumptionRecords.vehicleId)
    .limit(rowLimit)
  const vehicleIdsToScan = vehicleIdsInWindow.map((row) => row.vehicleId).filter((id): id is string => !!id)

  // Escanear consumo TCT: comparar cada patente+período con el período anterior
  const periods = vehicleIdsToScan.length === 0 ? [] : await db.select({
    vehicleId: fuelConsumptionRecords.vehicleId,
    periodoDesde: fuelConsumptionRecords.periodoDesde,
    cantidad: fuelConsumptionRecords.cantidadUnidad,
    worksiteId: fuelConsumptionRecords.worksiteId,
    equipmentTypeSlug: fuelEquipmentTypes.slug,
  })
    .from(fuelConsumptionRecords)
    .leftJoin(fuelVehicles, eq(fuelConsumptionRecords.vehicleId, fuelVehicles.id))
    .leftJoin(fuelEquipmentTypes, eq(fuelVehicles.equipmentTypeId, fuelEquipmentTypes.id))
    // Sin filtro de cantidad mínima: el guard de línea `prev.cantidad <= 0` de
    // abajo ya protege la división, y el `gte(cantidadUnidad, 1)` que había
    // aquí saltaba los períodos de consumo casi nulo — con eso, un vehículo con
    // junio=4.000L, julio=0,5L, agosto=3.900L comparaba junio contra agosto
    // como si fueran consecutivos y nunca detectaba ni la caída ni el rebote.
    .where(inArray(fuelConsumptionRecords.vehicleId, vehicleIdsToScan))
    .orderBy(fuelConsumptionRecords.vehicleId, fuelConsumptionRecords.periodoDesde)

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
          const outcome = await createAnomalyCase({
            ruleId: rule.id, ruleCode: "variacion_brusca_consumo", severity: severityOf(rule, "medium"),
            worksiteId: curr.worksiteId ?? undefined, vehicleId: curr.vehicleId ?? undefined,
            // Singular, como los otros 5 detectores: en plural, `fuelLogEntityType()`
            // (fuel-log.ts) nunca lo emite y el enlace "Abrir caso relacionado" no matcheaba.
            referenceEntityType: "fuel_consumption_record", referenceEntityId: `${curr.vehicleId}:${curr.periodoDesde}`,
            description: `Consumo varió ${Math.round(pct)}% respecto al período anterior (${Number(curr.cantidad).toLocaleString("es-CL")} L vs ${Number(prev.cantidad).toLocaleString("es-CL")} L).`,
            observedValue: `+${Math.round(pct)}%`,            expectedValue: `< ${perVehicleThreshold}%`,
          })
          if (outcome.wasCreated) created++; else skipped++
        } catch { skipped++ }
      }
    }
  }
  return { created, skipped, scanned }
}

/**
 * Detectar consumo durante inactividad del equipo.
 *
 * Antes buscaba CUALQUIER carga TAE histórica del vehículo (sin ventana de
 * fecha, sin excluir anuladas) y, si existía una sola, abría caso — para
 * SIEMPRE: `referenceEntityId` incluye la fecha de hoy justamente para poder
 * resurgir en la corrida siguiente, así que un equipo con una carga de hace
 * tres años (de cuando sí operaba) generaba un caso nuevo cada día,
 * indefinidamente. Ahora se acota al intervalo de inactividad VIGENTE
 * (`fuel_vehicle_operational_intervals`, `endedAt IS NULL` = el intervalo
 * abierto actual — a lo más uno por vehículo, por el UNIQUE de la tabla):
 * sólo cuenta actividad ocurrida DESPUÉS de que el equipo dejó de operar.
 */
const detectConsumptionWhileInactive: DetectorFn = async (rule) => {
  let created = 0, skipped = 0, scanned = 0

  // Equipos inactivos
  const inactive = await db.select({ vehicleId: fuelVehicles.id, plate: fuelVehicles.plate, worksiteId: fuelVehicles.worksiteId, operationalStatus: fuelVehicles.operationalStatus })
    .from(fuelVehicles).where(ne(fuelVehicles.operationalStatus, "operativo"))

  const today = todayInChile()
  for (const v of inactive) {
    const [interval] = await db.select({ startedAt: fuelVehicleOperationalIntervals.startedAt })
      .from(fuelVehicleOperationalIntervals)
      .where(and(eq(fuelVehicleOperationalIntervals.vehicleId, v.vehicleId), isNull(fuelVehicleOperationalIntervals.endedAt)))
      .orderBy(desc(fuelVehicleOperationalIntervals.startedAt))
      .limit(1)
    // Sin intervalo registrado no hay desde-cuándo confiable: no se inventa
    // una ventana arbitraria, se salta (el estado sigue viéndose en /flota).
    if (!interval) continue

    const rows = await db.select({ id: fuelTaeSubmissions.id })
      .from(fuelTaeSubmissions)
      .where(and(
        eq(fuelTaeSubmissions.vehicleId, v.vehicleId),
        ne(fuelTaeSubmissions.status, "voided"),
        gt(fuelTaeSubmissions.loadedAt, interval.startedAt),
      ))
      .limit(1)
    if (rows.length === 0) continue
    scanned++
    try {
      // referenceEntityId incluye la fecha: a diferencia de las demás reglas batch (que
      // referencian un registro histórico inmutable), ésta vigila una condición vigente
      // — debe poder resurgir en una corrida futura aunque el caso de hoy se haya descartado.
      const outcome = await createAnomalyCase({
        ruleId: rule.id, ruleCode: "consumo_durante_inactividad", severity: severityOf(rule, "high"),
        worksiteId: v.worksiteId ?? undefined, vehicleId: v.vehicleId,
        referenceEntityType: "fuel_vehicle", referenceEntityId: `${v.vehicleId}:${today}`,
        description: `El equipo ${v.plate} está en estado "${v.operationalStatus}" desde ${interval.startedAt.slice(0, 10)} y tiene cargas registradas después de esa fecha.`,
        observedValue: "inactivo con cargas",
      })
      if (outcome.wasCreated) created++; else skipped++
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
    // Mismo motivo que getOperationPerformanceObservations: sin orden, el
    // recorte del LIMIT era arbitrario entre corridas (CO-029/CO-039).
    .orderBy(fuelLoads.vehicleId, fuelLoads.id)
    .limit(rowLimit)

  for (const row of rows) {
    if (row.fuelSupplierId === row.usualFuelSupplierId) continue
    scanned++
    try {
      const outcome = await createAnomalyCase({
        ruleId: rule.id, ruleCode: "proveedor_no_habitual", severity: severityOf(rule, "low"),
        worksiteId: row.worksiteId, vehicleId: row.vehicleId,
        referenceEntityType: "fuel_load", referenceEntityId: row.loadId,
        description: `Carga de ${row.plate} facturada con un proveedor distinto del habitual declarado para el equipo.`,
        observedValue: row.fuelSupplierId, expectedValue: row.usualFuelSupplierId ?? undefined,
      })
      if (outcome.wasCreated) created++; else skipped++
    } catch { skipped++ }
  }
  return { created, skipped, scanned }
}

/** Detectar evidencia reutilizada entre cargas (mismo SHA-256 en más de una carga). */
const detectDuplicateEvidenceRule: DetectorFn = async (rule) => {
  let created = 0, skipped = 0, scanned = 0
  const reused = await getReusedEvidence(batchRowLimitOf(rule, BATCH_SCAN_ROW_LIMIT))

  for (const [hash, items] of reused) {
    scanned++
    const submissionIds = [...new Set(items.map((i) => i.submissionId))]
    const submissions = await db.select({ id: fuelTaeSubmissions.id, worksiteId: fuelTaeSubmissions.worksiteId, vehicleId: fuelTaeSubmissions.vehicleId })
      .from(fuelTaeSubmissions).where(inArray(fuelTaeSubmissions.id, submissionIds))
    const first = submissions[0]
    try {
      const outcome = await createAnomalyCase({
        ruleId: rule.id, ruleCode: "evidencia_duplicada", severity: severityOf(rule, "low"),
        worksiteId: first?.worksiteId ?? undefined, vehicleId: first?.vehicleId ?? undefined,
        referenceEntityType: "fuel_tae_evidence_hash", referenceEntityId: hash,
        description: `La misma fotografía (SHA-256 ${hash.slice(0, 12)}…) aparece en ${submissionIds.length} cargas distintas: ${submissionIds.join(", ")}.`,
        observedValue: `${submissionIds.length} cargas`, expectedValue: "1 carga",
      })
      if (outcome.wasCreated) created++; else skipped++
    } catch { skipped++ }
  }
  return { created, skipped, scanned }
}

/** Detectar evidencia ilegible o corrupta (tamaño 0, MIME no imagen, sin archivo). */
const detectCorruptEvidenceRule: DetectorFn = async (rule) => {
  let created = 0, skipped = 0, scanned = 0
  const corrupt = await detectCorruptEvidence(batchRowLimitOf(rule, BATCH_SCAN_ROW_LIMIT))

  for (const item of corrupt) {
    scanned++
    const [submission] = await db.select({ worksiteId: fuelTaeSubmissions.worksiteId, vehicleId: fuelTaeSubmissions.vehicleId })
      .from(fuelTaeSubmissions).where(eq(fuelTaeSubmissions.id, item.submissionId)).limit(1)
    try {
      const outcome = await createAnomalyCase({
        ruleId: rule.id, ruleCode: "evidencia_ilegible", severity: severityOf(rule, "medium"),
        worksiteId: submission?.worksiteId ?? undefined, vehicleId: submission?.vehicleId ?? undefined,
        referenceEntityType: "fuel_tae_evidence", referenceEntityId: item.evidenceId,
        description: `Evidencia "${item.fileName ?? item.evidenceId}" ilegible: ${item.reason}.`,
        observedValue: item.reason,
      })
      if (outcome.wasCreated) created++; else skipped++
    } catch { skipped++ }
  }
  return { created, skipped, scanned }
}

/**
 * Par consecutivo (misma serie, ya ordenada cronológicamente) donde la lectura
 * baja respecto a la anterior. Agrupa por vehículo preservando el orden de
 * llegada — asume que `rows` ya viene ordenado por vehículo y luego por
 * instante real (a cargo de cada consulta que lo use).
 */
function consecutiveMeterPairs<T>(
  rows: T[],
  seriesKey: (row: T) => string | null,
  getValue: (row: T) => number | null,
): Array<{ prev: T; curr: T }> {
  const bySeries = new Map<string, T[]>()
  for (const row of rows) {
    const key = seriesKey(row)
    if (!key || getValue(row) == null) continue
    bySeries.set(key, [...(bySeries.get(key) ?? []), row])
  }
  const pairs: Array<{ prev: T; curr: T }> = []
  for (const [, group] of bySeries) {
    for (let i = 1; i < group.length; i++) pairs.push({ prev: group[i - 1]!, curr: group[i]! })
  }
  return pairs
}

function flagRegressivePairs<T extends { vehicleId: string | null }>(
  rows: T[],
  getValue: (row: T) => number | null,
): Array<{ prev: T; curr: T }> {
  return consecutiveMeterPairs(rows, (row) => row.vehicleId, getValue)
    .filter(({ prev, curr }) => getValue(curr)! < getValue(prev)!)
}

/**
 * Detectar lectura regresiva de odómetro/horómetro más allá de TAE.
 *
 * `detectTaeAnomaliesInTx` (fuel-tae.ts) ya detecta esto, pero sólo se dispara
 * al validar/observar una carga TAE puntual y sólo compara contra otras cargas
 * TAE — una carga manual (`fuel_loads`) o el log operacional
 * (`fuel_operation_records`) con un medidor reemplazado/reseteado no generaba
 * ningún caso (CO-023). Reutiliza el mismo `ruleCode` que TAE
 * (`kilometraje_regresivo`/`horometro_regresivo`): `referenceEntityType` ya
 * distingue la fuente, así que un caso resuelto/descartado como "reset
 * aceptado" queda visible desde el mismo lugar sin importar de dónde vino.
 *
 * `kilometraje_regresivo` y `horometro_regresivo` son dos reglas (dos filas en
 * `fuel_anomaly_rules`, cada una con su propio `id`/severidad); de ahí el
 * factory — cada detector registrado debe atribuir sus casos al `rule.id` que
 * lo invocó, no mezclar ambos bajo uno solo.
 */
function makeRegressiveMeterDetector(meterType: "km" | "hora"): DetectorFn {
  const ruleCode = meterType === "hora" ? "horometro_regresivo" : "kilometraje_regresivo"
  const meterLabel = meterType === "hora" ? "de horómetro" : "de odómetro"
  return async (rule) => {
    const rowLimit = batchRowLimitOf(rule, BATCH_SCAN_ROW_LIMIT)
    let created = 0, skipped = 0, scanned = 0

    // Log operacional: horometro + medidoPor (km|hora) en una sola columna.
    const opRows = await db.select({
      id: fuelOperationRecords.id, vehicleId: fuelOperationRecords.vehicleId,
      worksiteId: fuelOperationRecords.worksiteId, horometro: fuelOperationRecords.horometro,
      plate: fuelVehicles.plate,
    })
      .from(fuelOperationRecords)
      .innerJoin(fuelVehicles, eq(fuelOperationRecords.vehicleId, fuelVehicles.id))
      .where(and(
        eq(fuelOperationRecords.medidoPor, meterType),
        isNotNull(fuelOperationRecords.horometro),
      ))
      .orderBy(fuelOperationRecords.vehicleId, fuelOperationOccurredAtSql(), fuelOperationRecords.createdAt)
      .limit(rowLimit)

    for (const { prev, curr } of flagRegressivePairs(opRows, (r) => Number(r.horometro))) {
      scanned++
      try {
        const outcome = await createAnomalyCase({
          ruleId: rule.id, ruleCode, severity: severityOf(rule, "high"),
          worksiteId: curr.worksiteId ?? undefined, vehicleId: curr.vehicleId ?? undefined,
          referenceEntityType: "fuel_operation_record", referenceEntityId: curr.id,
          description: `Lectura ${meterLabel} (${curr.horometro}) del log operacional de ${curr.plate} es menor que la carga anterior (${prev.horometro}).`,
          observedValue: String(curr.horometro), expectedValue: `> ${prev.horometro}`,
        })
        if (outcome.wasCreated) created++; else skipped++
      } catch { skipped++ }
    }

    // Cargas manuales: odómetro y horómetro son columnas separadas.
    const readingColumn = meterType === "hora" ? fuelLoads.hourMeterReading : fuelLoads.odometerReading
    const loadRows = await db.select({
      id: fuelLoads.id, vehicleId: fuelLoads.vehicleId, worksiteId: fuelLoads.worksiteId,
      reading: readingColumn, plate: fuelVehicles.plate,
    })
      .from(fuelLoads)
      .innerJoin(fuelVehicles, eq(fuelLoads.vehicleId, fuelVehicles.id))
      .where(and(isNotNull(readingColumn), accountableFuelLoadsWhere()))
      .orderBy(fuelLoads.vehicleId, fuelLoads.loadDate, fuelLoads.createdAt)
      .limit(rowLimit)

    for (const { prev, curr } of flagRegressivePairs(loadRows, (r) => Number(r.reading))) {
      scanned++
      try {
        const outcome = await createAnomalyCase({
          ruleId: rule.id, ruleCode, severity: severityOf(rule, "high"),
          worksiteId: curr.worksiteId ?? undefined, vehicleId: curr.vehicleId ?? undefined,
          referenceEntityType: "fuel_load", referenceEntityId: curr.id,
          description: `Lectura ${meterLabel} (${curr.reading}) de la carga de ${curr.plate} es menor que la carga anterior (${prev.reading}).`,
          observedValue: String(curr.reading), expectedValue: `> ${prev.reading}`,
        })
        if (outcome.wasCreated) created++; else skipped++
      } catch { skipped++ }
    }

    // Detalle del proveedor: una fila por transacción, con el odómetro que el
    // operario tipeó en el surtidor. Es la fuente donde el error de dedo aparece
    // de verdad —en la muestra real, 27 de 249 pares consecutivos retroceden— y
    // la única que hasta ahora no miraba nadie.
    for (const { prev, curr } of providerReadingPairs(await meterReadingRows(meterType, rowLimit))
      .filter(({ prev, curr }) => curr.value < prev.value)) {
      scanned++
      try {
        const outcome = await createAnomalyCase({
          ruleId: rule.id, ruleCode, severity: severityOf(rule, "high"),
          worksiteId: curr.worksiteId ?? undefined, vehicleId: curr.vehicleId ?? undefined,
          referenceEntityType: "fuel_meter_reading", referenceEntityId: curr.id,
          description: `Lectura ${meterLabel} (${curr.value}) de la carga de ${curr.plate} en ${curr.stationName ?? "estación no informada"} es menor que la carga anterior (${prev.value}).`,
          observedValue: String(curr.value), expectedValue: `> ${prev.value}`,
        })
        if (outcome.wasCreated) created++; else skipped++
      } catch { skipped++ }
    }

    return { created, skipped, scanned }
  }
}

/** Serie del detalle de proveedor para un tipo de medidor, ya ordenada. */
async function meterReadingRows(meterType: "km" | "hora", rowLimit: number) {
  return db.select({
    id: fuelMeterReadings.id,
    vehicleId: fuelMeterReadings.vehicleId,
    source: fuelMeterReadings.source,
    value: fuelMeterReadings.value,
    occurredAt: fuelMeterReadings.occurredAt,
    stationName: fuelMeterReadings.stationName,
    plate: fuelVehicles.plate,
    worksiteId: fuelVehicles.worksiteId,
    equipmentTypeSlug: fuelEquipmentTypes.slug,
  })
    .from(fuelMeterReadings)
    .innerJoin(fuelVehicles, eq(fuelMeterReadings.vehicleId, fuelVehicles.id))
    .leftJoin(fuelEquipmentTypes, eq(fuelVehicles.equipmentTypeId, fuelEquipmentTypes.id))
    .where(eq(fuelMeterReadings.meterType, meterType === "hora" ? "hour_meter" : "odometer"))
    // La serie es por equipo Y por fuente: el odómetro que reporta Copec y el que
    // reporta Aramco son el mismo medidor físico, pero cada portal arrastra su
    // propio desfase, así que compararlos entre sí inventa saltos que no existen.
    .orderBy(fuelMeterReadings.vehicleId, fuelMeterReadings.source, fuelMeterReadings.occurredAt)
    .limit(rowLimit)
}

type MeterReadingRow = Awaited<ReturnType<typeof meterReadingRows>>[number]

function providerReadingPairs(rows: MeterReadingRow[]): Array<{ prev: MeterReadingRow; curr: MeterReadingRow }> {
  return consecutiveMeterPairs(rows, (row) => `${row.vehicleId}::${row.source}`, (row) => row.value)
}

/**
 * Salto de medidor imposible para el tiempo transcurrido.
 *
 * La regla regresiva sólo mira hacia abajo, y la mitad del problema va hacia
 * arriba: un dígito de más (100.000 tecleado como 1.000.000) pasa limpio, y la
 * carga SIGUIENTE a una lectura baja aparece con un salto enorme que infla el
 * recorrido calculado. En la muestra real hay 18 saltos sobre 5.000 km entre
 * cargas consecutivas.
 *
 * El umbral es una tasa y no un delta fijo: dos cargas separadas por un mes
 * admiten un recorrido que dos del mismo día no. Un par dentro del mismo día
 * cuenta como un día — es el piso, no una división por cero.
 */
const detectImplausibleMeterJump: DetectorFn = async (rule) => {
  const rowLimit = batchRowLimitOf(rule, BATCH_SCAN_ROW_LIMIT)
  let created = 0, skipped = 0, scanned = 0

  for (const meterType of ["km", "hora"] as const) {
    const unit = meterType === "hora" ? "h" : "km"
    const meterLabel = meterType === "hora" ? "de horómetro" : "de odómetro"
    for (const { prev, curr } of providerReadingPairs(await meterReadingRows(meterType, rowLimit))) {
      const delta = curr.value - prev.value
      if (delta <= 0) continue   // el retroceso es asunto de la regla regresiva
      const days = elapsedDays(prev.occurredAt, curr.occurredAt)
      const rate = delta / days
      const maxPerDay = maxMeterRatePerDayOf(rule, meterType, curr.equipmentTypeSlug ?? undefined)
      if (rate <= maxPerDay) continue

      scanned++
      try {
        const outcome = await createAnomalyCase({
          ruleId: rule.id, ruleCode: "salto_medidor_implausible", severity: severityOf(rule, "high"),
          worksiteId: curr.worksiteId ?? undefined, vehicleId: curr.vehicleId ?? undefined,
          referenceEntityType: "fuel_meter_reading", referenceEntityId: curr.id,
          description: `Lectura ${meterLabel} de ${curr.plate} sube ${Math.round(delta).toLocaleString("es-CL")} ${unit} en ${days} día(s) (${Math.round(rate).toLocaleString("es-CL")} ${unit}/día): supera lo posible para el equipo.`,
          observedValue: String(curr.value), expectedValue: `≤ ${Math.round(prev.value + maxPerDay * days)}`,
        })
        if (outcome.wasCreated) created++; else skipped++
      } catch { skipped++ }
    }
  }
  return { created, skipped, scanned }
}

/** Días calendario entre dos instantes, con piso de 1: dos cargas del mismo día
 *  no dividen por cero, y un salto grande entre ellas sigue siendo implausible. */
function elapsedDays(from: string, to: string): number {
  const ms = new Date(to).getTime() - new Date(from).getTime()
  if (!Number.isFinite(ms)) return 1
  return Math.max(1, Math.round(ms / 86_400_000))
}

/**
 * Techo de avance diario del medidor. `maxKmPerDay` para odómetro y
 * `maxHoursPerDay` para horómetro, ambos con override por tipo de equipo.
 *
 * Los valores por omisión son cotas físicas, no metas de operación: 1.500 km en
 * un día es más de lo que rinde un camión conduciendo sin parar, y un motor no
 * puede acumular más de 24 horas por día.
 */
function maxMeterRatePerDayOf(rule: { config: string | null }, meterType: "km" | "hora", equipmentTypeSlug?: string): number {
  const key = meterType === "hora" ? "maxHoursPerDay" : "maxKmPerDay"
  const fallback = meterType === "hora" ? 24 : 1_500
  const cfg = configOf(rule)
  if (equipmentTypeSlug) {
    const override = readEqTypeOverride(cfg, equipmentTypeSlug, key)
    if (typeof override === "number" && override > 0) return override
  }
  if (typeof cfg[key] === "number" && (cfg[key] as number) > 0) return cfg[key] as number
  return fallback
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
  kilometraje_regresivo: makeRegressiveMeterDetector("km"),
  horometro_regresivo: makeRegressiveMeterDetector("hora"),
  salto_medidor_implausible: detectImplausibleMeterJump,
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
