/**
 * Segregación de funciones sobre actos que mueven dinero.
 *
 * Patrón P9 de la auditoría 2026-09-14. La plataforma **sabe** hacer esto y lo
 * hace bien en varios sitios: la MIPER exige cuatro firmas, una CAPA se verifica
 * con alguien distinto de quien la creó y la ejecutó, una propuesta de venta no
 * la aprueba quien la preparó, los costos de una mantención no los aprueba quien
 * abrió la orden. Faltaba justo en los dos puntos donde se reconoce una
 * obligación de pago (`FAC-004`) y donde se declara que entró dinero
 * (`COB-002`), y en ambos un solo permiso cubría el acto y su reverso.
 *
 * Lo que había en su lugar eran controles **de rastro** —motivo obligatorio,
 * huella de la evidencia, auditoría en cada paso— y son buenos, pero un rastro
 * documenta quién lo hizo, no impide que la misma persona lo haga y lo deshaga.
 *
 * Dos reglas, deliberadamente separadas: la capacidad (¿tiene el permiso de
 * revertir, que es distinto del de registrar?) y la persona (¿es alguien
 * distinto del que lo hizo?). Un permiso sin la segunda deja de ser segregación
 * en cuanto alguien reúne los dos permisos, que es lo normal en una empresa
 * pequeña.
 */

export interface SegregationSubject {
  /** Quién ejecutó el acto que ahora se quiere deshacer o aprobar. */
  actedByUserId: string | null | undefined
  /** Quién lo está intentando ahora. */
  actorUserId: string
}

export interface SegregationDecision {
  ok: boolean
  /** Por qué no, en lenguaje que pueda leer quien lo intentó. */
  message?: string
}

/**
 * `null` en `actedByUserId` es un acto **del sistema** —una sugerencia
 * automática, una conciliación por lote—, y ahí no hay a quién separar: nadie
 * se está aprobando a sí mismo. Bloquearlo convertiría la regla en un estorbo
 * sin ganar control.
 */
export function requireDifferentActor(
  subject: SegregationSubject,
  what: string,
): SegregationDecision {
  if (!subject.actedByUserId) return { ok: true }
  if (subject.actedByUserId !== subject.actorUserId) return { ok: true }
  return {
    ok: false,
    message: `${what} debe hacerlo una persona distinta de quien lo registró. `
      + "Pídeselo a otra persona con el permiso correspondiente.",
  }
}
