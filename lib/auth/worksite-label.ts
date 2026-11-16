import type { WorksiteScope } from "@/lib/auth/scope"

/**
 * Rótulo de la opción «todas» de un selector o de una cabecera de faena.
 *
 * Quien ve todas las faenas (alcance global) lee «Todas las faenas». Quien tiene un alcance
 * limitado lee «Todas tus faenas»: «Todas las faenas» le sugeriría que ve la empresa entera y
 * que el filtro abarca más de lo que realmente alcanza.
 *
 * Es una función pura y sin dependencias de servidor (el import de arriba es sólo de tipo), para
 * que la usen tanto las páginas, que la resuelven con la sesión, como los componentes cliente,
 * que reciben el rótulo ya resuelto como prop y no leen la sesión.
 *
 * Acepta el alcance de `resolveWorksiteScope` o el booleano de `isGlobalRole(session)`.
 */
export const ALL_WORKSITES_LABEL = "Todas las faenas"
export const ALL_SCOPED_WORKSITES_LABEL = "Todas tus faenas"

export function allWorksitesLabel(scope: Pick<WorksiteScope, "mode"> | boolean): string {
  const isGlobal = typeof scope === "boolean" ? scope : scope.mode === "all"
  return isGlobal ? ALL_WORKSITES_LABEL : ALL_SCOPED_WORKSITES_LABEL
}
