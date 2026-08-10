/**
 * Types for the trazabilidad item detail service.
 */
export interface ItemDetailData {
  item: {
    id: string
    requestId: string
    requestCode: string
    worksiteId: string
    worksiteName: string
    productId: string | null
    productName: string
    productSku: string | null
    productNameFree: string | null
    quantity: number
    unitOfMeasure: string
    status: string
    urgency: string | null
    requiredDate: string | null
    notes: string | null
    createdAt: string
    requesterName: string
    requesterEmail: string
    attributes: Array<{ name: string; value: string }>
  }
  approvals: Array<{
    id: string
    type: string
    decidedByName: string
    decidedByEmail: string
    decidedAt: string
    reason: string | null
    modifiedQty: number | null
    roleContext: string | null
  }>
  ocItems: Array<{
    id: string
    ocId: string
    ocCode: string
    ocStatus: string
    supplierName: string
    quantity: number
    /** Puede no existir aún para un servicio cuyo costo se registra después. */
    unitPrice: number | null
    receivedAtFaena: number
    receivedAtOffice: number
  }>
  receipts: Array<{
    id: string
    code: string
    locationType: string
    receivedByName: string
    receivedAt: string
    quantityReceived: number
    quantityRejected: number
    notes: string | null
  }>
  deliveries: Array<{
    id: string
    code: string
    destinationType: string
    deliveredByName: string
    deliveredAt: string
    workerName: string | null
    worksiteName: string | null
    receiverName: string | null
    quantity: number
    returnQuantity: number | null
    returnReason: string | null
    notes: string | null
  }>
  timeline: Array<{
    id: string
    fromStatus: string | null
    toStatus: string
    changedBy: string | null
    changedAt: string
    reason: string | null
    userName: string | null
    userEmail: string | null
  }>
  inventoryMovements: Array<{
    id: string
    type: string
    quantity: number
    referenceType: string | null
    referenceId: string | null
    performedByName: string | null
    performedAt: string
    reason: string | null
    notes: string | null
    stockAfter: number | null
  }>
}
