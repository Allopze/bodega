/**
 * Alcance de faena de Bodega.
 *
 * La pantalla parte en la bodega propia del usuario —su faena principal— y no
 * en el listado de todas. Para eso hay que distinguir "no elegí faena" de
 * "elegí ver todas": sin un valor explícito para lo segundo, quitar el filtro
 * volvería siempre a la bodega propia y no habría forma de mirar el resto.
 */

/** "Todas las faenas", elegido a propósito. Vocabulario sólo de `/bodega`. */
export const ALL_WORKSITES = "todas"

/**
 * Faena efectiva de la pantalla a partir del parámetro de la URL.
 *
 * `ownWorksiteId` es la bodega propia ya validada contra el alcance visible: si
 * está vacía —rol global sin faena asignada, o faena principal cerrada— la
 * pantalla se comporta como antes y muestra todas.
 *
 * Devuelve `""` cuando la vista abarca todas las faenas visibles.
 */
export function resolveFaena(raw: string, ownWorksiteId: string): string {
  if (raw === ALL_WORKSITES) return ""
  return raw || ownWorksiteId
}
