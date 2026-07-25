"use client"

import type { FilterOption } from "@/components/adquisiciones/list-filters"
import { URGENCY_OPTIONS as CANONICAL_URGENCY_OPTIONS, URGENCY_LABELS } from "@/lib/urgency-labels"

export const URGENCY_OPTIONS: FilterOption[] = CANONICAL_URGENCY_OPTIONS.map((o) => ({ value: o.value, label: o.label }))


export const REQUEST_TYPE_LABELS: Record<string, string> = {
  epp:  "EPP",
  otro: "Otro",
}

export const REQUEST_TYPE_VARIANTS: Record<string, "info" | "success" | "warning" | "default"> = {
  epp:  "info",
  otro: "default",
}

export const URGENCY_LABEL: Record<string, string> = URGENCY_LABELS

export interface ApprovalAttribute {
  attributeName: string
  value:         string
}

export interface ApprovalItem {
  id:                    string
  productName:           string
  productSku:            string | null
  quantity:              number
  unitOfMeasure:         string
  urgency:               string
  requiredDate:          string | null
  notes:                 string | null
  status:                string
  attributes:            ApprovalAttribute[]
  suggestedSupplierName?: string | null
  supplierHint?:         string | null
}

export interface ApprovalRequest {
  id:              string
  code:            string
  requestType:     string
  worksiteName:    string
  requesterName:   string
  requestUrgency:  string
  submittedAt:     string | null
  deliveryMode:    "via_oficina" | "directo_faena"
  pendingItems:    ApprovalItem[]
  pendingCount:    number
}
