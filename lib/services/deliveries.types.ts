/**
 * Types for the deliveries service.
 */
export interface RegisterWorksiteDeliveryInput {
  worksiteId: string
  productId: string
  requestItemId?: string | null
  quantity: number
  unitOfMeasure: string
  receiverName: string
  deliveredBy: string
  userEmail?: string
  notes?: string | null
}

export interface DeliveryAttachmentInput {
  fileName: string
  filePath: string
  fileSize: number
  mimeType: string
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
