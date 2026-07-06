export interface OcDetailItem {
  id: string
  requestItemId: string | null
  productId: string | null
  productNameFree: string | null
  quantity: number
  unitOfMeasure: string
  unitPrice: number
  subtotal: number
  notes: string | null
}

export interface OcDetailOrder {
  code: string
  status: string
  netAmount: number
  taxAmount: number
  totalAmount: number
  paymentTerms: string | null
  estimatedDelivery: string | null
  notes: string | null
  items: OcDetailItem[]
  worksite: { name: string } | null
  supplier: { name: string } | null
}
