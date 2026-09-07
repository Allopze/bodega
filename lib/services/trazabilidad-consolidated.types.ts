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

export type TraceabilityStatusGroup = "en_curso" | "cerradas" | "todos"
export type TraceabilityStatusFilter = ComputedStatus | TraceabilityStatusGroup

export const TRACEABILITY_DEFAULT_STATUS_FILTER: TraceabilityStatusGroup = "en_curso"
export const TRACEABILITY_STATUS_GROUP_LABELS: Record<TraceabilityStatusGroup, string> = {
  en_curso: "En curso",
  cerradas: "Cerradas",
  todos: "Todos los estados",
}

export interface StatusMeta {
  label: string
  color: "success" | "warning" | "info" | "neutral" | "danger" | "signal"
}

/**
 * El `?estado=` de la URL lo escribe cualquiera. Sin esta guarda un valor
 * inventado no coincidía con ningún `computedStatus` y la tabla salía vacía
 * como si la faena no tuviera nada, en vez de ignorar el filtro.
 */
export function isComputedStatus(value: string): value is ComputedStatus {
  return Object.hasOwn(COMPUTED_STATUS_METAS, value)
}

export function isTraceabilityStatusGroup(value: string): value is TraceabilityStatusGroup {
  return value === "en_curso" || value === "cerradas" || value === "todos"
}

export function isTraceabilityStatusFilter(value: string): value is TraceabilityStatusFilter {
  return isComputedStatus(value) || isTraceabilityStatusGroup(value)
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

const TRACEABILITY_TERMINAL_STATUSES: ReadonlySet<ComputedStatus> = new Set([
  "entregado",
  "rechazado",
  "cancelado",
])

/** Decide qué estados muestra cada vista agrupada de trazabilidad. */
export function matchesTraceabilityStatusFilter(
  status: ComputedStatus,
  filter: string,
): boolean {
  if (!filter || filter === "todos") return true
  if (filter === "en_curso") return !TRACEABILITY_TERMINAL_STATUSES.has(status)
  if (filter === "cerradas") return TRACEABILITY_TERMINAL_STATUSES.has(status)
  if (isComputedStatus(filter)) return status === filter
  return true
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
  /**
   * El movimiento existe como documento pero fue anulado y no cuenta en
   * ninguna cantidad. Se muestra tachado: borrarlo del historial escondería
   * justo lo que una auditoría viene a revisar.
   */
  voided?: boolean
}

export interface ConsolidatedRow {
  itemId: string
  requestId: string
  requestCode: string
  requestDate: string
  requesterId: string
  requesterName: string
  deliveryMode: string
  /** Override de urgencia propio de la línea, si existe. */
  urgency: string | null
  /** Urgencia heredada de la solicitud, independiente de los overrides. */
  requestUrgency: string | null

  productId: string | null
  productName: string
  productSku: string | null
  categoryId: string | null
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

export interface ConsolidatedQuantitySummary {
  uom: string
  requested: number
  approved: number | null
  inOc: number
  receivedOffice: number
  receivedFaena: number
  delivered: number
  pendingTotal: number
}

export interface ConsolidatedOrderQuantitySummary {
  uom: string
  inOc: number
  receivedOffice: number
  receivedFaena: number
}

export interface ConsolidatedOrder {
  orderId: string
  code: string
  supplierName: string
  orderStatus: string
  requestIds: string[]
  lineIds: string[]
  lineCount: number
  quantitiesByUom: ConsolidatedOrderQuantitySummary[]
  lastUpdated: string
}

export interface ConsolidatedRequest {
  requestId: string
  requestCode: string
  requestDate: string
  requesterId: string
  requesterName: string
  worksiteId: string
  worksiteName: string
  deliveryMode: string
  urgency: string | null
  lineCount: number
  /** Líneas que explican la coincidencia con los filtros agregados actuales. */
  matchingLineCount?: number
  orderCount: number
  orders: ConsolidatedOrder[]
  lines: ConsolidatedRow[]
  quantitiesByUom: ConsolidatedQuantitySummary[]
  status: ComputedStatus
  statusLabel: string
  statusColor: StatusMeta["color"]
  statusCounts: Partial<Record<ComputedStatus, number>>
  /** Sólo es numérico cuando toda la solicitud usa una única UOM. */
  pendingTotal: number | null
  /** Indicador seguro para filtros cuando `pendingTotal` no se puede sumar. */
  hasPending: boolean
  alert: boolean
  lastUpdated: string
}

export interface ConsolidatedAggregateResult {
  requests: ConsolidatedRequest[]
  orders: ConsolidatedOrder[]
}

export interface ConsolidatedFaenaKPIs {
  openRequests: number
  pendingPurchase: number
  awaitingSupplier: number
  inOffice: number
  inFaena: number
  partiallyDelivered: number
  fullyDelivered: number
}

export interface ConsolidatedTraceabilityResult {
  /** Solicitudes de la página actual, con sus líneas y OCs (evidencia). */
  requests: ConsolidatedRequest[]
  /** Compatibilidad interna: se elimina al conectar la página en Task 5. */
  rows: ConsolidatedRow[]
  totalFiltered: number
  totalPages: number
  safePage: number
  /**
   * `true` cuando el techo de líneas limita las solicitudes recientes que el
   * pipeline pudo cargar. Los totales y KPIs cubren sólo ese alcance cargado.
   */
  truncated: boolean
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
    ocPendiente: boolean
  }
}
