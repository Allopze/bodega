/** Contrato de `GET /api/bodega/opciones?faena=<id>`. */

export interface WorksiteProductOption {
  productId:     string
  productName:   string
  productSku:    string | null
  unitOfMeasure: string
  /** Saldo actual en la faena. Viaja siempre: corregir un número que no ves es
   *  como se registran los ajustes equivocados. */
  quantity:      number
  minStock:      number
  /** `null` cuando el producto nunca tuvo movimiento en la faena y por tanto no
   *  existe fila en `worksite_stock`: no se le puede fijar mínimo todavía. */
  stockId:       string | null
}

export interface WorksiteReturnOption {
  deliveryItemId:    string
  deliveryCode:      string
  productName:       string
  productSku:        string | null
  unitOfMeasure:     string
  remainingQuantity: number
}

export interface OpenCountDraftPayload {
  id: string
  code: string
  items: Array<{ productId: string; countedQuantity: number }>
}

export interface BodegaOptions {
  /** Borrador de conteo abierto en la faena, si lo hay. */
  openCount:    OpenCountDraftPayload | null
  worksiteId:   string
  worksiteName: string
  products:     WorksiteProductOption[]
  returns:      WorksiteReturnOption[]
}
