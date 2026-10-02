/**
 * Filtros de la matriz en la URL (spec §3). Las claves no chocan con las del
 * programa (`q`, `estado`, `frecuencia`), que comparte la misma URL.
 */
import { activeFilterCount, EMPTY_FILTERS, type GridFilters } from "./grid-view"
import { CLASSIFICATION_LABEL, RISK_CLASSIFICATIONS, type RiskClassification } from "./methodology"
import { CONTROLLED_STATUS_LABEL } from "./snapshot"

export const MATRIX_FILTER_KEYS = ["buscar", "clasificacion", "completitud", "controlado", "factor", "marca"] as const
export type MatrixFilterKey = typeof MATRIX_FILTER_KEYS[number]
export type MatrixFilterChip = { key: MatrixFilterKey; label: string; value: string; displayValue: string }

const csv = (value: string | null) => (value ?? "").split(",").map((item) => item.trim()).filter(Boolean)

export function parseMatrixFilters(params: { get(key: string): string | null }): GridFilters {
  const classifications = [...new Set(csv(params.get("clasificacion")))]
    .filter((value): value is RiskClassification => (RISK_CLASSIFICATIONS as readonly string[]).includes(value))
  const controlled = params.get("controlado")
  const completeness = params.get("completitud")
  const marks = csv(params.get("marca"))
  return {
    ...EMPTY_FILTERS,
    search: (params.get("buscar") ?? "").slice(0, 200),
    classifications,
    controlled: controlled === "yes" || controlled === "partial" || controlled === "no" ? controlled : "all",
    factorId: params.get("factor") || "all",
    onlyObserved: marks.includes("observados"),
    onlyModified: marks.includes("modificados"),
    onlyIncomplete: completeness === "pendientes",
    onlyComplete: completeness === "completos",
  }
}

export function matrixFilterPatch(filters: GridFilters): Record<MatrixFilterKey, string | null> {
  const marks = [filters.onlyObserved ? "observados" : null, filters.onlyModified ? "modificados" : null].filter(Boolean).join(",")
  return {
    buscar: filters.search.trim() || null,
    clasificacion: filters.classifications.length ? filters.classifications.join(",") : null,
    completitud: filters.onlyIncomplete ? "pendientes" : filters.onlyComplete ? "completos" : null,
    controlado: filters.controlled === "all" ? null : filters.controlled,
    factor: filters.factorId === "all" ? null : filters.factorId,
    marca: marks || null,
  }
}

export function hasEntryFilters(filters: GridFilters): boolean {
  return activeFilterCount(filters) > 0
}

export function matrixFilterChips(filters: GridFilters, factors: ReadonlyArray<{ id: string; name: string }>): MatrixFilterChip[] {
  const chips: MatrixFilterChip[] = []
  if (filters.search.trim()) chips.push({ key: "buscar", label: "Búsqueda", value: filters.search, displayValue: `«${filters.search.trim()}»` })
  if (filters.classifications.length) chips.push({ key: "clasificacion", label: "Clasificación", value: filters.classifications.join(","), displayValue: filters.classifications.map((c) => CLASSIFICATION_LABEL[c]).join(", ") })
  if (filters.onlyIncomplete || filters.onlyComplete) chips.push({ key: "completitud", label: "Estado", value: filters.onlyIncomplete ? "pendientes" : "completos", displayValue: filters.onlyIncomplete ? "Con pendientes" : "Completos" })
  if (filters.controlled !== "all") chips.push({ key: "controlado", label: "¿Controlado?", value: filters.controlled, displayValue: CONTROLLED_STATUS_LABEL[filters.controlled] })
  if (filters.factorId !== "all") chips.push({ key: "factor", label: "Factor", value: filters.factorId, displayValue: factors.find((factor) => factor.id === filters.factorId)?.name ?? "Factor" })
  if (filters.onlyObserved || filters.onlyModified) chips.push({ key: "marca", label: "Marcas", value: "", displayValue: [filters.onlyObserved && "Observados", filters.onlyModified && "Modificados"].filter(Boolean).join(", ") })
  return chips
}
