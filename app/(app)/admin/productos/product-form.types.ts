export interface Category  { id: string; name: string; slug: string }
export interface Supplier  { id: string; name: string }

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
  editProduct?:  ProductForEdit | null
  variant?:      "sheet" | "embedded"
}

export const UOM_OPTIONS = ["unidad", "par", "caja", "paquete", "rollo", "metro", "kg", "litro", "juego", "set"]
