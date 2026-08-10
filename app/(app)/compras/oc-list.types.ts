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

/**
 * El texto del confirm de "Eliminar OC", único para los tres lugares que
 * disparan `deleteOrderAction`: fila de escritorio, tarjeta móvil y menú de la
 * ficha. Había uno por sitio y no coincidían: dos prometían borrado permanente
 * "junto con sus ítems y facturas adjuntas" y el tercero decía que la orden se
 * conservaba. Lo que hace `deleteOrder` es lo segundo —marca `deletedAt`,
 * devuelve a pendiente sólo los ítems que ninguna otra OC cubre, y deja los
 * archivos en la auditoría—, así que los dos primeros prometían una destrucción
 * que no ocurre, en el único diálogo cuyo trabajo es describir con exactitud lo
 * que está por ejecutarse.
 */
export function ocDeleteConfirmDescription(code: string): string {
  return `La orden ${code} sale de la bandeja de Compras. Sus ítems vuelven a estado pendiente si ninguna otra OC los cubre, y la orden se conserva en la auditoría junto con sus archivos. No se puede deshacer.`
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
