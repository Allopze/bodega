export interface DeliveryWorksiteOption {
  id: string
  name: string
}

export interface DeliveryWorkerOption {
  id: string
  worksiteId: string
  worksiteName: string
  name: string
  rut: string | null
  position: string | null
}

export interface DeliveryStockProductOption {
  sourceWorksiteId: string
  productId: string
  productName: string
  productSku: string | null
  isEpp: boolean
  unitOfMeasure: string
  stockQuantity: number
}

export interface DeliverableEppOption {
  requestItemId: string
  requestCode: string
  worksiteId: string
  productId: string
  productName: string
  productSku: string | null
  quantity: number
  deliveredQuantity: number
  receivedAtFaena: number
  remainingQuantity: number
  stockQuantity: number
  unitOfMeasure: string
}
