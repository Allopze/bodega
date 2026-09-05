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

    // TR-06 (auditoría 2026-09-05): el comparar totales históricos dejaba un
    // déficit intermedio tapado por una recepción posterior. Recorrer los
    // eventos por fecha, acumulando el saldo en faena, detecta el exceso en el
    // momento de la salida aunque el total vuelva a cuadrar después. Las
    // entregas anteriores a la primera recepción no cuentan en este código: ese
    // caso ya se reporta con `DELIVERY_BEFORE_FAENA_RECEIPT`, que describe
    // mejor un flujo salido antes de que existiera stock.
    const balanceExcess = detectIntermediateExcessAfterFirstReceipt(item, effectiveFaenaReceipts)

    // Un saldo negativo cronológico puede ser mayor que el exceso de totales
    // (p.ej. 5 recibidos, 10 entregados, 5 recibidos → 5). Se conserva como
    // `DELIVERY_EXCEEDS_FAENA_RECEIPT` con el exceso máximo durante el flujo.
    const totalExcess = Math.max(0, delivered - receivedAtFaena)
    const excessQuantity = Math.max(totalExcess, balanceExcess)
    if (excessQuantity > QUANTITY_EPSILON) {
      findings.push({
        code: "DELIVERY_EXCEEDS_FAENA_RECEIPT",
        findingKey: `${item.requestItemId}:delivery-exceeds-faena-receipt:${receivedAtFaena}:${delivered}:${balanceExcess}`,
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

/**
 * Mayor exceso intermedio de entregas sobre el saldo recibido en faena, para
 * entregas que ocurren DESPUÉS de la primera recepción.
 *
 * Convierte recepciones y entregas en una línea de tiempo, aplica cada
 * recepción primero cuando dos eventos comparten instante (una recepción
 * registrada al mismo timestamp que una entrega es anterior en el flujo) y
 * devuelve cuántas unidades se entregaron sin respaldo en el momento de la
 * salida. 0 indica que ningún flujo posterior a la primera recepción salió por
 * encima del saldo acumulado. Las entregas anteriores a cualquier recepción se
 * ignoran: están cubiertas por `DELIVERY_BEFORE_FAENA_RECEIPT`.
 */
function detectIntermediateExcessAfterFirstReceipt(
  item: TraceabilityIntegrityItem,
  faenaReceipts: TraceabilityReceiptCheckpoint[],
): number {
  const firstReceiptAt = faenaReceipts
    .map((receipt) => receipt.receivedAt)
    .filter(Boolean)
    .sort()[0]

  interface ChronoEvent {
    at: string
    kind: "receipt" | "delivery"
    amount: number
  }
  const events: ChronoEvent[] = [
    ...faenaReceipts.map((receipt) => ({
      at: receipt.receivedAt,
      kind: "receipt" as const,
      amount: receiptQuantity(receipt, "quantityReceived"),
    })),
    ...item.deliveries
      // Sólo entregas con fecha, posteriores o simultáneas a la primera
      // recepción. Las anteriores están reportadas por otro código.
      .filter((delivery) => firstReceiptAt && delivery.deliveredAt >= firstReceiptAt)
      .map((delivery) => ({
        at: delivery.deliveredAt,
        kind: "delivery" as const,
        amount: quantity(delivery.quantity),
      })),
  ].sort((a, b) => {
    // Desempate estable: mismo instante, la recepción va antes que la salida.
    if (a.at !== b.at) return a.at < b.at ? -1 : 1
    if (a.kind !== b.kind) return a.kind === "receipt" ? -1 : 1
    return 0
  })

  let balance = 0
  let maxExcess = 0
  for (const event of events) {
    if (event.kind === "receipt") {
      balance += event.amount
    } else {
      const over = event.amount - balance
      if (over > maxExcess) maxExcess = over
      // Las unidades sin respaldo se restan del balance igualmente: el déficit
      // no se recupera entregando dos veces lo mismo.
      balance = Math.max(0, balance - event.amount)
    }
  }
  return maxExcess
}
