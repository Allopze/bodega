/**
 * Permisos que sólo un administrador puede conceder, además de los del módulo
 * `admin`.
 *
 * USR-001 (auditoría 2026-09-14): la concesión de permisos a un usuario sólo
 * bloqueaba los del módulo `admin` (`p.module === "admin"`). Pero `admin:users`
 * no es exclusivo del administrador —el manifiesto lo concede también a
 * `secretaria` y a `prevencionista`—, y las llaves que desactivan la segregación
 * de funciones de Prevención pertenecen al módulo `prevention`. Es decir:
 * cualquiera que administrara usuarios podía concederse a sí mismo las
 * excepciones que tres módulos construyeron con cuidado, y después verificar su
 * propia CAPA, publicar la MIPER que aprobó o autorizar el reinicio de un
 * trabajo que él mismo investigó.
 *
 * La lista es explícita a propósito: un permiso nuevo con consecuencias de
 * gobierno tiene que agregarse acá de forma deliberada, no heredarla por vivir
 * en cierto módulo.
 */
export const SENSITIVE_GRANT_PERMISSIONS: ReadonlySet<string> = new Set([
  // Excepciones fundamentadas a la segregación de funciones de Prevención.
  "prevention:risk:override_segregation",
  "prevention:capa:override_segregation",
  "prevention:incidents:override_segregation",
  // Firmar el propio trabajo: aprobar, publicar o cerrar un registro en cuyas
  // etapas previas la persona ya participó.
  "prevention:sign_own_work",
])

/**
 * `true` cuando conceder este permiso exige ser administrador, ya sea por
 * pertenecer al módulo `admin` o por estar en la lista sensible.
 */
export function isSensitiveGrant(permission: { name: string; module: string }): boolean {
  return permission.module === "admin" || SENSITIVE_GRANT_PERMISSIONS.has(permission.name)
}
