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
 *
 * INC-002 (auditoría 2026-09-14) — Lo que se corrigió y lo que no.
 *
 * El hallazgo: `prevention:sign_own_work` está concedida al rol
 * `prevencionista`, que en una faena es también quien ejecuta las
 * inspecciones, redacta la MIPER, propone la CAPA y participa en las
 * investigaciones. Los tres dominios que construyeron segregación comparten
 * esa misma llave, y a diferencia de los `*:override_segregation` —puntuales,
 * con motivo escrito y sólo para `administrador`— ésta se ejercía sin dejar
 * nada: `canSignOwnWork` devolvía un booleano y el registro quedaba idéntico
 * al de una firma con dos personas distintas.
 *
 * Lo corregible sin inventar política: que el uso de la excepción sea un
 * **hecho registrado**. `resolveOwnWorkSigning` distingue las tres
 * situaciones —no hay a quién separar, hay que separar y se separó, hay que
 * separar y la excepción lo permitió— y devuelve `usedException` para que el
 * llamador lo escriba en su bitácora. Una firma propia deja de ser
 * indistinguible de una firma ajena.
 *
 * Lo que queda por decidir, y no se decide acá: **a qué rol pertenece la
 * excepción**. Quitársela a `prevencionista` —o exigir un motivo por caso,
 * como los `override_segregation`— cambia quién puede cerrar el trabajo de
 * cada día en faenas que tienen una sola persona de prevención. Es una
 * decisión de la organización sobre su propio sistema de gestión; la
 * plataforma no la declara en ninguna parte y este archivo no se la inventa.
 */

import { requireDifferentActor } from "@/lib/auth/segregation"

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

export interface OwnWorkSigningDecision {
  /** Si la firma puede seguir adelante. */
  ok: boolean
  /**
   * Si para seguir adelante hizo falta la excepción, es decir: el actor
   * participó en la etapa previa y sólo `prevention:sign_own_work` lo
   * habilita. El llamador debe registrarlo en su bitácora (INC-002).
   */
  usedException: boolean
  /** Por qué no, en lenguaje que pueda leer quien lo intentó. */
  message?: string
}

/**
 * La decisión completa de la firma del último eslabón, en un solo lugar.
 *
 * Se apoya en `requireDifferentActor` (`lib/auth/segregation.ts`) para la
 * mitad que no depende de permisos: si la etapa previa la firmó otra persona
 * —o no la firmó nadie, que es un acto del sistema— no hay excepción que
 * consumir y `usedException` queda en `false`. La excepción sólo entra en
 * juego cuando de verdad haría falta separar.
 */
export function resolveOwnWorkSigning(args: {
  /** Quién firmó la etapa previa (investigó, aprobó, elaboró). */
  signedByUserId: string | null | undefined
  actorUserId: string
  permissions: readonly string[]
  /** Qué acto es, para el mensaje: "cerrar el incidente", "publicar la matriz". */
  what: string
}): OwnWorkSigningDecision {
  const separation = requireDifferentActor(
    { actedByUserId: args.signedByUserId, actorUserId: args.actorUserId },
    args.what,
  )
  if (separation.ok) return { ok: true, usedException: false }
  if (canSignOwnWork(args.permissions)) return { ok: true, usedException: true }
  return { ok: false, usedException: false, message: separation.message }
}
