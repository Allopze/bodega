export interface DeliveryWorksiteOption {
  id: string
  name: string
}

export interface DeliveryWorkerOption {
  id: string
  worksiteId: string
  name: string
  rut: string | null
  position: string | null
}

export interface DeliverableEppOption {
  requestItemId: string
  requestCode: string
  worksiteId: string
  productName: string
  productSku: string | null
  quantity: number
  deliveredQuantity: number
  remainingQuantity: number
  stockQuantity: number
  unitOfMeasure: string
}

export interface DeliveryReturnProductOption {
  id: string
  name: string
  sku: string | null
  unitOfMeasure: string
}
