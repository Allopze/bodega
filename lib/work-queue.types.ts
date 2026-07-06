/**
 * Types for the work-queue module.
 * Tasks, actors, rows, and progress types.
 */

export type WorkTaskType =
  | "request_followup"
  | "approval"
  | "purchase"
  | "purchase_order"
  | "receipt"
  | "warehouse_delivery"

export type WorkPriority = "critical" | "high" | "normal" | "low"

export interface WorkTask {
  id:          string
  type:        WorkTaskType
  title:       string
  subtitle:    string
  statusLabel: string
  priority:    WorkPriority
  createdAt:   string
  href:        string
  ctaLabel:    string
}

export interface WorkActor {
  userId:      string
  permissions: string[]
  worksiteIds: string[]
  isGlobal:    boolean
}

export interface WorkRequestRow {
  id:            string
  code:          string
  worksiteId:    string
  worksiteName:  string
  requesterId:   string
  status:        string
  urgency:       string | null
  createdAt:     string
  submittedAt:   string | null
  itemCount:     number
  itemStatuses:  string[]
}

export interface WorkItemRow {
  id:            string
  requestId:     string
  requestCode:   string
  worksiteId:    string
  worksiteName:  string
  requesterId:   string
  productName:   string
  status:        string
  urgency:       string | null
  createdAt:     string
  quantity:      number
  unitOfMeasure: string
  hasStock?:     boolean
}

export interface WorkOrderRow {
  id:              string
  code:            string
  worksiteId:      string
  worksiteName:    string
  supplierName:    string
  status:          string
  createdAt:       string
  issuedAt:        string | null
  sentAt:          string | null
  itemCount:       number
  totalAmount:     number
  deliveryMode?:   string
}

export interface WorkQueueSnapshot {
  requests: WorkRequestRow[]
  items:    WorkItemRow[]
  orders:   WorkOrderRow[]
}

export interface RequestProgressItem {
  id:            string
  productName:   string
  status:        string
  quantity:      number
  unitOfMeasure: string
}

export interface RequestProgress {
  currentStage: string
  completedStages: string[]
  nextAction: string
  items: {
    id:            string
    productName:   string
    quantityLabel: string
    statusLabel:   string
    stageLabel:    string
  }[]
}
