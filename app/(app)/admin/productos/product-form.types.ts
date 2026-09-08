export interface Category  { id: string; name: string; slug: string; isEpp?: boolean; requiresPrevencion?: boolean }
export interface Supplier  { id: string; name: string }
export interface ProductUnitOption { code: string; label: string; isActive?: boolean }

export interface AttributeTemplateOption {
  id: string
  categoryId: string
  categoryName?: string
  name: string
  type: "text" | "select" | "number" | "integer"
  isRequired: boolean
  options: string
  sortOrder: number
  sizeFamily?: string
}

export interface AttributeRow {
  id?: string
  name: string
  type: "text" | "select" | "number" | "integer"
  isRequired: boolean
  options: string
  sortOrder: number
  sizeFamily?: string
  drivesQuantity?: boolean
}

export interface SupplierRow {
  id?: string
  supplierId: string
  supplierName: string
  unitPrice: string
  isPreferred: boolean
  notes: string
}

export interface ProductForEdit {
  id:                 string
  sku:                string
  name:               string
  description:        string | null
  categoryId:         string
  unitOfMeasure:      string
  isEpp:              boolean
  requiresPrevencion: boolean
  isService:          boolean
  requiresWorker:     boolean
  equipmentKind:      string | null
  referencePrice:     number | null
  notes:              string | null
  isActive:           boolean
  attributes:         AttributeRow[]
  suppliers:          SupplierRow[]
}

export interface SizeFamilyOption {
  family:        string
  attributeName: string
  codes:         string[]
}

export interface ProductFormProps {
  open:          boolean
  onClose:       () => void
  categories:    Category[]
  allSuppliers:  Supplier[]
  units:         ProductUnitOption[]
  templates:     AttributeTemplateOption[]
  /**
   * Familias de tallas del catálogo (`size_catalog`). Llegan del servidor y no
   * de una constante del bundle: agregar una talla 47 es una fila, no un
   * despliegue.
   */
  sizeFamilies:  SizeFamilyOption[]
  editProduct?:  ProductForEdit | null
  variant?:      "sheet" | "embedded"
  /**
   * Modo "añadir variante(s) a una familia ya existente": abre el asistente
   * como un alta (con generador y lote habilitados) pero precargado con la
   * identidad de la familia, para que las variantes nuevas nazcan dentro de
   * ella y no en una familia duplicada.
   */
  addVariantToFamily?: ProductFamilyForAddVariant | null
}

/** Qué operación está realizando el formulario. Determina el flujo (wizard de
 *  alta vs. secciones de edición), el texto, y el destino del guardado. */
export type ProductFormMode =
  /** Alta de uno o varios productos nuevos (asistente por pasos). */
  | "create"
  /** Edición de un producto/variante existente (una sola fila). */
  | "edit"
  /** Alta de variante(s) nuevas dentro de una familia ya existente. */
  | "addVariant"

/** Snapshot serializable que necesita el asistente para sumar variantes a una
 *  familia sin duplicar la familia ni las combinaciones ya existentes. */
export interface ProductFamilyForAddVariant {
  id:             string
  canonicalName:  string
  categoryId:     string
  categoryName:   string
  unitOfMeasure:  string
  isEpp:          boolean
  requiresPrevencion: boolean
  isActive:       boolean
  referencePrice: number | null
  /** Ficha de la familia, para verla y completarla al añadir variantes. */
  certification:  string | null
  lifespanMonths: number | null
  lifespanNotApplicable: boolean
  /** Ejes `select` (talla/color/…) tal como existen en la familia. */
  attributes:     AttributeMultiValues[]
  /** Atributos no-`select` de la familia (texto/número/conteo y el driver de
   *  cantidad). Las variantes nuevas deben nacer con los mismos, o la familia
   *  quedaría con requisitos mixtos. */
  advancedAttributes: AttributeRow[]
  /** Identidad de cada variante ya existente: pares nombre→valor normalizados
   *  y ordenados. Sirve para no ofrecer crear una combinación repetida. */
  existingVariantKeys: string[]
  supplier:       SupplierRow | null
}

// ── Wizard types for EPP creator ──────────────────────────────────────────────

export type WizardStep = 1 | 2 | 3

export interface AttributeMultiValues {
  name: string       // "Talla" | "Color" | "Talla calzado" | ...
  type: "select"
  values: string[]   // múltiples valores seleccionados
  sizeFamily?: string
}

export interface VariantAttribute {
  name: string
  value: string
}

export interface VariantCombo {
  sku: string
  name: string
  attributes: VariantAttribute[]
}

export interface WizardGeneralState {
  categoryId: string
  name: string
  description: string
  unitOfMeasure: string
  referencePrice: string
  notes: string
  isEpp: boolean
  requiresPrevencion: boolean
  isService: boolean
  requiresWorker: boolean
  equipmentKind: string
  isActive: boolean
  /** Ficha de la familia EPP (vive en `epp_product_families`, no en el producto). */
  familyCertification: string
  familyLifespanMonths: string
  familyLifespanNotApplicable: boolean
}

export interface WizardSupplierState {
  supplierId: string
  unitPrice: string
  notes: string
  hasSupplier: boolean
}

export interface WizardState {
  step: WizardStep
  general: WizardGeneralState
  attributes: AttributeMultiValues[]
  variants: VariantCombo[]
  supplier: WizardSupplierState
}

/** Result of the confirm-close decision logic. */
export type WizardCloseAction = "close-directly" | "show-confirm" | "already-closing"
