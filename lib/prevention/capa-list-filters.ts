import type { StageTab } from "@/components/ui/stage-tabs"
import { CAPA_STATUS_LABELS } from "@/lib/prevention/capa"
import type { CapaStatus } from "@/lib/services/prevention-capa"

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

/**
 * Regla A5: el estado es *una* dimensión y se representa una sola vez, con
 * pestañas (`?status=`). Lo que queda como tarjeta son condiciones que cruzan los
 * estados —«Vencidas», «Exigen detener la tarea», «Por conciliar»— y viajan en
 * `?vista=`. Las vistas «open» y «pending_verification» del filtro rápido eran
 * estados disfrazados de tarjeta: hoy son pestañas.
 */

/** Pestaña «Abiertas»: ni cerradas ni canceladas. No es un estado guardado, es una vista. */
export const CAPA_OPEN_VIEW = "open" as const
export type CapaStatusView = CapaStatus | typeof CAPA_OPEN_VIEW

export const CAPA_CONDITIONS = ["overdue", "unreconciled", "immediate_stop"] as const
export type CapaCondition = typeof CAPA_CONDITIONS[number]

const CAPA_STATUS_KEYS = Object.keys(CAPA_STATUS_LABELS) as CapaStatus[]

export function parseCapaStatusView(value: string | null | undefined): CapaStatusView | undefined {
  if (value === CAPA_OPEN_VIEW) return CAPA_OPEN_VIEW
  return CAPA_STATUS_KEYS.find((status) => status === value)
}

export function parseCapaCondition(value: string | null | undefined): CapaCondition | undefined {
  return CAPA_CONDITIONS.find((condition) => condition === value)
}

export interface CapaStatusCounts {
  /** Todas las filas con los demás filtros aplicados, sea cual sea su estado. */
  total: number
  /** Las que no están cerradas ni canceladas (lo que la pestaña «Abiertas» muestra). */
  open: number
  byStatus: Record<CapaStatus, number>
}

/** Cuenta por estado -una fila por estado con filas- a la forma que consumen las pestañas. */
export function buildCapaStatusCounts(rows: ReadonlyArray<{ status: string; total: number }>): CapaStatusCounts {
  const byStatus = Object.fromEntries(CAPA_STATUS_KEYS.map((status) => [status, 0])) as Record<CapaStatus, number>
  let total = 0
  for (const row of rows) {
    total += row.total
    if (row.status in byStatus) byStatus[row.status as CapaStatus] += row.total
  }
  // Igual que `status not in ('closed', 'cancelled')`: un estado que ya no existe sigue contando como abierto.
  return { total, open: total - byStatus.closed - byStatus.cancelled, byStatus }
}

/**
 * Pestañas con contador. Cada número es cuántas filas mostraría esa pestaña con los
 * demás filtros aplicados (sin el de estado), por eso `Todas` y `Abiertas` no son la
 * suma de las demás.
 */
export function buildCapaStatusTabs(counts: CapaStatusCounts): StageTab[] {
  return [
    { value: "", label: "Todas", count: counts.total },
    { value: CAPA_OPEN_VIEW, label: "Abiertas", count: counts.open },
    ...CAPA_STATUS_KEYS.map((status) => ({ value: status, label: CAPA_STATUS_LABELS[status], count: counts.byStatus[status] })),
  ]
}

type RawQuery = Record<string, string | string[] | undefined>

function firstValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value
}

/**
 * `?vista=open` y `?vista=pending_verification` eran tarjetas y hoy son pestañas de
 * estado. Devuelve la URL canónica o `null` si no hay nada que migrar. La paginación
 * se descarta (el recorte cambia) y un `?status=` explícito manda.
 */
export function capaLegacyVistaHref(pathname: string, query: RawQuery): string | null {
  const vista = firstValue(query.vista)
  if (vista !== CAPA_OPEN_VIEW && vista !== "pending_verification") return null
  const params = new URLSearchParams()
  for (const [key, raw] of Object.entries(query)) {
    const value = firstValue(raw)
    if (key !== "vista" && key !== "page" && value) params.set(key, value)
  }
  if (!params.has("status")) params.set("status", vista)
  return `${pathname}?${params.toString()}`
}
