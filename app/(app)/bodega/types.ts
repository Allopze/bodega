export interface WorksiteStockWithProduct {
  id: string
  worksiteId: string
  productId: string
  quantity: number
  pendingDemand: number
  incoming: number
  projectedBalance: number
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
  /** Saldo antes del movimiento. Ya viajaba en el Excel y faltaba en pantalla:
   *  sin él no se puede reconstruir un descuadre leyendo el kardex. */
  stockBefore?: number
  stockAfter: number
  performedAt: string
  reason: string | null
  notes: string | null
  /** Documento de origen. Está en la tabla desde siempre y la pantalla nunca lo
   *  mostró, así que no había forma de saltar del movimiento a su OC o guía. */
  referenceType?: string | null
  referenceId?: string | null
  /** Quién lo registró. Es lo primero que se pregunta cuando un saldo no cuadra. */
  performedByName?: string | null
  product: { name: string } | null
  worksite: { name: string } | null
}
