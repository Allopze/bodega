import { fuelPeriodSearchParams } from "@/lib/combustibles/period/parse"
import type { ResolvedFuelPeriod } from "@/lib/combustibles/period/types"
import { withFuelContext } from "@/lib/combustibles/routes"

type SearchParams = Record<string, string | string[] | undefined>

/**
 * El contexto que viaja a otra pantalla del módulo: el período YA resuelto
 * (venga de la URL, de un parámetro antiguo, de la cookie o del valor por rol)
 * y la faena. Sin esto un enlace heredaría sólo lo que esté escrito en la URL
 * y la pantalla de destino podría resolver otro período.
 */
export function fuelContextParams(period: ResolvedFuelPeriod, extra: { faena?: string | null } = {}): Record<string, string> {
  return { ...fuelPeriodSearchParams(period.period), ...(extra.faena ? { faena: extra.faena } : {}) }
}

/** `href` con el período y la faena de la pantalla actual. */
export function hrefInContext(href: string, period: ResolvedFuelPeriod, faena?: string | null): string {
  return withFuelContext(href, fuelContextParams(period, { faena }))
}

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value)

/**
 * `?query` de la pantalla actual con cambios (un valor `null` borra el parámetro).
 * Para paginar o fijar un filtro sin perder los demás.
 */
export function searchWith(sp: SearchParams, changes: Record<string, string | null | undefined>): string {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(sp)) {
    const raw = first(value)
    if (raw !== undefined && raw !== "") params.set(key, raw)
  }
  for (const [key, value] of Object.entries(changes)) {
    if (value === null || value === undefined || value === "") params.delete(key)
    else params.set(key, value)
  }
  const query = params.toString()
  return query ? `?${query}` : "?"
}
