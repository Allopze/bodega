import type { warehouses, products, warehouseStock, inventoryMovements } from "@/db/schema"

export interface Warehouse {
  id: string
  name: string
  code: string
  type: string
  isActive: boolean
}

export interface WarehouseStockWithProduct {
  id: string
  warehouseId: string
  productId: string
  quantity: number
  reservedQty: number
  minStock: number
  lastMovementAt: string | null
  updatedAt: string
  product: { name: string; sku: string | null; unitOfMeasure: string } | null
}

export interface InventoryMovementWithRelations {
  id: string
  warehouseId: string
  productId: string
  type: string
  quantity: number
  stockAfter: number
  performedAt: string
  reason: string | null
  notes: string | null
  product: { name: string } | null
  warehouse: { name: string } | null
}
