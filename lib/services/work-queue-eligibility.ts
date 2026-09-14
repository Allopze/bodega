/**
 * Qué puede hacer de verdad quien mira la cola.
 *
 * `PEND-001` (auditoría 2026-09-14). La bandeja se anuncia como «todo lo que
 * requiere tu acción», pero varias ramas seleccionaban sus filas con un permiso
 * `:view` y las etiquetaban con una CTA de ejecución: «Registrar cumplimiento»,
 * «Verificar corrección», «Convocar sesión». Al seguir el enlace, la pantalla
 * escondía el control o el Server Action rechazaba la operación. La persona
 * recibía una alerta que no podía resolver, y el contador de pendientes de un
 * perfil de lectura contaba tareas ajenas.
 *
 * Las ramas operacionales —compras, recepciones, entregas, aprobaciones— nunca
 * tuvieron el problema: cada una se abre con el permiso de **su** acción
 * (`purchasing:send_order`, `receiving:register_faena`…). Esto extiende ese
 * criterio, ya presente en el mismo archivo, a las ramas de prevención.
 *
 * **Qué NO hace.** No decide qué se ve, sólo qué se ofrece **como tarea**. Un
 * perfil de lectura sigue entrando a cada módulo y leyendo lo suyo; lo que deja
 * de recibir es una fila que le promete una acción que su cuenta no puede
 * completar.
 */

/** Las ramas de la cola cuya elegibilidad no se resolvía por la acción. */
export type WorkQueueSource =
  | "pdtp"
  | "pdtp_capa"
  | "capa"
  | "documentacion"
  | "ppa"
  | "sst"
  | "cphs"
  | "pago_compra"

/**
 * El permiso que exige de verdad el destino de la CTA de cada rama. Cada uno
 * está tomado del `requirePermission` de la acción correspondiente, no de la
 * pantalla que la contiene.
 */
export const WORK_QUEUE_ACTION_PERMISSIONS: Record<WorkQueueSource, readonly string[]> = {
  // «Registrar cumplimiento» / «Ejecutar actividad» →
  // app/(app)/prevencion/pdtp/actions/executions.ts y obligaciones/actions.ts.
  pdtp: ["prevention:pdtp:execute", "prevention:pdtp:manage"],
  // «Abrir acción» sobre una CAPA nacida del PDTP. NO es el permiso de CAPA:
  // `jefe_terreno`, `admin_contrato` y `supervisor_terreno` gestionan estas
  // acciones con `prevention:pdtp:action:manage` y no ven el módulo CAPA
  // —quitarles la fila les borraría su trabajo, que es lo que la rama existente
  // ya documenta—.
  pdtp_capa: ["prevention:pdtp:action:manage"],
  // «Avanzar acción»: cada transición pide su propio permiso
  // (`permissionForTransition` en app/(app)/prevencion/capa/actions.ts), así que
  // basta cualquiera de ellos para tener algo que hacer aquí.
  capa: [
    "prevention:capa:manage", "prevention:capa:complete",
    "prevention:capa:verify", "prevention:capa:close",
  ],
  // «Revisar documento» / «Abrir documento» → app/(app)/prevencion/documentacion
  documentacion: ["prevention:docs:review", "prevention:docs:manage"],
  // «Revisar caso PPA» / «Verificar corrección» / «Autorizar reinicio» →
  // app/(app)/prevencion/ppa/actions.ts
  ppa: ["ppa:review", "ppa:verify", "ppa:authorize_restart"],
  // «Registrar seguimiento» → app/(app)/prevencion/actions/followups.ts
  sst: ["sst:manage"],
  // «Convocar sesión» / «Revisar mandato» / «Cerrar actividad» →
  // app/(app)/prevencion/cphs/actions.ts
  cphs: ["prevention:cphs:manage"],
  /*
   * `E2E-004`: el pago de una factura de proveedor. La rama nace ya con el
   * permiso de la acción y no con un `:view`, por la razón que documenta la
   * cabecera de este archivo.
   *
   * `billing:confirm_payments` es el permiso de quien afirma que un pago
   * ocurrió (`registerManualPaymentAction`, `app/(app)/facturacion/cobranza/
   * actions.ts`). Es el único perfil que puede hacer algo con esta fila: para
   * cualquier otro sería una alerta sin salida.
   *
   * PENDIENTE DE PRODUCTO, y por eso la CTA dice «Revisar pago» y no
   * «Registrar pago»: hoy el control para registrar un pago sólo se dibuja en
   * la pantalla de cobranza, que es exclusivamente de venta
   * (`direction = 'sale'`). El destino de esta fila —la ficha de la factura—
   * muestra el estado, los pagos y el saldo, pero no tiene el formulario. Que
   * exista una bandeja de cuentas por pagar depende de decidir cuál de los dos
   * libros manda sobre el pago de una compra, que es exactamente lo que
   * `E2E-003` dejó abierto. Esta rama cierra la ceguera de la cola; no la
   * brecha de producto.
   */
  pago_compra: ["billing:confirm_payments"],
}

/**
 * ¿Esta sesión puede completar lo que la rama promete?
 *
 * `permissions` es la lista efectiva de la sesión. Se comprueba sólo el permiso
 * de acción: tenerlo sin el `:view` del módulo no es una combinación que el
 * catálogo de roles produzca, y si la produjera, quien puede ejecutar puede ver.
 */
export function canActOnQueueSource(permissions: readonly string[], source: WorkQueueSource): boolean {
  return WORK_QUEUE_ACTION_PERMISSIONS[source].some((permission) => permissions.includes(permission))
}

/** Las ramas que esta sesión sí puede resolver. Útil para explicar una cola vacía. */
export function actionableQueueSources(permissions: readonly string[]): WorkQueueSource[] {
  return (Object.keys(WORK_QUEUE_ACTION_PERMISSIONS) as WorkQueueSource[])
    .filter((source) => canActOnQueueSource(permissions, source))
}
