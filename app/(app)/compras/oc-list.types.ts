export interface OcRow {
  id:              string
  code:            string
  worksiteName:    string
  supplierName:    string
  status:          string
  itemCount:       number
  totalAmount:     number
  invoiceCount:    number
  issuedAt:        string | null
  sentAt:          string | null
  createdAt:       string
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
