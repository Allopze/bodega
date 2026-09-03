import type {
  ComputedStatus,
  ComputeStatusParams,
  PendingBreakdown,
} from "./trazabilidad-consolidated.types"

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
  if (delivered >= requested && requested > 0) return "entregado"
  if (delivered > 0) return "parcialmente_entregado"

  const target = inOc > 0 ? inOc : (approved ?? requested)

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
  const effectiveRequested = params.approved !== null ? params.approved : params.requested
  const pendingTotal = Math.max(0, params.requested - params.delivered)

  const notYetOrdered = Math.max(0, effectiveRequested - params.inOc)
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
