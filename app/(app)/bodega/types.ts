export interface WorksiteStockWithProduct {
  id: string
  worksiteId: string
  productId: string
  quantity: number
  minStock: number
  lastMovementAt: string | null
  updatedAt: string
  product: { name: string; sku: string | null; unitOfMeasure: string } | null
  worksite: { name: string } | null
}

export interface InventoryMovementWithRelations {
  id: string
  worksiteId: string
  productId: string
  type: string
  quantity: number
  stockAfter: number
  performedAt: string
  reason: string | null
  notes: string | null
  product: { name: string } | null
  worksite: { name: string } | null
}
