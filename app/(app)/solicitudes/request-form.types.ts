/**
 * Shared types for the request form and its sub-components.
 */

// ── External option types (passed as props from the server page) ──────────────

export interface ProductOption {
  id:              string
  sku:             string
  name:            string
  isEpp:           boolean
  /** Servicio: se solicita sin precio y su costo se registra al facturarlo. */
  isService:       boolean
  /** El ítem se pide para una persona concreta (vacunas, exámenes). */
  requiresWorker:  boolean
  /** Familia de equipos que atiende el servicio ('monogas', 'alcotest'). */
  equipmentKind:   string | null
  unitOfMeasure:   string
  categoryName:    string
  referencePrice:  number | null
  isInactive?:     boolean
  familyId:        string | null
  preferredSupplierId: string | null
  attributes:      { id: string; name: string; type: string; isRequired: boolean; options: string | null; drivesQuantity: boolean }[]
}

export interface WorksiteOption {
  id: string
  name: string
}

export interface SupplierOption {
  id:   string
  name: string
}

/** Instrumento del registro que un servicio puede atender. */
export interface EquipmentOption {
  id:         string
  code:       string
  name:       string
  kind:       string
  worksiteId: string
}

export interface WorkerOption {
  id:         string
  firstName:  string
  lastName:   string
  rut?:       string | null
  sizeTop:    string | null
  sizeBottom: string | null
  sizeShoe:   string | null
  sizeGloves: string | null
  sizeHelmet: string | null
}

export interface EditRequest {
  id:          string
  code:        string
  worksiteId:  string
  requestType: string
  urgency:     string
  deliveryMode?: string | null
  requiredDate: string | null
  status:      string
  notes:       string | null
  items:       EditItem[]
}

export interface EditItem {
  id:                  string
  productId:           string | null
  productNameFree:     string | null
  quantity:            number
  unitOfMeasure:       string
  urgency:             string
  suggestedSupplierId: string | null
  supplierHint:        string | null
  notes:               string | null
  status:              string
  /** Colaborador del ítem (EPP nominado, vacunas). */
  workerId:            string | null
  workerName:          string | null
  /** Equipo del registro (mantención de monogás, calibración de alcotest). */
  equipmentCode:       string | null
  equipmentLabel:      string | null
  attributes:          { attributeId: string | null; attributeName: string; value: string }[]
}

// ── Internal item state ───────────────────────────────────────────────────────

export interface ItemRow {
  _key:                string
  id?:                 string
  status?:             string
  productId:           string | null
  productNameFree:     string
  quantity:            string
  unitOfMeasure:       string
  urgency:             string
  suggestedSupplierId: string
  supplierHint:        string
  notes:               string
  attributes:          AttrRow[]
  variantQuantities:   Record<string, number>
  workerId:            string
  workerName:          string
  /** Código interno del equipo; el registro lo da de alta si no lo tenía. */
  equipmentCode:       string
  equipmentLabel:      string
  isEpp:               boolean
  productName:         string
  showAttrs:           boolean
  cotizaciones:        PendingCotizacion[]
  /** Brecha de EPP que originó un ítem precargado; reserva su cupo al crear. */
  replenishmentGapKey?: string
  // Equipment data — only used by quotation types (repuestos/servicios).
  // Persisted as request item attributes via {REPUESTO,SERVICE}_ATTRIBUTE_NAMES.
  partNumber:          string
  location:            string
  equipmentName:       string
  patent:              string
  brand:               string
  model:               string
}

/**
 * Ítem con el que se abre el creador: sugerencia de reposición de EPP
 * (`?reposicion=1`) o copia de otra solicitud (`?desde=`).
 */
export interface PrefillItem {
  productId:            string | null
  productNameFree:      string
  quantity:             number
  unitOfMeasure:        string
  urgency:              string
  notes:                string
  workerId?:            string | null
  workerName?:          string | null
  equipmentCode?:       string | null
  equipmentLabel?:      string | null
  suggestedSupplierId?: string | null
  supplierHint?:        string | null
  replenishmentGapKey?: string
  /** Atributos ya cargados (copia de otra solicitud), por nombre y valor. */
  attributes?:          { attributeId: string | null; attributeName: string; value: string }[]
}

export interface PendingCotizacion {
  _id:       string
  file:      File
  fileName:  string
  fileSize:  number
  // LOG-9/UX-3: mismos 3 campos que el panel de selección exige — sin esto,
  // toda cotización subida desde el formulario llegaba como "Proveedor sin
  // nombre · $0" y no se podía comparar para elegir ganadora.
  totalAmount:      string
  supplierId:       string
  supplierNameFree: string
}

export interface AttrRow {
  attributeId:   string | null
  attributeName: string
  value:         string
  isRequired:    boolean
  type:          string
  options:       string[]
  /** Su valor es la cantidad del ítem; el campo Cantidad pasa a ser de lectura. */
  drivesQuantity: boolean
}
