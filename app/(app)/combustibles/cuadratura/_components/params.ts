import type { ResolvedFuelPeriod } from "@/lib/combustibles/period/types"
import { fuelPeriodSearchParams } from "@/lib/combustibles/period/parse"

type SearchParams = Record<string, string | string[] | undefined>

/** El primer valor no vacío de un parámetro de URL. */
export function firstParam(sp: SearchParams, key: string): string | undefined {
  const raw = sp[key]
  const value = (Array.isArray(raw) ? raw[0] : raw)?.trim()
  return value ? value : undefined
}

/** Una URL de esta pantalla con los parámetros dados (los nulos se quitan) sobre los de la actual. */
export function hrefWith(path: string, sp: SearchParams, patch: Record<string, string | null | undefined>): string {
  const params = new URLSearchParams()
  for (const [key, raw] of Object.entries(sp)) {
    const value = Array.isArray(raw) ? raw[0] : raw
    if (value) params.set(key, value)
  }
  for (const [key, value] of Object.entries(patch)) {
    if (value) params.set(key, value)
    else params.delete(key)
  }
  const query = params.toString()
  return query ? `${path}?${query}` : path
}


/**
 * El período y la faena de la pantalla, para los enlaces a otras pantallas del
 * módulo (`withFuelContext`). Se arma desde el período ya resuelto y no desde la
 * URL: si vino de la cookie o del valor por rol, la URL no lo trae y el enlace
 * lo perdería.
 */
export function periodContext(period: ResolvedFuelPeriod, worksiteId?: string): Record<string, string> {
  return { ...fuelPeriodSearchParams(period.period), ...(worksiteId ? { faena: worksiteId } : {}) }
}
