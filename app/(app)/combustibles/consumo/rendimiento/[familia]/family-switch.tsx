import { SegmentedControl } from "@/components/ui/segmented-control"
import { PERFORMANCE_FAMILIES, PERFORMANCE_FAMILY_SLUGS, type PerformanceFamily } from "@/lib/combustibles/control/contracts"
import { FUEL_CARRY_PARAMS } from "@/lib/combustibles/period/types"
import { fuelPerformanceHref } from "@/lib/combustibles/routes"

/** Nombre corto de cada familia para el selector (los rótulos completos están en `PERFORMANCE_FAMILY_LABELS`). */
export const FAMILY_SWITCH_LABELS: Record<PerformanceFamily, string> = {
  camiones: "Camiones",
  cargadores_camionetas: "Cargadores y camionetas",
  maquinaria: "Maquinaria",
}

/**
 * Lo que viaja al cambiar de familia: el período (o su rango de fechas) y la faena
 * (`FUEL_CARRY_PARAMS`), más el mandante y el medio de suministro, que valen
 * igual para cualquier familia. Quedan fuera `equipo` (pertenece a una familia),
 * `unidad` (km/L o L/h depende de qué miden los equipos de la familia y dejaría
 * la vista en blanco) y las páginas de las tablas (`pagina`, `cargas`).
 */
const FAMILY_CARRY_PARAMS = [...FUEL_CARRY_PARAMS, "mandante", "medio"] as const

type SearchParams = Record<string, string | string[] | undefined>

export function familySwitchHref(sp: SearchParams, family: PerformanceFamily): string {
  const params = new URLSearchParams()
  for (const key of FAMILY_CARRY_PARAMS) {
    const raw = sp[key]
    const value = (Array.isArray(raw) ? raw[0] : raw)?.trim()
    if (value) params.set(key, value)
  }
  const query = params.toString()
  const path = fuelPerformanceHref(PERFORMANCE_FAMILY_SLUGS[family])
  return query ? `${path}?${query}` : path
}

/**
 * Selector de familia del rendimiento. La barra de sección tiene una sola
 * pestaña «Rendimiento» y la familia se elige aquí, con enlaces que conservan
 * el contexto.
 */
export function FamilySwitch({ active, searchParams }: { active: PerformanceFamily; searchParams: SearchParams }) {
  return (
    <SegmentedControl
      ariaLabel="Familia de equipos"
      className="mb-5"
      items={PERFORMANCE_FAMILIES.map((family) => ({
        key: family,
        label: FAMILY_SWITCH_LABELS[family],
        active: family === active,
        href: familySwitchHref(searchParams, family),
      }))}
    />
  )
}
