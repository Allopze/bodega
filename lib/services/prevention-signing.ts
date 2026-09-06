/**
 * lib/services/prevention-signing.ts
 *
 * La excepción a la segregación por actor, en un solo lugar.
 *
 * Los flujos de Prevención —MIPER, matriz GRD, documentación SST, RE-20— se
 * firman por etapas y cada etapa exige una persona distinta de la anterior. Esa
 * comparación es por **usuario**, no por rol: dos personas del mismo rol pueden
 * firmarse entre ellas, y una sola persona con todos los permisos no puede
 * firmarse a sí misma. Es la garantía que vuelve la evidencia oponible.
 *
 * El último eslabón —publicar una versión aprobada, cerrar un incidente
 * investigado— admite una excepción, y sólo una: la jefatura técnica del área
 * responde por el contenido y no puede quedar esperando que un tercero firme su
 * propio criterio. `prevention:sign_own_work` la expresa.
 *
 * Tres cosas que la excepción **no** hace, y conviene tener a mano antes de
 * ensancharla:
 *
 * - No levanta las etapas intermedias. Aprobar sigue exigiendo no haber creado
 *   ni revisado, para todos, incluida la jefatura.
 * - No alcanza al Programa de Trabajo Preventivo. Su paso JDPR lleva la regla
 *   `not_elaborator` en `lib/services/pdtp/approval-flow.ts` y no consulta esto:
 *   nadie aprueba el programa que elaboró.
 * - No es un `override` con motivo escrito. `prevention:capa:override_segregation`
 *   y sus pares son otra cosa —una excepción puntual y justificada por caso—;
 *   ésta es permanente y por cargo, así que su control es a quién se otorga.
 */

/** El permiso que exime de la segregación del último eslabón. */
export const SIGN_OWN_WORK_PERMISSION = "prevention:sign_own_work"

/**
 * Si el actor puede firmar un registro en cuyas etapas previas ya participó.
 *
 * Recibe la lista de permisos y no la sesión: los servicios de Prevención
 * trabajan con `access.permissions` y no conocen los roles, que además es la
 * forma correcta —la excepción se otorga en el manifiesto, a la vista, y no se
 * esconde tras el nombre de un rol en medio de un servicio.
 */
export function canSignOwnWork(permissions: readonly string[]): boolean {
  return permissions.includes(SIGN_OWN_WORK_PERMISSION)
}
