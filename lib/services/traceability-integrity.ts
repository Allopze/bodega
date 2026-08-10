const QUANTITY_EPSILON = 0.000_001

export type TraceabilityIntegrityCode =
  | "DELIVERY_EXCEEDS_FAENA_RECEIPT"
  | "DELIVERY_BEFORE_FAENA_RECEIPT"

export interface TraceabilityReceiptCheckpoint {
  quantityReceived: number
  quantityRejected?: number
  quantityDamaged?: number
  locationType: "office" | "faena"
  worksiteId: string | null
  receivedAt: string
}

export interface TraceabilityDeliveryCheckpoint {
  quantity: number
  deliveredAt: string
}

export interface TraceabilityIntegrityItem {
  requestItemId: string
  requestCode: string
  worksiteId: string
  deliveryMode: "via_oficina" | "directo_faena"
  orderedQuantity: number
  cancelledOrderedQuantity: number
  receipts: TraceabilityReceiptCheckpoint[]
  /**
   * Sólo salidas con requestItemId. Las salidas libres de bodega son válidas,
   * pero no pertenecen a la cadena trazable y nunca se ingresan aquí.
   */
  deliveries: TraceabilityDeliveryCheckpoint[]
}

export interface TraceabilityIntegrityFinding {
  code: TraceabilityIntegrityCode
  findingKey: string
  requestItemId: string
  worksiteId: string
  excessQuantity?: number
  snapshot: Record<string, unknown>
}

function quantity(value: number) {
  return Number.isFinite(value) && value > 0 ? value : 0
}

function receiptQuantity(receipt: TraceabilityReceiptCheckpoint, key: "quantityReceived" | "quantityRejected" | "quantityDamaged") {
  return quantity(receipt[key] ?? 0)
}

function faenaCheckpoints(item: TraceabilityIntegrityItem) {
  return item.receipts.filter((receipt) => (
    receipt.locationType === "faena"
    && receipt.worksiteId === item.worksiteId
  ))
}

/**
 * Detecta excepciones históricas sin modificar solicitudes, recepciones ni
 * entregas. La resolución se registra en una tabla append-only separada.
 */
export function detectTraceabilityIntegrity({
  items,
}: {
  items: TraceabilityIntegrityItem[]
}): TraceabilityIntegrityFinding[] {
  return items.flatMap((item) => {
    const checkpointsAtFaena = faenaCheckpoints(item)
    const effectiveFaenaReceipts = checkpointsAtFaena.filter((receipt) => (
      receiptQuantity(receipt, "quantityReceived") > QUANTITY_EPSILON
    ))
    const receivedAtFaena = effectiveFaenaReceipts.reduce((sum, receipt) => sum + receiptQuantity(receipt, "quantityReceived"), 0)
    const rejectedAtFaena = checkpointsAtFaena.reduce((sum, receipt) => sum + receiptQuantity(receipt, "quantityRejected"), 0)
    const damagedAtFaena = checkpointsAtFaena.reduce((sum, receipt) => sum + receiptQuantity(receipt, "quantityDamaged"), 0)
    const delivered = item.deliveries.reduce((sum, delivery) => sum + quantity(delivery.quantity), 0)
    const firstFaenaReceiptAt = effectiveFaenaReceipts
      .map((receipt) => receipt.receivedAt)
      .filter(Boolean)
      .sort()[0] ?? null
    const commonSnapshot = {
      requestCode: item.requestCode,
      deliveryMode: item.deliveryMode,
      orderedQuantity: item.orderedQuantity,
      cancelledOrderedQuantity: item.cancelledOrderedQuantity,
      hasCancelledOrderContext: item.cancelledOrderedQuantity > QUANTITY_EPSILON,
      receivedAtFaena,
      rejectedAtFaena,
      damagedAtFaena,
      delivered,
      firstFaenaReceiptAt,
      receiptCountAtFaena: checkpointsAtFaena.length,
      effectiveFaenaReceiptCount: effectiveFaenaReceipts.length,
      tracedDeliveryCount: item.deliveries.length,
    }
    const findings: TraceabilityIntegrityFinding[] = []

    if (delivered - receivedAtFaena > QUANTITY_EPSILON) {
      const excessQuantity = delivered - receivedAtFaena
      findings.push({
        code: "DELIVERY_EXCEEDS_FAENA_RECEIPT",
        findingKey: `${item.requestItemId}:delivery-exceeds-faena-receipt:${receivedAtFaena}:${delivered}`,
        requestItemId: item.requestItemId,
        worksiteId: item.worksiteId,
        excessQuantity,
        snapshot: { ...commonSnapshot, excessQuantity },
      })
    }

    if (firstFaenaReceiptAt && item.deliveries.some((delivery) => delivery.deliveredAt < firstFaenaReceiptAt)) {
      findings.push({
        code: "DELIVERY_BEFORE_FAENA_RECEIPT",
        findingKey: `${item.requestItemId}:delivery-before-faena-receipt:${firstFaenaReceiptAt}`,
        requestItemId: item.requestItemId,
        worksiteId: item.worksiteId,
        snapshot: commonSnapshot,
      })
    }

    return findings
  })
}
