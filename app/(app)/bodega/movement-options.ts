/** Contrato de `GET /api/bodega/opciones?faena=<id>`. */

export interface WorksiteProductOption {
  productId:     string
  productName:   string
  productSku:    string | null
  unitOfMeasure: string
  /** Saldo actual en la faena. Viaja siempre: corregir un número que no ves es
   *  como se registran los ajustes equivocados. */
  quantity:      number
  /** La faena tiene o tuvo movimientos de este producto. El conteo físico
   *  ofrece por defecto lo que tiene saldo **o** movimientos: un producto en 0
   *  que se movió es justo el que conviene recontar. */
  hasMovements:  boolean
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
}
