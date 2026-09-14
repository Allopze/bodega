/**
 * Vocabulario sugerido para la condición de pago. Sugerencias, no validación:
 * proveedores y OC históricas traen valores propios que no se deben rechazar
 * (auditoría UI/UX 2026-07-29, A-30).
 */
export const PAYMENT_TERMS_OPTIONS = [
  "Contado",
  "15 días",
  "30 días",
  "45 días",
  "60 días",
  "90 días",
] as const

export interface SupplierOption {
  id:           string
  name:         string
  paymentTerms: string | null
}

export interface WorksiteOption {
  id:   string
  name: string
}

export interface PendingItemOption {
  id:                  string
  requestId:           string
  requestCode:         string
  worksiteId:          string
  worksiteName:        string
  productName:         string
  productSku:          string | null
  productId:           string | null
  productNameFree:     string | null
  quantity:            number
  unitOfMeasure:       string
  urgency:             string
  notes:               string | null
  supplierPrices:      Record<string, number>
  suggestedSupplierId?: string | null
  supplierHint?:        string | null
  deliveryMode:        "via_oficina" | "directo_faena"
  /** Servicio del catálogo: puede comprarse con el costo aún por definir. */
  isService:           boolean
  /**
   * `COT-001` (auditoría 2026-09-14): la oferta que ganó y por cuánto. El total
   * es de la **oferta completa**, no de esta línea: una oferta multiítem no dice
   * cuánto vale cada renglón. Se muestra como referencia y sólo se prefija el
   * precio cuando la adjudicación es de un único ítem, que es el caso en que el
   * total sí es determinable.
   */
  awardedQuotationId?:    string | null
  awardedQuotationTotal?: number | null
  /** Cuántas líneas comparten esa adjudicación. 1 = el total es de esta línea. */
  awardedLineCount?:      number
}

export interface OcItemRow extends PendingItemOption {
  /** `null` = costo pendiente. Sólo lo admiten los ítems de servicio. */
  unitPrice:        number | null
  discount:         number
  targetSupplierId: string
  /** Per-item supplier override set by the user. When empty, falls back to suggestedSupplierId or global supplierId. */
  itemSupplierOverrideId?: string
}
