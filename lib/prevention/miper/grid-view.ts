import { CLASSIFICATION_LABEL, RISK_CLASSIFICATIONS, type RiskClassification } from "./methodology"
import { normalizeMiperName } from "./names"
import type { ControlledStatus, MiperEntrySnapshot } from "./snapshot"

export type GridFilters = {
  search: string
  classifications: RiskClassification[]
  controlled: ControlledStatus | "all"
  factorId: string
  onlyObserved: boolean
  onlyModified: boolean
  /** Filas con datos que bloquean el envío a revisión. */
  onlyIncomplete: boolean
  /** Filas sin datos que bloquean el envío a revisión. */
  onlyComplete: boolean
}
export const EMPTY_FILTERS: GridFilters = { search: "", classifications: [], controlled: "all", factorId: "all", onlyObserved: false, onlyModified: false, onlyIncomplete: false, onlyComplete: false }
export type GroupBy = "none" | "activity" | "position" | "classification"

export function activeFilterCount(filters: GridFilters) {
  return (filters.search ? 1 : 0) + (filters.classifications.length ? 1 : 0) + (filters.controlled !== "all" ? 1 : 0)
    + (filters.factorId !== "all" ? 1 : 0) + (filters.onlyObserved ? 1 : 0) + (filters.onlyModified ? 1 : 0) + (filters.onlyIncomplete ? 1 : 0) + (filters.onlyComplete ? 1 : 0)
}

export function filterRows(rows: MiperEntrySnapshot[], filters: GridFilters, ctx: { observed: ReadonlySet<string>; modified: ReadonlySet<string>; incomplete?: ReadonlySet<string> }) {
  const needle = normalizeMiperName(filters.search)
  return rows.filter((row) => {
    if (needle) {
      const haystack = normalizeMiperName([row.activity, row.task, row.position, row.location, row.hazard, row.risk, row.probableDamage, ...row.controls.map((c) => c.description)].filter(Boolean).join(" "))
      if (!haystack.includes(needle)) return false
    }
    if (filters.classifications.length && (!row.classification || !filters.classifications.includes(row.classification))) return false
    if (filters.controlled !== "all" && row.controlledStatus !== filters.controlled) return false
    if (filters.factorId !== "all" && row.riskFactorId !== filters.factorId) return false
    if (filters.onlyObserved && !ctx.observed.has(row.id)) return false
    if (filters.onlyModified && !ctx.modified.has(row.id)) return false
    if (filters.onlyIncomplete && !ctx.incomplete?.has(row.id)) return false
    if (filters.onlyComplete && ctx.incomplete?.has(row.id)) return false
    return true
  })
}

export function groupRows(rows: MiperEntrySnapshot[], by: GroupBy) {
  if (by === "none") return [{ key: "all", label: "", rows }]
  const groups = new Map<string, MiperEntrySnapshot[]>()
  for (const row of rows) {
    const key = by === "activity" ? row.activity ?? "" : by === "position" ? row.position ?? "" : row.classification ?? ""
    groups.set(key, [...(groups.get(key) ?? []), row])
  }
  const entries = [...groups.entries()]
  if (by === "classification") {
    const order = [...RISK_CLASSIFICATIONS].reverse() as string[]
    entries.sort(([a], [b]) => (order.indexOf(a) === -1 ? 99 : order.indexOf(a)) - (order.indexOf(b) === -1 ? 99 : order.indexOf(b)))
    return entries.map(([key, groupRows]) => ({ key: key || "none", label: key ? CLASSIFICATION_LABEL[key as RiskClassification] : "Sin evaluar", rows: groupRows }))
  }
  entries.sort(([a], [b]) => (a || "\uFFFF").localeCompare(b || "\uFFFF", "es"))
  return entries.map(([key, groupRows]) => ({ key: key || "none", label: key || (by === "activity" ? "Sin actividad" : "Sin puesto"), rows: groupRows }))
}
