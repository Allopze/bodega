import type { StageTab } from "@/components/ui/stage-tabs"
import { INCIDENT_STATUS_LABELS } from "@/lib/prevention/incidents"
import type { IncidentStatus } from "@/lib/services/prevention-incidents"

/**
 * Filtros de la lista de /prevencion/incidentes que viven en la URL.
 *
 * Regla A5: el estado es *una* dimensión y se representa una sola vez, con
 * pestañas (`?status=`). Lo que queda como tarjeta son condiciones que cruzan
 * los estados —«Plazos atrasados», «Fatal o grave»— y viajan en `?quick=`.
 */

/** Pestaña «Abiertos»: todo lo que no está cerrado. No es un estado guardado, es una vista. */
export const INCIDENT_OPEN_VIEW = "open" as const
export type IncidentStatusView = IncidentStatus | typeof INCIDENT_OPEN_VIEW

/** Condiciones que cruzan los estados; cada una es una tarjeta de la pantalla. */
export const INCIDENT_CONDITIONS = ["overdue", "fatal"] as const
export type IncidentCondition = typeof INCIDENT_CONDITIONS[number]

const INCIDENT_STATUS_KEYS = Object.keys(INCIDENT_STATUS_LABELS) as IncidentStatus[]

export function parseIncidentStatusView(value: string | null | undefined): IncidentStatusView | undefined {
  if (value === INCIDENT_OPEN_VIEW) return INCIDENT_OPEN_VIEW
  return INCIDENT_STATUS_KEYS.find((status) => status === value)
}

export function parseIncidentCondition(value: string | null | undefined): IncidentCondition | undefined {
  return INCIDENT_CONDITIONS.find((condition) => condition === value)
}

export interface IncidentStatusCounts {
  /** Todas las filas con los demás filtros aplicados, sea cual sea su estado. */
  total: number
  /** Las que no están cerradas (lo que la pestaña «Abiertos» muestra). */
  open: number
  byStatus: Record<IncidentStatus, number>
}

/** Cuenta por estado -una fila por estado con filas- a la forma que consumen las pestañas. */
export function buildIncidentStatusCounts(rows: ReadonlyArray<{ status: string; total: number }>): IncidentStatusCounts {
  const byStatus = Object.fromEntries(INCIDENT_STATUS_KEYS.map((status) => [status, 0])) as Record<IncidentStatus, number>
  let total = 0
  for (const row of rows) {
    total += row.total
    if (row.status in byStatus) byStatus[row.status as IncidentStatus] += row.total
  }
  // `status <> 'closed'` también deja pasar un estado que ya no existe: «abiertos» se
  // calcula igual que el filtro, no como la suma de las pestañas.
  return { total, open: total - byStatus.closed, byStatus }
}

/**
 * Pestañas con contador. Cada número es cuántas filas mostraría esa pestaña con los
 * demás filtros aplicados (sin el de estado), por eso `Todos` y `Abiertos` no son la
 * suma de las demás.
 */
export function buildIncidentStatusTabs(counts: IncidentStatusCounts): StageTab[] {
  return [
    { value: "", label: "Todos", count: counts.total },
    { value: INCIDENT_OPEN_VIEW, label: "Abiertos", count: counts.open },
    ...INCIDENT_STATUS_KEYS.map((status) => ({ value: status, label: INCIDENT_STATUS_LABELS[status], count: counts.byStatus[status] })),
  ]
}

type RawQuery = Record<string, string | string[] | undefined>

function firstValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value
}

/**
 * `?quick=open` es el enlace que el tablero de inicio publica para «Incidentes
 * abiertos»; antes era una tarjeta y hoy es la pestaña «Abiertos». Devuelve la URL
 * canónica o `null` si no hay nada que migrar. Un `?status=` explícito manda.
 */
export function incidentLegacyQuickHref(pathname: string, query: RawQuery): string | null {
  if (firstValue(query.quick) !== INCIDENT_OPEN_VIEW) return null
  const params = new URLSearchParams()
  for (const [key, raw] of Object.entries(query)) {
    const value = firstValue(raw)
    if (key !== "quick" && value) params.set(key, value)
  }
  if (!params.has("status")) params.set("status", INCIDENT_OPEN_VIEW)
  return `${pathname}?${params.toString()}`
}
