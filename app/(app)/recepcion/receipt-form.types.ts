export interface ReceiptOcItem {
  id:                   string   // purchaseOrderItemId
  requestItemId:        string | null
  productName:          string
  productSku:           string | null
  quantity:             number
  quantityOfficeReceived: number
  quantityReceived:     number   // already received in previous receipts
  /**
   * REC-002: lo ya **dispuesto** en cada etapa —recibido + rechazado + dañado—,
   * que es contra lo que el servidor descuenta el saldo. Lo recibido solo no
   * alcanza: una línea rechazada en oficina seguía apareciendo pendiente.
   */
  quantityOfficeDisposed: number
  quantityFaenaDisposed:  number
  unitOfMeasure:        string
  notes:                string | null
  isEmergencyService?:   boolean
  emergencyResourceLabel?: string | null
}

export type ReceiptStage = "office" | "faena"
