export const EMERGENCY_LIST_TABS = ["plans", "drills"] as const
export const EMERGENCY_QUICK_FILTERS = ["all", "approved", "draft", "completed", "needs_improvement"] as const

export type EmergencyListTab = typeof EMERGENCY_LIST_TABS[number]
export type EmergencyQuickFilter = typeof EMERGENCY_QUICK_FILTERS[number]

export const EMERGENCY_QUICK_FILTER_LABELS: Record<EmergencyQuickFilter, string> = {
  all: "Sin filtro",
  approved: "Planes aprobados",
  draft: "Planes en preparación",
  completed: "Simulacros realizados",
  needs_improvement: "Simulacros que requieren mejora",
}

export function isEmergencyListTab(value: string | null | undefined): value is EmergencyListTab {
  return typeof value === "string" && (EMERGENCY_LIST_TABS as readonly string[]).includes(value)
}

export function isEmergencyQuickFilter(value: string | null | undefined): value is EmergencyQuickFilter {
  return typeof value === "string" && (EMERGENCY_QUICK_FILTERS as readonly string[]).includes(value)
}

/** Evita que una URL de simulacros intente filtrar planes, y viceversa. */
export function resolveEmergencyQuickFilter(tab: EmergencyListTab, value: string | null | undefined): EmergencyQuickFilter {
  if (!isEmergencyQuickFilter(value)) return "all"
  if (tab === "plans") return value === "approved" || value === "draft" ? value : "all"
  return value === "completed" || value === "needs_improvement" ? value : "all"
}
