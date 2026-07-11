export interface Category  { id: string; name: string; slug: string; isEpp?: boolean; requiresPrevencion?: boolean }
export interface Supplier  { id: string; name: string }
export interface ProductUnitOption { code: string; label: string; isActive?: boolean }

export interface AttributeTemplateOption {
  id: string
  categoryId: string
  categoryName?: string
  name: string
  type: "text" | "select" | "number"
  isRequired: boolean
  options: string
  sortOrder: number
}

export interface AttributeRow {
  id?: string
  name: string
  type: "text" | "select" | "number"
  isRequired: boolean
  options: string
  sortOrder: number
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
