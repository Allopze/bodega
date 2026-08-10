export type OcRow = {
  id:              string
  code:            string
  worksiteName:    string
  supplierName:    string
  status:          string
  itemCount:       number
  totalAmount:     number
  /** Líneas de servicio cuyo costo aún no se conoce; no entran en totalAmount. */
  pendingCostLines: number
  invoiceCount:    number
  issuedAt:        string | null
  sentAt:          string | null
  createdAt:       string
}

/**
 * La fecha que la fila muestra: envío, si no emisión, si no creación. Vive acá
 * porque la usan el orden de la columna y las dos variantes de fila — la tabla
 * ordenaba por `createdAt` mientras mostraba esta otra, y la tarjeta móvil
 * mostraba una tercera distinta de la de escritorio para la misma OC.
 */
export function ocDisplayDate(row: Pick<OcRow, "sentAt" | "issuedAt" | "createdAt">): string {
  return row.sentAt ?? row.issuedAt ?? row.createdAt
}

export interface PendingItem {
  id:            string
  requestId:     string
  requestCode:   string
  worksiteId:    string
  worksiteName:  string
  productName:   string
  productSku:    string | null
  quantity:      number
  unitOfMeasure: string
  urgency:       string
  notes:         string | null
}
