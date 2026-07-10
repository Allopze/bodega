export type ConsumptionQueryChanges = Record<string, string | null | undefined>

/**
 * Mantiene el contexto de análisis al navegar dentro del dashboard de consumo.
 * Los cambios de filtros vuelven siempre a la primera página; la paginación no.
 */
export function buildConsumptionHref(
  currentSearch: string,
  changes: ConsumptionQueryChanges,
  { resetPage = true }: { resetPage?: boolean } = {},
) {
  const params = new URLSearchParams(currentSearch)

  for (const [key, value] of Object.entries(changes)) {
    if (value == null || value === "") params.delete(key)
    else params.set(key, value)
  }

  if (resetPage) params.delete("page")

  const query = params.toString()
  return query ? `/combustibles?${query}` : "/combustibles"
}
