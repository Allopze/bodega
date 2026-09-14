import { revalidatePath, revalidateTag } from "next/cache"

/**
 * Etiqueta general de los badges. Sigue existiendo —y sigue colgando de cada
 * entrada— porque una mutación que no sabe a qué faena pertenece debe invalidar
 * a todo el mundo: perder un badge es un error de forma, mostrar uno viejo es un
 * error de fondo.
 */
export const BADGE_COUNTS_TAG = "badge-counts"
/** Sólo las sesiones con visión global. Cualquier faena las afecta. */
export const BADGE_COUNTS_GLOBAL_TAG = "badge-counts:global"
export function badgeCountsWorksiteTag(worksiteId: string) {
  return `badge-counts:faena:${worksiteId}`
}

/** Caché del tablero de Analítica (ver `lib/services/read-model-cache.ts`). */
export const ANALYTICS_DASHBOARD_TAG = "analytics-dashboard"
/** Caché de la cola de integridad operacional. */
export const OPERATIONAL_INTEGRITY_TAG = "operational-integrity"

export interface OperationalCacheScope {
  isGlobal: boolean
  worksiteIds: string[]
}

/**
 * PER-T01 (auditoría 2026-09-14): con qué etiquetas se guarda la caché de
 * badges de una sesión.
 *
 * Antes había una sola —`badge-counts`— y las 52 mutaciones operacionales la
 * invalidaban sin condición: registrar una recepción en una faena vaciaba los
 * badges de **todos** los usuarios de la plataforma, y la caché de 30 s del
 * layout (P-01) perdía casi todo su efecto en una jornada activa.
 *
 * Ahora cada entrada lleva además la etiqueta de cada faena visible para esa
 * sesión, o la global si la sesión ve todas. Una mutación que declara su faena
 * invalida sólo a quienes la ven.
 */
export function badgeCountsTags(scope: OperationalCacheScope): string[] {
  return scope.isGlobal
    ? [BADGE_COUNTS_TAG, BADGE_COUNTS_GLOBAL_TAG]
    : [BADGE_COUNTS_TAG, ...scope.worksiteIds.map(badgeCountsWorksiteTag)]
}

/**
 * Invalida el centro operacional después de una mutación que puede crear,
 * resolver o cambiar la prioridad de una etapa. Mantiene el shell, dashboard
 * y cola coherentes sin obligar a cada flujo a recordar todas las rutas.
 *
 * `worksiteId` es opcional y acota la invalidación de los badges a esa faena
 * (PER-T01). Omitirlo conserva el comportamiento anterior —invalidar a todos—,
 * que es lo correcto para una mutación cuyo alcance no es una faena o que
 * todavía no lo declara.
 *
 * Las rutas se siguen revalidando sin acotar: `/dashboard` y `/pendientes`
 * cuelgan de un layout `force-dynamic`, así que no hay entrada compartida que
 * botar; lo que hace `revalidatePath` ahí es refrescar la caché de router del
 * navegador que ejecutó la acción. El costo compartido que denuncia PER-T01 era
 * la etiqueta, y es la que queda acotada.
 */
export function revalidateOperationalViews(
  paths: Iterable<string> = [],
  scope: { worksiteId?: string | null } = {},
) {
  revalidatePath("/dashboard")
  revalidatePath("/pendientes")
  if (scope.worksiteId) {
    revalidateTag(badgeCountsWorksiteTag(scope.worksiteId), { expire: 0 })
    revalidateTag(BADGE_COUNTS_GLOBAL_TAG, { expire: 0 })
  } else {
    revalidateTag(BADGE_COUNTS_TAG, { expire: 0 })
  }
  for (const path of paths) revalidatePath(path)
}

/**
 * PER-T02: la cola de integridad se recalcula cuando sus propias acciones
 * —escanear, reconocer, verificar— la cambian. Es una etiqueta sola: no arrastra
 * badges ni tablero.
 */
export function revalidateOperationalIntegrityBoard() {
  revalidateTag(OPERATIONAL_INTEGRITY_TAG, { expire: 0 })
}
