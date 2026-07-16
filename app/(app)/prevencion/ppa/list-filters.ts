import type { PpaListClientFilters } from "./actions"

export interface PpaListFilterState {
  estado: string
  worksiteId: string
  search: string
  dateFrom: string
  dateTo: string
}

export type PpaListQuery = Partial<Record<keyof PpaListFilterState | "page", string | string[] | undefined>>

function firstValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value
}

function validDate(value: string | undefined) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return ""
  const date = new Date(`${value}T00:00:00`)
  return Number.isNaN(date.getTime()) ? "" : value
}

/** Converts URL query parameters into the form state without trusting malformed dates. */
export function readPpaListFilterState(query: PpaListQuery): PpaListFilterState {
  return {
    estado: firstValue(query.estado) ?? "",
    worksiteId: firstValue(query.worksiteId) ?? "",
    search: firstValue(query.search) ?? "",
    dateFrom: validDate(firstValue(query.dateFrom)),
    dateTo: validDate(firstValue(query.dateTo)),
  }
}

export function readPpaListPage(query: PpaListQuery) {
  const page = Number(firstValue(query.page))
  return Number.isInteger(page) && page > 0 ? page : 1
}

/** URL is the return context for a filtered PPA list and its detail links. */
export function buildPpaListHref(state: PpaListFilterState, page = 1) {
  const params = new URLSearchParams()
  if (state.estado) params.set("estado", state.estado)
  if (state.worksiteId) params.set("worksiteId", state.worksiteId)
  if (state.search.trim()) params.set("search", state.search.trim())
  if (state.dateFrom) params.set("dateFrom", state.dateFrom)
  if (state.dateTo) params.set("dateTo", state.dateTo)
  if (page > 1) params.set("page", String(page))
  const query = params.toString()
  return `/prevencion/ppa${query ? `?${query}` : ""}`
}

export function buildPpaDetailHref(id: string, state: PpaListFilterState, page = 1) {
  const returnTo = buildPpaListHref(state, page)
  return `/prevencion/ppa/${id}?returnTo=${encodeURIComponent(returnTo)}`
}

/** Accept only an internal PPA list URL; never turn this into an open redirect. */
export function readPpaReturnHref(value: string | string[] | undefined) {
  const returnTo = firstValue(value)
  return returnTo?.startsWith("/prevencion/ppa?") ? returnTo : "/prevencion/ppa"
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
