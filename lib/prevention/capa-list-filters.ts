export const CAPA_QUICK_FILTERS = [
  "all",
  "open",
  "overdue",
  "pending_verification",
  "unreconciled",
  "immediate_stop",
] as const

export type CapaQuickFilter = typeof CAPA_QUICK_FILTERS[number]

export interface CapaQuickFilterItem {
  status: string
  targetDate: string
  reconciliationStatus: string
  requiresImmediateStop: boolean
}

export const CAPA_QUICK_FILTER_LABELS: Record<Exclude<CapaQuickFilter, "all">, string> = {
  immediate_stop: "Exigen detener la tarea",
  open: "Abiertas",
  overdue: "Vencidas",
  pending_verification: "Por verificar",
  unreconciled: "Por conciliar",
}

const CLOSED_STATUSES = new Set(["closed", "cancelled"])

export function isCapaQuickFilter(value: string | null | undefined): value is CapaQuickFilter {
  return CAPA_QUICK_FILTERS.includes(value as CapaQuickFilter)
}

export function isOpenCapaAction(status: string) {
  return !CLOSED_STATUSES.has(status)
}

/** Matches the exact condition communicated by a CAPA metric or extra filter. */
export function matchesCapaQuickFilter(item: CapaQuickFilterItem, filter: CapaQuickFilter, today: string) {
  if (filter === "all") return true
  if (filter === "open") return isOpenCapaAction(item.status)
  if (filter === "overdue") return item.status !== "verified" && isOpenCapaAction(item.status) && item.targetDate < today
  if (filter === "pending_verification") return item.status === "pending_verification"
  if (filter === "unreconciled") return item.reconciliationStatus !== "reconciled"
  return item.requiresImmediateStop && isOpenCapaAction(item.status)
}
