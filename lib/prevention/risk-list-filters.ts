/**
 * Filtros rápidos de la vista matriz MIPER (§83 de la ficha). Espejo de
 * `capa-list-filters.ts`: sólo el catálogo — la condición SQL vive en
 * `listRiskEntriesPage` (lib/services/prevention-risk-legal.ts), server-side,
 * porque una matriz real supera las 200 filas y no tiene sentido traerlas
 * todas al cliente para filtrar.
 */
export const RISK_QUICK_FILTERS = [
  "all",
  "intolerable",
  "importante",
  "sin_control",
  "sin_responsable",
] as const

export type RiskQuickFilter = typeof RISK_QUICK_FILTERS[number]

export const RISK_QUICK_FILTER_LABELS: Record<Exclude<RiskQuickFilter, "all">, string> = {
  intolerable: "Intolerables",
  importante: "Importantes",
  sin_control: "Sin medidas de control",
  sin_responsable: "Sin responsable",
}

export function isRiskQuickFilter(value: string | null | undefined): value is RiskQuickFilter {
  return RISK_QUICK_FILTERS.includes(value as RiskQuickFilter)
}
