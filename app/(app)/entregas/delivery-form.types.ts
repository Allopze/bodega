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
  /**
   * Tallas habituales del padrón. Sólo sugieren y etiquetan la opción: una
   * entrega excepcional de otra talla sigue siendo válida.
   */
  sizeTop: string | null
  sizeBottom: string | null
  sizeShoe: string | null
  sizeGloves: string | null
  sizeHelmet: string | null
}

export interface DeliveryStockProductOption {
  sourceWorksiteId: string
  productId: string
  productName: string
  productSku: string | null
  isEpp: boolean
  unitOfMeasure: string
  stockQuantity: number
  /**
   * Familia y talla de la variante. La variante **es** el producto, así que
   * estos campos sólo describen la fila que ya identifica `productId`: no son
   * un eje nuevo, y el formulario sigue enviando `productId`.
   *
   * `sizeLabel` es null en los productos sin talla (casco, lentes), y entonces
   * el formulario no pide talla en vez de mostrar un selector vacío.
   */
  familyId: string | null
  familyName: string | null
  sizeLabel: string | null
  sizeAttributeName: string | null
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
