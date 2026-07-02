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
}

export interface OcItemRow extends PendingItemOption {
  unitPrice:        number
  discount:         number
  targetSupplierId: string
}
