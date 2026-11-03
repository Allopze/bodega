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
): { candidates: FuelVariationCandidate[]; unclassifiedRecords: number } {
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
  for (const { product, rows } of bySeries.values()) {
    rows.sort((a, b) => a.periodoDesde.localeCompare(b.periodoDesde) || a.id.localeCompare(b.id))
    const thresholdPct = thresholdFor(rows[0]?.equipmentTypeSlug ?? null)
    for (let index = 1; index < rows.length; index++) {
      const previous = rows[index - 1]!
      const current = rows[index]!
      // Si una fuente entrega más de una fila para el mismo vehículo, producto
      // y período, no hay un período anterior que comparar en ese borde.
      if (previous.periodoDesde === current.periodoDesde || previous.cantidad <= 0) continue
      const changePct = Math.abs((current.cantidad - previous.cantidad) / previous.cantidad * 100)
      if (changePct >= thresholdPct) candidates.push({ previous, current, product, changePct, thresholdPct })
    }
  }
  return { candidates, unclassifiedRecords }
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
  const { candidates } = buildFuelVariationCandidates(records, thresholdFor)
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
