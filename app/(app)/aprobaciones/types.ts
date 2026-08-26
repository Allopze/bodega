"use client"

import type { ServerListFilterOption } from "@/components/ui/server-list-filters"
import { URGENCY_OPTIONS as CANONICAL_URGENCY_OPTIONS, URGENCY_LABELS } from "@/lib/urgency-labels"
import type { OperationalWorkItem } from "@/lib/services/operational-work-queue"

export const URGENCY_OPTIONS: ServerListFilterOption[] = CANONICAL_URGENCY_OPTIONS.map((o) => ({ value: o.value, label: o.label }))


// Re-export del diccionario canónico (lib/request-types.ts) en vez de una copia
// local: la copia sólo tenía epp/otro —los tipos que esta cola atiende— pero ya
// había divergido en el label ("Otro" acá, "Otros" en /solicitudes) para el
// mismo estado. Un diccionario por pantalla es el mecanismo exacto que produjo
// A-8/H-1.
export { REQUEST_TYPE_LABELS, REQUEST_TYPE_VARIANTS } from "@/lib/request-types"

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
  /** Proyección de la misma etapa para asignarla sin perder contexto. */
  operationalItem?:      OperationalWorkItem
}

export interface ApprovalRequest {
  id:              string
  code:            string
  requestType:     string
  worksiteId:      string
  worksiteName:    string
  requesterName:   string
  requestUrgency:  string
  submittedAt:     string | null
  deliveryMode:    "via_oficina" | "directo_faena"
  pendingItems:    ApprovalItem[]
  pendingCount:    number
}
