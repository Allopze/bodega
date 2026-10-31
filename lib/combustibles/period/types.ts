/**
 * Período compartido por todas las pantallas de Combustible.
 *
 * Antes cada pantalla filtraba la fecha a su manera (`desde`/`hasta`,
 * `anio`+`meses`, `from`/`to`, `month`, `startDate`/`endDate`) y el período se
 * perdía al cambiar de pestaña. Ahora hay un solo período, codificado en la URL
 * como `periodo=<token>` (o `desde`/`hasta` para un rango) y recordado en una
 * cookie para que también viaje por el menú lateral.
 *
 * Todas las fechas son civiles de Chile ("YYYY-MM-DD"), inclusivas en ambos
 * extremos.
 */
export type FuelPeriod =
  | { kind: "week"; year: number; week: number }
  | { kind: "month"; year: number; month: number }
  | { kind: "quarter"; year: number; quarter: number }
  | { kind: "year"; year: number }
  | { kind: "range"; from: string; to: string }

export type FuelPeriodKind = FuelPeriod["kind"]

/** De dónde salió el período que se está mostrando. */
export type FuelPeriodSource = "url" | "legacy" | "cookie" | "default"

export type FuelPeriodStatus = "en_curso" | "cerrado" | "futuro"

export interface ResolvedFuelPeriod {
  period: FuelPeriod
  /** Valor de `periodo` en la URL; `null` para un rango (que viaja en `desde`/`hasta`). */
  token: string | null
  from: string
  to: string
  /** Meses "YYYY-MM" que toca el período, en orden. */
  monthKeys: string[]
  /** «Octubre 2026», «Semana del 26 oct», «4.º trimestre 2026», «Año 2026», «15 sep – 15 oct». */
  label: string
  /** Para frases: «en octubre», «en la semana del 26 de octubre», «en 2026». */
  inLabel: string
  status: FuelPeriodStatus
  /** Último día del período: lo que cambia sus cifras debería quedar resuelto antes. */
  dueDate: string
  /** El período cubre meses completos (mes, trimestre, año). */
  isWholeMonths: boolean
  prev: FuelPeriod | null
  /** `null` cuando el siguiente empezaría después de hoy. */
  next: FuelPeriod | null
  source: FuelPeriodSource
}

/** Parámetros de URL que viajan entre las pantallas del módulo. */
export const FUEL_CARRY_PARAMS = ["periodo", "desde", "hasta", "faena"] as const

/** Parámetros de período que reemplazan los nuevos (se limpian al cambiar de período). */
export const FUEL_PERIOD_PARAMS = ["periodo", "desde", "hasta"] as const
