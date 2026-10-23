import { PERFORMANCE_FAMILY_SLUGS, type PerformanceFamily } from "@/lib/combustibles/control/contracts"
import { FIRST_PERFORMANCE_HREF } from "@/lib/combustibles/section-nav"

/** El `preset` de la vista retirada, traducido a la familia de rendimiento equivalente. */
const PRESET_FAMILY: Record<string, PerformanceFamily> = {
  truck: "camiones",
  loaders_pickups: "cargadores_camionetas",
  heavy: "maquinaria",
}

const PLAIN_DATE = /^\d{4}-\d{2}-\d{2}$/

function first(value: string | string[] | undefined): string | undefined {
  const raw = (Array.isArray(value) ? value[0] : value)?.trim()
  return raw || undefined
}

/**
 * Destino de `/combustibles/analisis`, vista retirada: el análisis de
 * rendimiento por familia vive ahora en `/combustibles/control/rendimiento/<familia>`.
 * Conserva la familia (`preset`), la faena y el rango de fechas, que la vista
 * nueva entiende con los mismos nombres. `agrupar` no tiene equivalente: la
 * vista nueva muestra siempre faena y equipo.
 */
export function legacyAnalysisTarget(sp: Record<string, string | string[] | undefined>): string {
  const preset = first(sp.preset)
  const family = preset ? PRESET_FAMILY[preset] : undefined
  const base = family ? `/combustibles/control/rendimiento/${PERFORMANCE_FAMILY_SLUGS[family]}` : FIRST_PERFORMANCE_HREF

  const params = new URLSearchParams()
  const faena = first(sp.faena)
  if (faena) params.set("faena", faena)
  const desde = first(sp.desde)
  if (desde && PLAIN_DATE.test(desde)) params.set("desde", desde)
  const hasta = first(sp.hasta)
  if (hasta && PLAIN_DATE.test(hasta)) params.set("hasta", hasta)

  const query = params.toString()
  return query ? `${base}?${query}` : base
}
