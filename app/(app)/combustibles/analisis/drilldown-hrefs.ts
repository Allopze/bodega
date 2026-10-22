import type { PerformanceGroup } from "@/lib/combustibles/equipment-performance"

/**
 * Enlaces de "ver cargas" de cada grupo del gráfico de rendimiento (D-12).
 *
 * El gráfico es un Client Component y la página un Server Component: entre los
 * dos solo viajan datos serializables. Antes la página pasaba una función
 * (`drilldownHref`) y Next.js rechazaba el render. Ahora la página calcula los
 * hrefs y el gráfico solo los busca por la clave del grupo.
 */
export function groupHrefKey(group: Pick<PerformanceGroup, "unit" | "key">): string {
  return `${group.unit}:${group.key}`
}

export function buildGroupDrilldownHrefs(
  groups: Array<Pick<PerformanceGroup, "unit" | "key" | "singlePlate">>,
  context: { worksiteId?: string; from: string; to: string },
): Record<string, string> {
  const hrefs: Record<string, string> = {}
  for (const group of groups) {
    const params = new URLSearchParams({ desde: context.from, hasta: context.to })
    if (group.singlePlate) params.set("q", group.singlePlate)
    if (context.worksiteId) params.set("faena", context.worksiteId)
    hrefs[groupHrefKey(group)] = `/combustibles/bitacora?${params.toString()}`
  }
  return hrefs
}
