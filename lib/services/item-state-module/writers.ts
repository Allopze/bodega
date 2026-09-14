/**
 * `E2E-002` (auditoría 2026-09-14) — Registro declarado de quién puede escribir
 * `purchase_request_items.status`.
 *
 * `purchase_request_items.status` es el único hilo continuo del flujo de
 * adquisiciones: `requested → approved → pending_purchase → in_purchase_order →
 * purchased → office_received → received → delivered`, con ramas de parcialidad
 * en casi cada tramo. La máquina existía de hecho —`ALLOWED_TRANSITIONS`,
 * `canTransition`, los rollups— pero no estaba declarada como **única**: cinco
 * módulos la escribían, cada uno con su propia guarda, y un escritor nuevo
 * tenía que redescubrir las reglas leyendo a los otros cuatro.
 *
 * Esto no cambia comportamiento: enumera la verdad que hoy está repartida y la
 * deja verificable. La prueba-guardián
 * `lib/__tests__/e2e-002-escritores-estado-item.test.ts` recorre el código
 * fuente y falla si aparece un escritor que no está aquí, o si uno declarado
 * deja de escribir. Añadir una excepción exige pasar por este archivo, que es
 * exactamente la costura que faltaba.
 */

/** Por qué un escritor está fuera del módulo de estado. */
export type ItemStatusWriterKind =
  /** El propio módulo: la máquina. Todo avance debería entrar por aquí. */
  | "state_machine"
  /**
   * Retroceso intencional. `ALLOWED_TRANSITIONS` sólo describe avances, así que
   * un rollback no puede pasar por `canTransition`: se hace con `UPDATE` guardado
   * por `WHERE status IN (...)`, que es su propia condición de carrera.
   */
  | "rollback"
  /**
   * Transición real que el mapa declarado **no** describe. No es un rollback ni
   * un avance del ciclo: es una salida lateral (cancelar, adjudicar) que hoy
   * vive fuera. Deuda declarada, no agujero.
   */
  | "undeclared_transition"

export interface ItemStatusWriter {
  /** Ruta relativa al repositorio, tal como la ve el guardián. */
  file: string
  kind: ItemStatusWriterKind
  /** Qué escribe, para poder leer el ciclo completo sin abrir seis archivos. */
  writes: string
  reason: string
}

export const ITEM_STATUS_WRITERS: readonly ItemStatusWriter[] = [
  /* ── La máquina ─────────────────────────────────────────────────────────── */
  {
    file: "lib/services/item-state-module/submit.ts",
    kind: "state_machine",
    writes: "draft → requested",
    reason: "Envío de la solicitud a aprobación.",
  },
  {
    file: "lib/services/item-state-module/approval.ts",
    kind: "state_machine",
    writes: "requested|approved → approved | rejected",
    reason: "Aprobación individual, aprobación masiva y rechazo, con lock por ítem y rollup del padre.",
  },
  {
    file: "lib/services/item-state-module/purchase-order.ts",
    kind: "state_machine",
    writes: "pending_purchase → in_purchase_order",
    reason: "Alta de la línea en una orden de compra.",
  },
  {
    file: "lib/services/item-state-module/receiving.ts",
    kind: "state_machine",
    writes: "purchased → *_received → *_delivered",
    reason: "Recepción en oficina, recepción en faena, entrega y reversa de entrega.",
  },

  /* ── Excepciones de rollback (enumeradas, no agujero) ───────────────────── */
  {
    file: "lib/services/purchasing-module/purchase-orders-status.ts",
    kind: "rollback",
    writes: "in_purchase_order → purchased (avance) y in_purchase_order|purchased → pending_purchase (anulación de OC)",
    reason:
      "Emitir la OC avanza el ítem; `cancelOrder` lo devuelve a la cola de compra si deja de tener cobertura activa. "
      + "El retroceso no cabe en `ALLOWED_TRANSITIONS` porque el mapa sólo describe avances.",
  },
  {
    file: "lib/services/purchasing-module/purchase-orders-delete.ts",
    kind: "rollback",
    writes: "in_purchase_order|purchased → pending_purchase",
    reason: "`deleteOrder`: el ítem vuelve a la cola de compra al desaparecer la orden que lo cubría.",
  },
  {
    file: "lib/services/purchasing-module/receiving.ts",
    kind: "rollback",
    writes: "in_purchase_order|purchased → pending_purchase",
    reason:
      "Cierre de una OC recibida parcialmente: la línea que no recibió nada libera su ítem y la línea de OC se anula, "
      + "para que estado y cobertura queden de acuerdo por construcción.",
  },
  {
    file: "lib/services/receiving-void.ts",
    kind: "rollback",
    writes: "*_received → received|partially_received|office_received|partially_office_received|purchased",
    reason:
      "`voidReceipt`: recalcula el estado a partir de lo que queda recibido tras anular. Retrocede, y por eso no "
      + "pasa por `canTransition`; la guarda es `WHERE status = <el leído>`.",
  },

  /* ── Transiciones reales que el mapa declarado no describe ──────────────── */
  {
    file: "lib/requests/request-service-module/cancel-request.ts",
    kind: "undeclared_transition",
    writes: "draft|requested|approved|pending_purchase → rejected",
    reason:
      "Cancelar la solicitud rechaza sus ítems. `ALLOWED_TRANSITIONS` sólo admite `rejected` desde `requested` y "
      + "`approved`, así que `draft → rejected` y `pending_purchase → rejected` existen en producción y no en el mapa. "
      + "QUEDA POR DECIDIR (producto): si rechazar individualmente un ítem ya en cola de compra debe ser posible. "
      + "Ampliar el mapa lo habilitaría también para `rejectItem`, que hoy no lo permite; por eso no se amplía aquí.",
  },
  {
    file: "lib/requests/request-service-module/select-quotation.ts",
    kind: "undeclared_transition",
    writes: "requested → approved",
    reason:
      "Adjudicar una cotización aprueba los ítems del flujo por cotización (repuestos/servicios) sin pasar por "
      + "`approveItem`, porque además fija proveedor adjudicado e importe. La transición sí está en el mapa; lo que "
      + "está fuera del módulo es el escritor.",
  },
] as const

/** Los archivos que el guardián espera encontrar escribiendo el estado. */
export const DECLARED_ITEM_STATUS_WRITER_FILES: readonly string[] =
  ITEM_STATUS_WRITERS.map((writer) => writer.file)
