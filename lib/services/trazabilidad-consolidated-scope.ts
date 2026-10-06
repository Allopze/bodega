/**
 * Valor del parámetro `faena` que pide "todas las faenas visibles".
 *
 * Vive en un módulo sin dependencias de servidor porque lo importan tanto el
 * servicio como el selector de faena (componente cliente).
 */
export const TRACEABILITY_ALL_WORKSITES = "todas"

/**
 * Faena que usa la vista cuando la URL no trae una válida.
 *
 * Quien ve más de una faena abre en "todas": el default anterior era la faena
 * primaria, y la oficina —que no tiene solicitudes propias— aterrizaba en siete
 * ceros y un estado vacío. Quien ve una sola faena conserva esa faena (no hay
 * nada que agregar, y "todas" sería un selector de una opción).
 */
export function resolveTraceabilityScope(
  requested: string,
  visibleWorksiteIds: readonly string[],
): string {
  if (visibleWorksiteIds.length === 0) return ""
  if (requested && visibleWorksiteIds.includes(requested)) return requested
  return visibleWorksiteIds.length > 1 ? TRACEABILITY_ALL_WORKSITES : visibleWorksiteIds[0]!
}
