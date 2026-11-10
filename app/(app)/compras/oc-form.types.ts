/**
 * Repuesto de catálogo que Compras vinculó a una línea desde la hoja «Catalogar»:
 * su identidad y el precio vigente por proveedor (`supplierId` → precio). El
 * vínculo ya está guardado en el ítem de solicitud (FF-6); aquí es lo que el
 * formulario necesita para mostrarlo sin recargar.
 */
export type { SparePartLinkInfo as LinkedSparePart } from "@/lib/services/purchasing-module/spare-part-link"

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
  /**
   * Precio unitario que el solicitante estimó al pedir el repuesto. Es una
   * referencia declarada, no un compromiso: sólo prefija el precio cuando no
   * hay adjudicación de una línea que la reemplace.
   */
  estimatedUnitPrice?:    number | null
  /** Equipo de flota para el que se pidió («KA-63 · ABCD-12»), cuando lo hay. */
  vehicleLabel?:          string | null
  /** Folio de la OT de mantención que originó el pedido, cuando la hay. */
  workOrderFolio?:        string | null
  /** Tipo de la solicitud de origen (`repuestos`, `epp`…): sólo `repuestos` se cataloga. */
  requestType?:           string
  /** Id del equipo de flota: ordena el buscador del catálogo (lo ya comprado para él, primero). */
  vehicleId?:             string | null
  /** N° de parte que escribió quien pidió (texto libre), para sugerir el repuesto y precargar el alta. */
  requestedPartNumber?:   string | null
  /** El producto de la línea es un repuesto del catálogo (vinculado al pedir o al armar la OC). */
  isSparePart?:           boolean
  /** N° de parte del repuesto de catálogo vinculado. */
  partNumber?:            string | null
  /**
   * El vínculo con el repuesto lo hizo Compras desde «Catalogar» (no quien pidió) y se puede
   * quitar mientras el ítem no tenga OC: la línea ofrece «Desvincular».
   */
  linkedFromSheet?:       boolean
}

export interface OcItemRow extends PendingItemOption {
  /** `null` = costo pendiente. Sólo lo admiten los ítems de servicio. */
  unitPrice:        number | null
  discount:         number
  targetSupplierId: string
  /** Per-item supplier override set by the user. When empty, falls back to suggestedSupplierId or global supplierId. */
  itemSupplierOverrideId?: string
}
