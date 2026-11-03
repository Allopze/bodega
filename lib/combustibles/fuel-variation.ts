import { FUEL_PRODUCT_IDS, fuelProductIdForLegacy } from "./fuel-products"

export type FuelVariationProduct = "diesel" | "bluemax" | "gasoline" | "kerosene"

export interface FuelVariationRecord {
  id: string
  vehicleId: string
  periodoDesde: string
  cantidad: number
  fuente: string | null
  worksiteId?: string | null
  equipmentTypeSlug?: string | null
  createdAt: string
  updatedAt: string
}

export interface FuelVariationCandidate {
  previous: FuelVariationRecord
  current: FuelVariationRecord
  product: FuelVariationProduct
  changePct: number
  thresholdPct: number
}

const PRODUCT_BY_ID: Record<string, FuelVariationProduct | null> = {
  [FUEL_PRODUCT_IDS.diesel]: "diesel",
  [FUEL_PRODUCT_IDS.bluemax]: "bluemax",
  [FUEL_PRODUCT_IDS.gasoline]: "gasoline",
  [FUEL_PRODUCT_IDS.kerosene]: "kerosene",
  [FUEL_PRODUCT_IDS.historicalUnspecified]: null,
}

export function fuelVariationProductLabel(product: FuelVariationProduct): string {
  switch (product) {
    case "diesel": return "Diesel"
    case "bluemax": return "BlueMax"
    case "gasoline": return "gasolina"
    case "kerosene": return "kerosene"
  }
}

function productOf(source: string | null): FuelVariationProduct | null {
  return PRODUCT_BY_ID[fuelProductIdForLegacy(source)] ?? null
}

export function buildFuelVariationCandidates(
  records: readonly FuelVariationRecord[],
  thresholdFor: (equipmentTypeSlug: string | null) => number,
): {
  candidates: FuelVariationCandidate[]
  unclassifiedRecords: number
  ambiguousPeriods: { vehicleId: string; periodoDesde: string }[]
} {
  const bySeries = new Map<string, { product: FuelVariationProduct; rows: FuelVariationRecord[] }>()
  let unclassifiedRecords = 0
  for (const row of records) {
    const product = productOf(row.fuente)
    if (!product) {
      unclassifiedRecords++
      continue
    }
    const key = `${row.vehicleId}\u0000${product}`
    const series = bySeries.get(key)
    if (series) series.rows.push(row)
    else bySeries.set(key, { product, rows: [row] })
  }

  const candidates: FuelVariationCandidate[] = []
  const ambiguousPeriods: { vehicleId: string; periodoDesde: string }[] = []
  for (const { product, rows } of bySeries.values()) {
    const byPeriod = new Map<string, FuelVariationRecord[]>()
    for (const row of rows) {
      const periodRows = byPeriod.get(row.periodoDesde)
      if (periodRows) periodRows.push(row)
      else byPeriod.set(row.periodoDesde, [row])
    }

    const thresholdPct = thresholdFor(rows[0]?.equipmentTypeSlug ?? null)
    let previous: FuelVariationRecord | null = null
    for (const [periodoDesde, periodRows] of [...byPeriod.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      if (periodRows.length > 1) {
        ambiguousPeriods.push({ vehicleId: periodRows[0]!.vehicleId, periodoDesde })
        // El modelo no da una clave de negocio que permita sumar estas filas y
        // probar que no representan un lote duplicado. El período ambiguo corta
        // la serie para que ninguna fila se elija por el orden de su id.
        previous = null
        continue
      }

      const current = periodRows[0]!
      if (previous && previous.cantidad > 0) {
        const changePct = Math.abs((current.cantidad - previous.cantidad) / previous.cantidad * 100)
        if (changePct >= thresholdPct) candidates.push({ previous, current, product, changePct, thresholdPct })
      }
      previous = current
    }
  }
  ambiguousPeriods.sort((a, b) => a.vehicleId.localeCompare(b.vehicleId) || a.periodoDesde.localeCompare(b.periodoDesde))
  return { candidates, unclassifiedRecords, ambiguousPeriods }
}

export function candidateTouchesCutoff(candidate: FuelVariationCandidate, cutoffMs: number): boolean {
  return [candidate.previous, candidate.current].some((row) =>
    Date.parse(row.createdAt) >= cutoffMs || Date.parse(row.updatedAt) >= cutoffMs,
  )
}

export interface LegacyFuelVariationCase {
  vehicleId: string | null
  referenceEntityId: string | null
  observedValue: string | null
  status?: string | null
}

export interface LegacyFuelVariationReconciliation {
  sameProductMatch: number
  crossProductCandidate: number
  ambiguous: number
  noCorrectedCandidate: number
  total: number
}

export function formatFuelVariationReconciliationReport(input: {
  generatedAt: string
  recordCount: number
  legacyCaseCount: number
  legacyStatusCounts: Record<string, number>
  openQueueCounts: Record<string, number>
  unclassifiedRecords: number
  reconciliation: LegacyFuelVariationReconciliation
}): string {
  const { reconciliation } = input
  const statusLabels: Record<string, string> = {
    open: "Abierto",
    in_review: "En revisión",
    reopened: "Reabierto",
    resolved: "Resuelto",
    dismissed: "Descartado",
  }
  const ruleLabels: Record<string, string> = {
    kilometraje_regresivo: "Regresiones de kilometraje",
    salto_medidor_implausible: "Saltos de medidor",
    variacion_brusca_consumo: "Variaciones bruscas",
  }
  const openQueueTotal = Object.values(input.openQueueCounts).reduce((sum, count) => sum + count, 0)
  return [
    "# Conciliación histórica de variaciones de combustible",
    "",
    `Generado: ${input.generatedAt}`,
    "Alcance: lectura completa del historial; no modifica casos, estados ni registros.",
    "El informe contiene conteos agregados, sin patentes, IDs de filas ni credenciales.",
    "",
    "## Datos revisados",
    "",
    `- Registros de consumo: ${input.recordCount}`,
    `- Casos legados incluidos: ${input.legacyCaseCount}`,
    `- Registros sin producto identificable: ${input.unclassifiedRecords}`,
    "",
    "## Estado de los casos legados incluidos",
    "",
    "| Estado | Casos |",
    "|---|---:|",
    ...Object.entries(input.legacyStatusCounts)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([status, count]) => `| ${statusLabels[status] ?? status} | ${count} |`),
    `| Total | ${input.legacyCaseCount} |`,
    "",
    "## Cola activa al generar el informe",
    "",
    "Incluye casos abiertos, en revisión o reabiertos; la conciliación no cambia estados.",
    "",
    "| Regla | Casos |",
    "|---|---:|",
    ...Object.entries(input.openQueueCounts)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([ruleCode, count]) => `| ${ruleLabels[ruleCode] ?? ruleCode} | ${count} |`),
    `| Total activo | ${openQueueTotal} |`,
    "",
    "## Clasificación de casos legados",
    "",
    "| Categoría | Casos |",
    "|---|---:|",
    `| Coincide con una variación de una serie de producto | ${reconciliation.sameProductMatch} |`,
    `| El porcentaje coincide con la relación Diesel/BlueMax | ${reconciliation.crossProductCandidate} |`,
    `| Ambiguo; requiere revisión | ${reconciliation.ambiguous} |`,
    `| Sin candidato corregido | ${reconciliation.noCorrectedCandidate} |`,
    `| Total | ${reconciliation.total} |`,
    "",
    "Una coincidencia Diesel/BlueMax es evidencia de posible cruce entre productos; por sí sola no confirma que el caso original sea falso.",
    "",
    "## Referencia del snapshot de producción del 2026-11-02",
    "",
    "La revisión previa encontró 149 casos abiertos de variación brusca; 75 referencias legadas coincidían con filas Diesel y BlueMax del mismo vehículo y mes; 46 porcentajes coincidían matemáticamente con una relación entre ambos productos. Son candidatos de conciliación, no resoluciones confirmadas.",
    "",
  ].join("\n")
}

