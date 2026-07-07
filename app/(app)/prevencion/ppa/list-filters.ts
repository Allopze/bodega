import type { PpaListClientFilters } from "./actions"

export interface PpaListFilterState {
  estado: string
  worksiteId: string
  search: string
  dateFrom: string
  dateTo: string
}

export function buildPpaListFilters(state: PpaListFilterState): PpaListClientFilters {
  return {
    estado: state.estado || undefined,
    worksiteId: state.worksiteId || undefined,
    search: state.search.trim() || undefined,
    dateFrom: state.dateFrom ? new Date(`${state.dateFrom}T00:00:00`).toISOString() : undefined,
    // Include the full end day (up to 23:59:59.999).
    dateTo: state.dateTo ? new Date(`${state.dateTo}T23:59:59.999`).toISOString() : undefined,
  }
}
