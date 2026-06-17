/**
 * Shared types for the request form and its sub-components.
 */

// ── External option types (passed as props from the server page) ──────────────

export interface ProductOption {
  id:              string
  sku:             string
  name:            string
  isEpp:           boolean
  unitOfMeasure:   string
  categoryName:    string
  referencePrice:  number | null
  attributes:      { id: string; name: string; type: string; isRequired: boolean; options: string | null }[]
}

export interface WorksiteOption {
  id: string
  name: string
}

export interface SupplierOption {
  id:   string
  name: string
}

export interface EditRequest {
  id:          string
  code:        string
  worksiteId:  string
  requestType: string
  urgency:     string
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
  attributes:          { attributeId: string | null; attributeName: string; value: string }[]
}

// ── Internal item state ───────────────────────────────────────────────────────

export interface ItemRow {
  _key:                string
  id?:                 string
  productId:           string | null
  productNameFree:     string
  quantity:            string
  unitOfMeasure:       string
  urgency:             string
  suggestedSupplierId: string
  supplierHint:        string
  notes:               string
  attributes:          AttrRow[]
  isEpp:               boolean
  productName:         string
  showAttrs:           boolean
}

export interface AttrRow {
  attributeId:   string | null
  attributeName: string
  value:         string
  isRequired:    boolean
  type:          string
  options:       string[]
}
