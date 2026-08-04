export const TRAINING_SESSION_QUICK_FILTERS = ["all", "planned", "pending_ack"] as const

export type TrainingSessionQuickFilter = typeof TRAINING_SESSION_QUICK_FILTERS[number]

export interface TrainingSessionQuickFilterItem {
  status: string
  attendedCount: number
  acknowledgedCount: number
}

export const TRAINING_SESSION_QUICK_FILTER_LABELS: Record<TrainingSessionQuickFilter, string> = {
  all: "Todas las sesiones",
  planned: "Sesiones planificadas",
  pending_ack: "Acuses pendientes",
}

export function isTrainingSessionQuickFilter(value: string | null | undefined): value is TrainingSessionQuickFilter {
  return typeof value === "string" && (TRAINING_SESSION_QUICK_FILTERS as readonly string[]).includes(value)
}

export function matchesTrainingSessionQuickFilter(
  item: TrainingSessionQuickFilterItem,
  filter: TrainingSessionQuickFilter,
) {
  if (filter === "all") return true
  if (filter === "planned") return item.status === "planned"
  return item.acknowledgedCount < item.attendedCount
}
