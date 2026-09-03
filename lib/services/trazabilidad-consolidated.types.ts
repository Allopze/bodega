export const TRACEABILITY_CONSOLIDATED_PAGE_SIZE = 25

export type ComputedStatus =
  | "entregado"
  | "parcialmente_entregado"
  | "en_faena"
  | "parcialmente_recibido_faena"
  | "enviado_faena"
  | "parcialmente_enviado_faena"
  | "en_oficina"
  | "parcialmente_recibido_oficina"
  | "pedido_proveedor"
  | "aprobado"
  | "solicitado"
  | "rechazado"
  | "cancelado"
  | "borrador"

export interface StatusMeta {
  label: string
  color: "success" | "warning" | "info" | "neutral" | "danger" | "signal"
}

export const COMPUTED_STATUS_METAS: Record<ComputedStatus, StatusMeta> = {
  entregado: { label: "Entregado", color: "success" },
  parcialmente_entregado: { label: "Parcialmente entregado", color: "warning" },
  en_faena: { label: "En faena", color: "info" },
  parcialmente_recibido_faena: { label: "Parcial en faena", color: "info" },
  enviado_faena: { label: "Enviado a faena", color: "info" },
  parcialmente_enviado_faena: { label: "Parcial enviado", color: "info" },
  en_oficina: { label: "En oficina", color: "signal" },
  parcialmente_recibido_oficina: { label: "Parcial en oficina", color: "signal" },
  pedido_proveedor: { label: "Pedido a proveedor", color: "info" },
  aprobado: { label: "Aprobado (por comprar)", color: "signal" },
  solicitado: { label: "Solicitado", color: "neutral" },
  rechazado: { label: "Rechazado", color: "danger" },
  cancelado: { label: "Cancelado", color: "neutral" },
  borrador: { label: "Borrador", color: "neutral" },
}

export interface ComputeStatusParams {
  itemStatus: string
  requestStatus?: string
  requested: number
  approved: number | null
  inOc: number
  receivedOffice: number
  dispatched: number
  receivedFaena: number
  delivered: number
}

export interface PendingBreakdown {
  pendingTotal: number
  notYetOrdered: number
  pendingFromSupplier: number
  inOffice: number
  inTransit: number
  inFaenaAvailable: number
}

export interface TimelineEvent {
  id: string
  date: string
  type:
    | "request"
    | "approval"
    | "purchase_order"
    | "receipt_office"
    | "dispatch_guide"
    | "receipt_faena"
    | "delivery"
  title: string
  description: string
  quantity?: number
  actor?: string
  badgeLabel?: string
  href?: string
}

export interface ConsolidatedRow {
  itemId: string
  requestId: string
  requestCode: string
  requestDate: string
  requesterId: string
  requesterName: string
  deliveryMode: string
  urgency: string | null

  productId: string | null
  productName: string
  productSku: string | null
  categoryName: string
  notes: string | null
  uom: string

  worksiteId: string
  worksiteName: string

  requested: number
  approved: number | null
  inOc: number
  receivedOffice: number
  receivedFaena: number
  dispatched: number
  stockInFaena: number | null
  delivered: number

  pendingTotal: number
  pendingBreakdown: PendingBreakdown

  computedStatus: ComputedStatus
  computedStatusLabel: string
  computedStatusColor: StatusMeta["color"]

  supplierNames: string[]
  ocCodes: Array<{ id: string; code: string; supplierName: string; quantity: number }>

  lastUpdated: string
  alert: boolean
  timeline: TimelineEvent[]
}

export interface ConsolidatedFaenaKPIs {
  openRequests: number
  pendingPurchase: number
  awaitingSupplier: number
  inOffice: number
  pendingDispatch: number
  inFaena: number
  partiallyDelivered: number
  fullyDelivered: number
}

export interface ConsolidatedTraceabilityResult {
  rows: ConsolidatedRow[]
  totalFiltered: number
  totalPages: number
  safePage: number
  activeWorksite: { id: string; name: string } | null
  visibleWorksites: Array<{ id: string; name: string }>
  categories: Array<{ id: string; name: string }>
  requesters: Array<{ id: string; name: string }>
  suppliers: Array<{ id: string; name: string }>
  kpis: ConsolidatedFaenaKPIs
  filters: {
    faena: string
    estado: string
    categoria: string
    solicitante: string
    proveedor: string
    q: string
    desde: string
    hasta: string
    pendientes: boolean
  }
}
