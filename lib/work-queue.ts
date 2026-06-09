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

const STAGES = ["Solicitado", "Aprobación", "Compra", "Recepción", "Entrega"]
const CLOSED_REQUEST_STATUSES = new Set(["closed", "cancelled", "rejected"])
const ACTIVE_REQUEST_STATUSES = new Set([
  "draft", "submitted", "in_review", "partially_approved",
  "approved", "returned", "in_purchasing",
])
const APPROVAL_ITEM_STATUSES = new Set(["requested"])
const PURCHASE_ITEM_STATUSES = new Set(["approved", "pending_purchase"])
const DELIVERY_ITEM_STATUSES = new Set(["received", "partially_delivered"])
const RECEIVABLE_ORDER_STATUSES = new Set(["sent", "partially_received"])


const PRIORITY_RANK: Record<WorkPriority, number> = {
  critical: 0,
  high:     1,
  normal:   2,
  low:      3,
}

export function buildWorkTasks(actor: WorkActor, snapshot: WorkQueueSnapshot): WorkTask[] {
  const tasks: WorkTask[] = []

  if (hasAnyPermission(actor, "requests:view_own", "requests:view_all")) {
    for (const request of snapshot.requests) {
      if (!canSeeWorksite(actor, request.worksiteId)) continue
      if (request.requesterId !== actor.userId && !hasPermission(actor, "requests:view_all")) continue
      if (!ACTIVE_REQUEST_STATUSES.has(request.status)) continue

      tasks.push({
        id:          `request:${request.id}`,
        type:        "request_followup",
        title:       request.code,
        subtitle:    `${request.worksiteName} · ${formatCount(request.itemCount, "ítem", "ítems")}`,
        statusLabel: requestStatusLabel(request.status),
        priority:    normalizePriority(request.urgency),
        createdAt:   request.submittedAt ?? request.createdAt,
        href:        `/solicitudes/${request.id}`,
        ctaLabel:    request.status === "draft" || request.status === "returned" ? "Completar" : "Ver avance",
      })
    }
  }

  if (hasPermission(actor, "approvals:approve")) {
    for (const group of groupItemsByRequest(snapshot.items.filter((item) => APPROVAL_ITEM_STATUSES.has(item.status) && canSeeWorksite(actor, item.worksiteId)))) {
      tasks.push({
        id:          `approval:${group.requestId}`,
        type:        "approval",
        title:       `Revisar ${group.requestCode}`,
        subtitle:    `${group.worksiteName} · ${formatCount(group.items.length, "ítem pendiente", "ítems pendientes")}`,
        statusLabel: "Necesita aprobación",
        priority:    highestPriority(group.items.map((item) => normalizePriority(item.urgency))),
        createdAt:   oldestDate(group.items.map((item) => item.createdAt)),
        href:        `/aprobaciones?solicitud=${group.requestId}`,
        ctaLabel:    "Revisar ítems",
      })
    }
  }

  if (hasPermission(actor, "purchasing:create_order")) {
    for (const group of groupItemsByWorksite(snapshot.items.filter((item) => PURCHASE_ITEM_STATUSES.has(item.status) && canSeeWorksite(actor, item.worksiteId)))) {
      tasks.push({
        id:          `purchase:${group.worksiteId}`,
        type:        "purchase",
        title:       "Generar orden de compra",
        subtitle:    `${group.worksiteName} · ${formatCount(group.items.length, "ítem aprobado", "ítems aprobados")}`,
        statusLabel: "Listo para comprar",
        priority:    highestPriority(group.items.map((item) => normalizePriority(item.urgency))),
        createdAt:   oldestDate(group.items.map((item) => item.createdAt)),
        href:        `/compras/nueva?faena=${group.worksiteId}`,
        ctaLabel:    "Crear OC",
      })
    }

    for (const order of snapshot.orders.filter((order) => order.status === "draft" && canSeeWorksite(actor, order.worksiteId))) {
      tasks.push(orderTask(order, "OC en borrador", "Emitir OC"))
    }
  }

  if (hasPermission(actor, "purchasing:send_order")) {
    for (const order of snapshot.orders.filter((order) => order.status === "issued" && canSeeWorksite(actor, order.worksiteId))) {
      tasks.push(orderTask(order, "OC emitida", "Enviar al proveedor"))
    }
  }

  if (hasPermission(actor, "receiving:register")) {
    for (const order of snapshot.orders.filter((order) => RECEIVABLE_ORDER_STATUSES.has(order.status) && canSeeWorksite(actor, order.worksiteId))) {
      tasks.push({
        id:          `receipt:${order.id}`,
        type:        "receipt",
        title:       `Recibir ${order.code}`,
        subtitle:    `${order.worksiteName} · ${order.supplierName} · ${formatCount(order.itemCount, "ítem", "ítems")}`,
        statusLabel: order.status === "partially_received" ? "Recepción parcial" : "Esperando recepción",
        priority:    "normal",
        createdAt:   order.sentAt ?? order.createdAt,
        href:        `/recepcion/nueva?oc=${order.id}`,
        ctaLabel:    "Registrar recepción",
      })
    }
  }

  if (hasPermission(actor, "warehouse:register_movement")) {
    for (const item of snapshot.items.filter((item) => DELIVERY_ITEM_STATUSES.has(item.status) && item.hasStock && canSeeWorksite(actor, item.worksiteId))) {
      tasks.push({
        id:          `delivery:${item.id}`,
        type:        "warehouse_delivery",
        title:       `Entregar ${item.productName}`,
        subtitle:    `${item.requestCode} · ${item.worksiteName} · ${formatQuantity(item.quantity, item.unitOfMeasure)}`,
        statusLabel: item.status === "partially_delivered" ? "Entrega parcial" : "Recibido en bodega",
        priority:    normalizePriority(item.urgency),
        createdAt:   item.createdAt,
        href:        `/bodega?faena=${item.worksiteId}&item=${item.id}`,
        ctaLabel:    "Registrar entrega",
      })
    }
  }

  return tasks.sort(compareTasks)
}

