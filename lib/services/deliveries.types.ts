/**
 * Types for the deliveries service.
 */
export interface DeliveryAttachmentInput {
  fileName: string
  filePath: string
  fileSize: number
  mimeType: string
}

export interface WorkerStockDeliveryItemInput {
  productId: string
  quantity: number
  /**
   * Optional link to an already-received request item. It is only valid when
   * the product is being delivered from that worker's faena stock, preserving
   * the OC → recepción → entrega traceability cap.
   */
  requestItemId?: string | null
  notes?: string | null
  /**
   * ENT-002 (auditoría 2026-09-14): el canje "entrego nuevo, retiro usado".
   * Las columnas existían en `delivery_items` y la impresión y la trazabilidad
   * las mostraban, pero ningún llamador las escribía. Opcional: una entrega sin
   * canje sigue siendo lo normal.
   *
   * `returnProductId` es el producto del catálogo cuando el EPP retirado está
   * catalogado; `returnProductNameFree` cubre lo que no lo está (una prenda
   * antigua, un modelo descontinuado) sin obligar a inventar una ficha.
   */
  returnProductId?: string | null
  returnProductNameFree?: string | null
  returnQuantity?: number | null
  returnReason?: string | null
  returnNotes?: string | null
}

export interface RegisterWorkerStockDeliveryInput {
  sourceWorksiteId: string
  workerId: string
  items: WorkerStockDeliveryItemInput[]
  /** Fecha civil "YYYY-MM-DD" del comprobante. Ausente ⇒ ahora. */
  deliveredAt?: string | null
  deliveredBy: string
  userEmail?: string
  receiverName?: string | null
  notes?: string | null
  proofAttachment?: DeliveryAttachmentInput | null
}
