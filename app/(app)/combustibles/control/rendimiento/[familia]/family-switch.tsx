import { SegmentedControl } from "@/components/ui/segmented-control"
import { PERFORMANCE_FAMILIES, PERFORMANCE_FAMILY_SLUGS, type PerformanceFamily } from "@/lib/combustibles/control/contracts"
import { CONTROL_CARRY_PARAMS } from "@/lib/combustibles/section-nav"

/** Nombre corto de cada familia para el selector (los rótulos completos están en `PERFORMANCE_FAMILY_LABELS`). */
export const FAMILY_SWITCH_LABELS: Record<PerformanceFamily, string> = {
  camiones: "Camiones",
  cargadores_camionetas: "Cargadores y camionetas",
  maquinaria: "Maquinaria",
}

/**
 * Lo que viaja al cambiar de familia: el período, la faena y el mandante
 * (`CONTROL_CARRY_PARAMS`), más el rango de fechas y el medio de suministro,
 * que valen igual para cualquier familia. Quedan fuera `equipo` (pertenece a una
 * familia), `unidad` (km/L o L/h depende de qué miden los equipos de la familia
 * y dejaría la vista en blanco) y las páginas de las tablas.
 */
const FAMILY_CARRY_PARAMS = [...CONTROL_CARRY_PARAMS, "desde", "hasta", "medio"] as const

type SearchParams = Record<string, string | string[] | undefined>

export function familySwitchHref(sp: SearchParams, family: PerformanceFamily): string {
  const params = new URLSearchParams()
  for (const key of FAMILY_CARRY_PARAMS) {
    const raw = sp[key]
    const value = (Array.isArray(raw) ? raw[0] : raw)?.trim()
    if (value) params.set(key, value)
  }
  const query = params.toString()
  return `/combustibles/control/rendimiento/${PERFORMANCE_FAMILY_SLUGS[family]}${query ? `?${query}` : ""}`
}

/**
 * Selector de familia del rendimiento. Eran pestañas de `ControlNav`; ahora la
 * barra de sección tiene una sola pestaña «Rendimiento» y la familia se elige
 * aquí, con enlaces que conservan el contexto.
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
