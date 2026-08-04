export const PERMIT_QUICK_FILTERS = ["all", "active", "pending", "isolations", "suspended"] as const

export type PermitQuickFilter = typeof PERMIT_QUICK_FILTERS[number]

export interface PermitQuickFilterItem {
  status: string
  openIsolationCount: number
}

export const PERMIT_QUICK_FILTER_LABELS: Record<PermitQuickFilter, string> = {
  all: "Todos los permisos",
  active: "Vigentes en terreno",
  pending: "Esperando aprobación",
  isolations: "Con energías bloqueadas",
  suspended: "Suspendidos",
}

export function isPermitQuickFilter(value: string | null | undefined): value is PermitQuickFilter {
  return typeof value === "string" && (PERMIT_QUICK_FILTERS as readonly string[]).includes(value)
}

export function matchesPermitQuickFilter(item: PermitQuickFilterItem, filter: PermitQuickFilter) {
  if (filter === "all") return true
  if (filter === "active") return item.status === "active"
  if (filter === "pending") return item.status === "pending_approval"
  if (filter === "isolations") return item.openIsolationCount > 0
  return item.status === "suspended"
}
