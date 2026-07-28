export interface ReceiptOcItem {
  id:                   string   // purchaseOrderItemId
  requestItemId:        string | null
  productName:          string
  productSku:           string | null
  isEpp?:                boolean
  quantity:             number
  quantityOfficeReceived: number
  quantityReceived:     number   // already received in previous receipts
  unitOfMeasure:        string
  notes:                string | null
}

export type ReceiptStage = "office" | "faena"
