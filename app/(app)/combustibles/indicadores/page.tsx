import { permanentRedirect } from "next/navigation"
import { FUEL_PATHS } from "@/lib/combustibles/routes"

type SearchParams = Record<string, string | string[] | undefined>

/**
 * Los Indicadores de combustible son ahora el Panel (decisión del usuario 2026-11-14): esta
 * dirección sólo conserva los enlaces viejos y lleva al Panel con el mismo período y faena.
 * Redirigir no es autorización: el Panel vuelve a pedir su permiso.
 */
export default async function IndicadoresCombustibleRedirect({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(await searchParams)) {
    for (const item of Array.isArray(value) ? value : value === undefined ? [] : [value]) params.append(key, item)
  }
  const query = params.toString()
  permanentRedirect(`${FUEL_PATHS.panel}${query ? `?${query}` : ""}`)
}