function observedPercent(value: string | null): number | null {
  const number = value?.match(/[+-]?\d+(?:[.,]\d+)?/)?.[0]?.replace(",", ".")
  if (!number) return null
  const parsed = Number(number)
  return Number.isFinite(parsed) ? Math.round(parsed) : null
}

function legacyTarget(row: LegacyFuelVariationCase): { vehicleId: string; period: string } | null {
  const match = row.referenceEntityId?.match(/^([^:]+):(\d{4}-\d{2}-\d{2})$/)
  if (!match?.[1] || !match[2] || (row.vehicleId && row.vehicleId !== match[1])) return null
  return { vehicleId: match[1], period: match[2] }
}

function crossProductRatioMatches(
  records: readonly FuelVariationRecord[],
  vehicleId: string,
  period: string,
  legacyPercent: number | null,
): boolean {
  if (legacyPercent === null) return false
  const current = records.filter((row) => row.vehicleId === vehicleId && row.periodoDesde === period)
  const diesel = current.filter((row) => productOf(row.fuente) === "diesel")
  const bluemax = current.filter((row) => productOf(row.fuente) === "bluemax")
  for (const dieselRow of diesel) {
    for (const blueRow of bluemax) {
      if (dieselRow.cantidad <= 0 || blueRow.cantidad <= 0) continue
      const ratios = [
        Math.round(Math.abs((dieselRow.cantidad - blueRow.cantidad) / dieselRow.cantidad * 100)),
        Math.round(Math.abs((dieselRow.cantidad - blueRow.cantidad) / blueRow.cantidad * 100)),
      ]
      if (ratios.includes(legacyPercent)) return true
    }
  }
  return false
}

export function reconcileLegacyVariationCases(
  cases: readonly LegacyFuelVariationCase[],
  records: readonly FuelVariationRecord[],
  thresholdFor: (equipmentTypeSlug: string | null) => number,
): LegacyFuelVariationReconciliation {
  const { candidates, ambiguousPeriods } = buildFuelVariationCandidates(records, thresholdFor)
  const counts: LegacyFuelVariationReconciliation = {
    sameProductMatch: 0,
    crossProductCandidate: 0,
    ambiguous: 0,
    noCorrectedCandidate: 0,
    total: cases.length,
  }

  for (const anomaly of cases) {
    const target = legacyTarget(anomaly)
    if (!target) {
      counts.ambiguous++
      continue
    }
    if (ambiguousPeriods.some((period) => period.vehicleId === target.vehicleId && period.periodoDesde === target.period)) {
      counts.ambiguous++
      continue
    }
    const percent = observedPercent(anomaly.observedValue)
    const targetCandidates = candidates.filter((candidate) =>
      candidate.current.vehicleId === target.vehicleId && candidate.current.periodoDesde === target.period,
    )
    const productMatch = targetCandidates.some((candidate) => Math.round(candidate.changePct) === percent)
    const crossProductMatch = crossProductRatioMatches(records, target.vehicleId, target.period, percent)

    if (productMatch && crossProductMatch) counts.ambiguous++
    else if (crossProductMatch) counts.crossProductCandidate++
    else if (productMatch) counts.sameProductMatch++
    else if (targetCandidates.length > 0 || records.some((row) => row.vehicleId === target.vehicleId && row.periodoDesde === target.period && !productOf(row.fuente))) counts.ambiguous++
    else counts.noCorrectedCandidate++
  }
  return counts
}