export function buildRequestProgress(requestStatus: string, items: RequestProgressItem[]): RequestProgress {
  const itemSummaries = items.map((item) => ({
    id:            item.id,
    productName:   item.productName,
    quantityLabel: formatQuantity(item.quantity, item.unitOfMeasure),
    statusLabel:   itemStatusLabel(item.status),
    stageLabel:    itemStageLabel(item.status),
  }))

  const statuses = items.map((item) => item.status)
  const currentStage = requestCurrentStage(requestStatus, statuses)
  const currentIndex = Math.max(0, STAGES.indexOf(currentStage))

  return {
    currentStage,
    completedStages: STAGES.slice(0, currentIndex),
    nextAction: requestNextAction(requestStatus, statuses),
    items: itemSummaries,
  }
}

export function requestStatusLabel(status: string): string {
  const labels: Record<string, string> = {
    draft:              "Borrador",
    submitted:          "Esperando revisión",
    in_review:          "En aprobación",
    partially_approved: "Aprobación parcial",
    approved:           "Aprobada para compra",
    rejected:           "Rechazada",
    returned:           "Requiere corrección",
    in_purchasing:      "En compra",
    closed:             "Cerrada",
    cancelled:          "Cancelada",
  }
  return labels[status] ?? status
}

export function itemStatusLabel(status: string): string {
  const labels: Record<string, string> = {
    draft:               "Borrador",
    requested:           "Esperando aprobación",
    approved:            "Aprobado para compra",
    rejected:            "Rechazado",
    returned:            "Devuelto para corregir",
    postponed:           "Postergado",
    pending_purchase:    "Aprobado para compra",
    in_purchase_order:   "Incluido en OC",
    purchased:           "Comprado",
    partially_received:  "Recepción parcial",
    received:            "Recibido",
    partially_delivered: "Entrega parcial",
    delivered:           "Entregado",
  }
  return labels[status] ?? status
}

export function itemStageLabel(status: string): string {
  if (["draft"].includes(status)) return "Solicitado"
  if (["requested", "returned", "rejected"].includes(status)) return "Aprobación"
  if (["approved", "pending_purchase", "postponed", "in_purchase_order", "purchased"].includes(status)) return "Compra"
  if (["partially_received", "received"].includes(status)) return "Recepción"
  if (["partially_delivered", "delivered"].includes(status)) return "Entrega"
  return "Solicitado"
}

