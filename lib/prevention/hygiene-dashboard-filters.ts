export const HYGIENE_DASHBOARD_TABS = ["groups", "programs", "summary"] as const
export const HYGIENE_QUICK_FILTERS = ["all", "surveillance", "above_limit", "not_comparable", "overdue"] as const

export type HygieneDashboardTab = typeof HYGIENE_DASHBOARD_TABS[number]
export type HygieneQuickFilter = typeof HYGIENE_QUICK_FILTERS[number]

export interface HygieneGroupQuickFilterItem {
  surveillanceRequired: boolean
  latestOutcome: string | null
}

export interface HygieneProgramQuickFilterItem {
  overdue: number
}

export const HYGIENE_QUICK_FILTER_LABELS: Record<HygieneQuickFilter, string> = {
  all: "Sin filtro",
  surveillance: "GES bajo vigilancia",
  above_limit: "Sobre el límite",
  not_comparable: "Sin límite declarado",
  overdue: "Controles vencidos",
}

export function isHygieneDashboardTab(value: string | null | undefined): value is HygieneDashboardTab {
  return typeof value === "string" && (HYGIENE_DASHBOARD_TABS as readonly string[]).includes(value)
}

export function isHygieneQuickFilter(value: string | null | undefined): value is HygieneQuickFilter {
  return typeof value === "string" && (HYGIENE_QUICK_FILTERS as readonly string[]).includes(value)
}

export function matchesHygieneGroupQuickFilter(item: HygieneGroupQuickFilterItem, filter: HygieneQuickFilter) {
  if (filter === "all") return true
  if (filter === "surveillance") return item.surveillanceRequired
  if (filter === "above_limit") return item.latestOutcome === "above_limit"
  if (filter === "not_comparable") return item.latestOutcome === "not_comparable"
  return false
}

export function matchesHygieneProgramQuickFilter(item: HygieneProgramQuickFilterItem, filter: HygieneQuickFilter) {
  return filter !== "overdue" || item.overdue > 0
}
