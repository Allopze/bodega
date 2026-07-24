/**
 * Builder functions for the work-queue module — task construction and progress.
 */
import {
  type WorkActor,
  type WorkItemRow,
  type WorkOrderRow,
  type WorkPriority,
  type WorkQueueSnapshot,
  type RequestProgressItem,
  type RequestProgress,
  type WorkTask,
} from "./work-queue.types"
import {
  STAGES, ACTIVE_REQUEST_STATUSES,
  APPROVAL_ITEM_STATUSES, PURCHASE_ITEM_STATUSES,
  DELIVERY_ITEM_STATUSES, OFFICE_RECEIVABLE_STATUSES,
  FAENA_RECEIVABLE_STATUSES, DIRECT_FAENA_RECEIVABLE_STATUSES,
  PRIORITY_RANK,
  requestStatusLabel, itemStatusLabel, itemStageLabel, requestNextAction, requestCurrentStage,
} from "./work-queue-labels"

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

  if (hasPermission(actor, "receiving:register_office")) {
    for (const order of snapshot.orders.filter((order) => OFFICE_RECEIVABLE_STATUSES.has(order.status) && order.deliveryMode !== "directo_faena" && canSeeWorksite(actor, order.worksiteId))) {
      tasks.push({
        id:          `receipt-office:${order.id}`,
        type:        "receipt",
        title:       `Llegada a oficina ${order.code}`,
        subtitle:    `${order.worksiteName} · ${order.supplierName} · ${formatCount(order.itemCount, "ítem", "ítems")}`,
        statusLabel: order.status === "partially_office_received" ? "Oficina parcial" : "Esperando llegada",
        priority:    "normal",
        createdAt:   order.sentAt ?? order.createdAt,
        href:        `/recepcion/nueva?oc=${order.id}`,
        ctaLabel:    "Registrar llegada",
      })
    }
  }

  if (hasPermission(actor, "receiving:register_faena")) {
    for (const order of snapshot.orders.filter((order) => {
      const receivable = order.deliveryMode === "directo_faena"
        ? DIRECT_FAENA_RECEIVABLE_STATUSES.has(order.status)
        : FAENA_RECEIVABLE_STATUSES.has(order.status)
      return receivable && canSeeWorksite(actor, order.worksiteId)
    })) {
      tasks.push({
        id:          `receipt-faena:${order.id}`,
        type:        "receipt",
        title:       `Recibir en faena ${order.code}`,
        subtitle:    `${order.worksiteName} · ${order.supplierName} · ${formatCount(order.itemCount, "ítem", "ítems")}`,
        statusLabel: order.status === "partially_received" ? "Recepción parcial" : "Pendiente de faena",
        priority:    "normal",
        createdAt:   order.sentAt ?? order.createdAt,
        href:        `/recepcion/nueva?oc=${order.id}`,
        ctaLabel:    "Recibir en faena",
      })
    }
  }

  // La tarea enruta a /entregas (entrega de EPP a trabajador), que exige
  // deliveries:create para enviarse. Gatear por warehouse:register_movement
  // producía tareas que el usuario no podía completar (p. ej. solicitante_faena).
  if (hasPermission(actor, "deliveries:create")) {
    for (const item of snapshot.items.filter((item) => DELIVERY_ITEM_STATUSES.has(item.status) && item.hasStock && canSeeWorksite(actor, item.worksiteId))) {
      tasks.push({
        id:          `delivery:${item.id}`,
        type:        "warehouse_delivery",
        title:       `Entregar ${item.productName}`,
        subtitle:    `${item.requestCode} · ${item.worksiteName} · ${formatQuantity(item.quantity, item.unitOfMeasure)}`,
        statusLabel: item.status === "partially_delivered" ? "Entrega parcial" : "Recibido en bodega",
        priority:    normalizePriority(item.urgency),
        createdAt:   item.createdAt,
        href:        `/entregas?faena=${item.worksiteId}&item=${item.id}`,
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

export interface OcProgressItem {
  id:               string
  productName:      string
  quantity:         number
  unitOfMeasure:    string
  quantityReceived: number
}

/**
 * Progreso de ciclo de una OC, alimentado al mismo RequestProgressPanel que las
 * solicitudes. La OC arranca post-aprobación: Solicitado y Aprobación siempre
 * completas. La etapa Entrega (al trabajador) es de otro módulo, así que la OC
 * tope en Recepción. Devuelve null en OC anulada (sin stepper).
 */
export function buildOcProgress(orderStatus: string, items: OcProgressItem[]): RequestProgress | null {
  if (orderStatus === "cancelled") return null

  const currentStage = ocCurrentStage(orderStatus)
  const currentIndex = Math.max(0, STAGES.indexOf(currentStage))

  return {
    currentStage,
    completedStages: STAGES.slice(0, currentIndex),
    nextAction: ocNextAction(orderStatus),
    items: items.map((item) => ({
      id:            item.id,
      productName:   item.productName,
      quantityLabel: formatQuantity(item.quantity, item.unitOfMeasure),
      statusLabel:   ocItemStatusLabel(item),
      stageLabel:    currentStage,
    })),
  }
}

function ocCurrentStage(orderStatus: string): string {
  if (["partially_office_received", "office_received", "partially_received"].includes(orderStatus)) return "Recepción"
  if (["received", "closed"].includes(orderStatus)) return "Recepción"
  // draft / issued / sent / supplier_confirmed
  return "Compra"
}

function ocNextAction(orderStatus: string): string {
  switch (orderStatus) {
    case "draft":              return "Emite la orden para poder enviarla al proveedor."
    case "issued":             return "Marca la orden como enviada al proveedor."
    case "sent":               return "Confirma la recepción del proveedor o registra la llegada a oficina."
    case "supplier_confirmed": return "Registra la recepción cuando lleguen los ítems."
    case "partially_office_received":
    case "office_received":    return "Despacha los ítems a faena para completar la recepción."
    case "partially_received": return "Registra la recepción del saldo pendiente en faena."
    case "received":           return "Orden recibida completamente."
    case "closed":             return "Orden cerrada."
    default:                   return "Revisa el detalle para ver el siguiente paso."
  }
}

function ocItemStatusLabel(item: OcProgressItem): string {
  if (item.quantityReceived <= 0) return "Pendiente recepción"
  if (item.quantityReceived >= item.quantity) return "Recibido"
  return "Recepción parcial"
}

// ── Private helpers ──────────────────────────────────────────────────────────

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