export function requestNextAction(requestStatus: string, statuses: string[]): string {
  if (requestStatus === "cancelled") return "Solicitud cancelada."
  if (statuses.length === 0) return "Agrega ítems para enviar la solicitud."
  if (statuses.every((status) => status === "delivered")) return "Pedido entregado en faena."
  if (statuses.every((status) => status === "rejected")) return "Solicitud cerrada sin ítems aprobados."
  if (statuses.some((status) => status === "returned")) return "Corrige los ítems devueltos y vuelve a enviar."
  if (statuses.some((status) => status === "draft")) return "Envía la solicitud a aprobación."
  if (statuses.some((status) => status === "requested")) return "Aprobación debe revisar los ítems pendientes."
  if (statuses.some((status) => ["approved", "pending_purchase", "postponed"].includes(status))) return "Compras debe generar la orden de compra."
  if (statuses.some((status) => status === "in_purchase_order")) return "Compras debe emitir y enviar la OC al proveedor."
  if (statuses.some((status) => ["purchased", "partially_received"].includes(status))) return "Esperando recepción del proveedor."
  if (statuses.some((status) => ["received", "partially_delivered"].includes(status))) return "Bodega debe registrar la entrega a faena."
  if (CLOSED_REQUEST_STATUSES.has(requestStatus)) return "La solicitud ya no requiere acciones."
  return "Revisa el detalle para ver el siguiente paso."
}

function requestCurrentStage(requestStatus: string, statuses: string[]): string {
  if (requestStatus === "draft") return "Solicitado"
  if (statuses.some((status) => ["requested", "returned", "rejected"].includes(status))) return "Aprobación"
  if (statuses.some((status) => ["approved", "pending_purchase", "postponed", "in_purchase_order", "purchased"].includes(status))) return "Compra"
  if (statuses.some((status) => ["partially_received", "received"].includes(status))) return "Recepción"
  if (statuses.some((status) => ["partially_delivered", "delivered"].includes(status))) return "Entrega"
  return requestStatus === "closed" ? "Entrega" : "Solicitado"
}

function orderTask(order: WorkOrderRow, statusLabel: string, ctaLabel: string): WorkTask {
  return {
    id:          `order:${order.id}:${order.status}`,
    type:        "purchase_order",
    title:       `${order.code}`,
    subtitle:    `${order.worksiteName} · ${order.supplierName} · ${formatCount(order.itemCount, "ítem", "ítems")}`,
    statusLabel,
    priority:    "normal",
    createdAt:   order.issuedAt ?? order.createdAt,
    href:        `/compras/${order.id}`,
    ctaLabel,
  }
}

function compareTasks(a: WorkTask, b: WorkTask): number {
  const priority = PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority]
  if (priority !== 0) return priority
  return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
}

function hasPermission(actor: WorkActor, permission: string): boolean {
  return actor.permissions.includes(permission)
}

function hasAnyPermission(actor: WorkActor, ...permissions: string[]): boolean {
  return permissions.some((permission) => hasPermission(actor, permission))
}

function canSeeWorksite(actor: WorkActor, worksiteId: string): boolean {
  return actor.isGlobal || actor.worksiteIds.includes(worksiteId)
}

function normalizePriority(urgency: string | null | undefined): WorkPriority {
  if (urgency === "critical") return "critical"
  if (urgency === "high") return "high"
  return "normal"
}

function highestPriority(priorities: WorkPriority[]): WorkPriority {
  return priorities.sort((a, b) => PRIORITY_RANK[a] - PRIORITY_RANK[b])[0] ?? "normal"
}

function oldestDate(dates: string[]): string {
  return dates.sort((a, b) => new Date(a).getTime() - new Date(b).getTime())[0] ?? new Date().toISOString()
}

function groupItemsByRequest(items: WorkItemRow[]) {
  const groups = new Map<string, {
    requestId: string
    requestCode: string
    worksiteName: string
    items: WorkItemRow[]
  }>()

  for (const item of items) {
    const group = groups.get(item.requestId) ?? {
      requestId: item.requestId,
      requestCode: item.requestCode,
      worksiteName: item.worksiteName,
      items: [],
    }
    group.items.push(item)
    groups.set(item.requestId, group)
  }

  return [...groups.values()]
}

function groupItemsByWorksite(items: WorkItemRow[]) {
  const groups = new Map<string, {
    worksiteId: string
    worksiteName: string
    items: WorkItemRow[]
  }>()

  for (const item of items) {
    const group = groups.get(item.worksiteId) ?? {
      worksiteId: item.worksiteId,
      worksiteName: item.worksiteName,
      items: [],
    }
    group.items.push(item)
    groups.set(item.worksiteId, group)
  }

  return [...groups.values()]
}

function formatCount(count: number, singular: string, plural: string): string {
  return `${count} ${count === 1 ? singular : plural}`
}

function formatQuantity(quantity: number, unit: string): string {
  return `${quantity.toLocaleString("es-CL")} ${unit}`
}
