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
}

export interface RegisterWorkerStockDeliveryInput {
  sourceWorksiteId: string
  workerId: string
  items: WorkerStockDeliveryItemInput[]
  deliveredBy: string
  userEmail?: string
  receiverName?: string | null
  notes?: string | null
  proofAttachment?: DeliveryAttachmentInput | null
}

export interface RegisterWorkerEppDeliveryInput {
  worksiteId: string
  workerId: string
  requestItemId: string
  quantity: number
  deliveredBy: string
  userEmail?: string
  receiverName?: string | null
  notes?: string | null
  proofAttachment?: DeliveryAttachmentInput | null
  // Return of old/discarded EPP (opcional)
  returnProductId?: string | null
  returnProductNameFree?: string | null
  returnQuantity?: number | null
  returnReason?: string | null
  returnNotes?: string | null
}
