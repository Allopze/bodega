import type {
  ComputedStatus,
  ComputeStatusParams,
  PendingBreakdown,
} from "./trazabilidad-consolidated.types"

/**
 * Lo que hay que entregar es lo que se autorizó, no lo que se pidió.
 *
 * Cuando la aprobación recorta la cantidad (piden 10, aprueban 6), el
 * compromiso con la faena pasa a ser 6: entregar esas 6 cierra el ítem. Medir
 * el cierre contra `requested` dejaba el ítem en "parcialmente entregado" para
 * siempre y con 4 unidades pendientes que nadie iba a comprar nunca.
 *
 * Comprar de más tampoco sube el compromiso: `inOc` mueve las etapas físicas
 * (ver `stageTarget`), no el cierre de la entrega.
 */
export function effectiveRequestedQty(requested: number, approved: number | null): number {
  return approved !== null ? approved : requested
}

/**
 * Referencia de las etapas físicas (proveedor → oficina → tránsito → faena).
 *
 * Acá sí manda `inOc`: lo que puede llegar a bodega es lo que se le pidió al
 * proveedor, que puede diferir de lo aprobado.
 */
function stageTarget(params: { inOc: number; requested: number; approved: number | null }): number {
  return params.inOc > 0 ? params.inOc : effectiveRequestedQty(params.requested, params.approved)
}

/**
 * Calcula el estado consolidado de un ítem a partir de sus movimientos reales.
 */
export function computeItemStatus(params: ComputeStatusParams): ComputedStatus {
  const {
    itemStatus,
    requestStatus,
    requested,
    approved,
    inOc,
    receivedOffice,
    dispatched,
    receivedFaena,
    delivered,
  } = params

  if (itemStatus === "rejected" || requestStatus === "rejected") return "rechazado"
  if (itemStatus === "cancelled" || requestStatus === "cancelled") return "cancelado"
  if (itemStatus === "draft" || requestStatus === "draft") return "borrador"

  // 1. Entregas a usuario/responsable
  const committed = effectiveRequestedQty(requested, approved)
  if (delivered >= committed && committed > 0) return "entregado"
  if (delivered > 0) return "parcialmente_entregado"

  const target = stageTarget({ inOc, requested, approved })

  // 2. Llegada física a Faena
  if (receivedFaena > 0) {
    if (receivedFaena >= target) return "en_faena"
    return "parcialmente_recibido_faena"
  }

  // 3. Despacho en tránsito hacia Faena
  if (dispatched > 0) {
    if (dispatched >= target) return "enviado_faena"
    return "parcialmente_enviado_faena"
  }

  // 4. Recepción en Oficina / Bodega central
  if (receivedOffice > 0) {
    if (receivedOffice >= target) return "en_oficina"
    return "parcialmente_recibido_oficina"
  }

  // 5. Compra cursada al proveedor
  if (inOc > 0) return "pedido_proveedor"

  // 6. Aprobación técnica/financiera
  if (
    approved !== null ||
    itemStatus === "approved" ||
    itemStatus === "pending_purchase"
  ) {
    return "aprobado"
  }

  return "solicitado"
}

/**
 * Desglosa en qué etapa física o administrativa se encuentran las unidades pendientes.
 */
export function computePendingBreakdown(params: {
  requested: number
  approved: number | null
  inOc: number
  receivedOffice: number
  dispatched: number
  receivedFaena: number
  delivered: number
}): PendingBreakdown {
  const effectiveRequested = effectiveRequestedQty(params.requested, params.approved)
  // Mismo criterio que `computeItemStatus`: el saldo por entregar se mide
  // contra lo aprobado. Antes se medía contra `requested` mientras
  // `notYetOrdered` ya usaba lo aprobado, y las dos mitades del mismo desglose
  // no cuadraban entre sí.
  const pendingTotal = Math.max(0, effectiveRequested - params.delivered)

  /**
   * "Falta comprar" está acotado por lo que falta entregar.
   *
   * Sin el techo, un ítem servido completo desde el stock de la faena —que
   * nunca pasa por una OC— reportaba todas sus unidades como pendientes de
   * compra, inflaba el KPI "Pendientes de compra" y encendía la alerta ámbar
   * de una fila ya cerrada.
   */
  const notYetOrdered = Math.min(pendingTotal, Math.max(0, effectiveRequested - params.inOc))
  // `quantityOfficeReceived` y `quantityReceived` cuentan las mismas unidades
  // pasando por dos puestos de control (oficina y faena) en las OC vía
  // oficina, y sólo uno de los dos en las directo-faena: sumarlos duplicaría.
  const totalReceivedFromSupplier = Math.max(params.receivedOffice, params.receivedFaena)
  const pendingFromSupplier = Math.max(0, params.inOc - totalReceivedFromSupplier)
  const inOffice = Math.max(0, params.receivedOffice - params.dispatched)
  const inTransit = Math.max(0, params.dispatched - params.receivedFaena)
  const inFaenaAvailable = Math.max(0, params.receivedFaena - params.delivered)

  return {
    pendingTotal,
    notYetOrdered,
    pendingFromSupplier,
    inOffice,
    inTransit,
    inFaenaAvailable,
  }
}
