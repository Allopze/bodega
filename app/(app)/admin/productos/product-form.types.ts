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

export interface ProductFormProps {
  open:          boolean
  onClose:       () => void
  categories:    Category[]
  allSuppliers:  Supplier[]
  units:         ProductUnitOption[]
  templates:     AttributeTemplateOption[]
  editProduct?:  ProductForEdit | null
  variant?:      "sheet" | "embedded"
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
