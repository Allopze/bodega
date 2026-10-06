export interface WorksiteStockWithProduct {
  id: string
  worksiteId: string
  productId: string
  quantity: number
  /** Lo aprobado en solicitudes que todavía no llega a esta faena. */
  incoming: number
  /** `false`: el producto nunca entró a esta faena y la fila existe sólo por
   *  lo que está por recibir. Sin registro de stock no hay kardex que mirar. */
  hasStockRecord: boolean
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
  /** Folio del documento de bodega (AJU, DES, DEV, CON) cuando el movimiento
   *  nace de uno. Los demás orígenes lo llevan escrito en el motivo o la nota. */
  documentFolio?: string | null
  /** Quién lo registró. Es lo primero que se pregunta cuando un saldo no cuadra. */
  performedByName?: string | null
  product: { name: string } | null
  worksite: { name: string } | null
}
