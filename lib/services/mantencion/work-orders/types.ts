import type { MantUnit } from "@/lib/mantencion/types"
import type {
  OtEventType,
  OtItemDone,
  OtItemKind,
  OtItemOrigin,
  OtStatus,
  OtTransition,
  OtWorkshopKind,
} from "@/lib/mantencion/work-order-states"

/**
 * Contrato compartido de los servicios de OT (fase 0, 2026-11-02). Lo
 * implementa `lib/services/mantencion/work-orders/*` (L1) y lo consumen la
 * jefatura (L3), las inspecciones (L5) y las métricas (L4). No cambiar sin
 * coordinar.
 */

/** Quién actúa: el mismo `MantViewer` del módulo más su nombre para los snapshots. */
export interface WorkOrderActor {
  userId: string
  name: string
  permissions: readonly string[]
  worksiteIds: readonly string[]
  isGlobal: boolean
  /** Sólo operaciones del teléfono. */
  deviceId?: string | null
}

/** Resultado uniforme de las acciones (patrón `MantActionResult`). */
export type WorkOrderResult<T = { id: string; version: number; status: OtStatus }> =
  | { ok: true; value: T }
  | { ok: false; message: string; field?: string; code?: "not_found" | "forbidden" | "conflict" | "invalid" }

export interface WorkOrderListRow {
  id: string
  folio: string
  status: OtStatus
  vehicleId: string
  equipmentCode: string
  equipmentPlate: string
  equipmentType: string
  worksiteId: string
  worksiteName: string
  repair: boolean
  maintenance: boolean
  requestDate: string
  requesterName: string
  assignedToUserId: string | null
  assignedToName: string | null
  workshopEntryAt: string | null
  estimatedDeliveryDate: string | null
  workshopExitAt: string | null
  /** Entrega estimada ya pasada y la OT sigue en taller. */
  estimateOverdue: boolean
  /** Días desde el ingreso hasta la salida (o hasta hoy). */
  daysInWorkshop: number | null
  rejectionCount: number
  /**
   * OT abierta con alguna línea de repuesto pedida que todavía no llegó a faena.
   * Una OT cerrada o anulada nunca espera repuesto (el equipo ya salió). La misma
   * regla en la lista, el panel y el tile de Control operacional: ver
   * `partsPendingExistsSql` en `parts-requests.ts`.
   */
  waitingParts: boolean
  createdAt: string
}

export interface WorkOrderItemDetail {
  id: string
  kind: OtItemKind
  origin: OtItemOrigin
  description: string
  sortOrder: number
  done: OtItemDone | null
  note: string | null
  markedByName: string | null
  markedAt: string | null
}

export interface WorkOrderEventDetail {
  id: string
  type: OtEventType
  fromStatus: OtStatus | null
  toStatus: OtStatus | null
  reason: string | null
  changeSet: Record<string, unknown> | null
  actorName: string
  createdAt: string
}

/**
 * Una línea de repuesto pedida para la OT: el ítem de la solicitud con su OC
 * activa (si ya existe) y lo recibido en faena. La OT no lleva repuestos en su
 * documento: esto sólo la informa de lo que otras solicitudes y compras guardaron.
 */
export interface WorkOrderPartsRequest {
  requestId: string
  requestCode: string
  requestStatus: string
  itemId: string
  description: string
  /**
   * Producto de catálogo de la línea (el del ítem de solicitud o, si Compras lo
   * catalogó al armar la OC, el de la línea de OC); `null` = texto libre. La
   * ficha del repuesto sólo existe cuando `isSparePart`.
   */
  productId: string | null
  sku: string | null
  /** N° de parte del fabricante (repuestos de catálogo). */
  partNumber: string | null
  isSparePart: boolean
  quantity: number
  unitOfMeasure: string
  /** Estado crudo del ítem; la pantalla muestra `itemStatusLabel`. */
  itemStatus: string
  itemStatusLabel: string
  orderId: string | null
  orderCode: string | null
  orderStatus: string | null
  /** Entrega estimada de la OC (YYYY-MM-DD); null sin OC activa o sin fecha. */
  estimatedDelivery: string | null
  /** Recibido en faena de esa línea; 0 sin OC activa. */
  quantityReceived: number
  requestedAt: string
}

/** Un repuesto que el mecánico declaró usar en un registro enlazado a la OT (`mant_record_parts`). */
export interface WorkOrderPartUsed {
  recordId: string
  recordFolio: string | null
  quantity: number
  description: string
}

export interface WorkOrderDetail extends WorkOrderListRow {
  version: number
  unit: MantUnit
  repairDescription: string | null
  observations: string | null
  /** Costo total de la OT en CLP; null si jefatura no lo cargó. */
  totalCost: number | null
  requestedByUserId: string
  requestedByName: string
  assignedByName: string | null
  assignedAt: string | null
  entry: {
    workshopKind: OtWorkshopKind
    workshopId: string | null
    workshopName: string | null
    workshopManagerName: string | null
    operatorDriverId: string | null
    operatorName: string | null
    entryAt: string
    odometer: number | null
    hourmeter: number | null
    estimatedDeliveryDate: string
    startedByName: string | null
  } | null
  exit: { exitAt: string; finishedByName: string | null } | null
  reception: { receivedAt: string; receiverName: string; recordedByName: string | null; recordedAt: string } | null
  faenaReception: { receivedAt: string; receiverName: string; recordedByName: string | null; closedAt: string } | null
  voided: { at: string; byName: string | null; reason: string } | null
  items: WorkOrderItemDetail[]
  events: WorkOrderEventDetail[]
  linkedRecords: Array<{ id: string; folio: string | null; kind: "P" | "C"; workDate: string; signedAt: string; status: "vigente" | "anulado"; canOpen: boolean }>
  inspectionFinding: { id: string; runId: string; capaActionId: string | null } | null
  /** Repuestos pedidos para esta OT (solicitudes de compra vinculadas), la más reciente primero. */
  partsRequests: WorkOrderPartsRequest[]
  /** Lo que los registros vigentes enlazados declararon usar, vía `loadWorkOrderLinkedWork`. */
  partsUsed: WorkOrderPartUsed[]
  /** Transiciones que el usuario que mira puede ejecutar ahora (la UI sólo las refleja). */
  allowedTransitions: OtTransition[]
  canEditRequest: boolean
  canEditExecution: boolean
  /** Quien mira puede registrar desde la ficha la correctiva o preventiva enlazada (`canRegisterWorkOrderRecord`). */
  canRegisterRecord: boolean
  /**
   * En taller y todavía sin el trabajo que exige «terminar»: ningún registro
   * vigente enlazado desde la última devolución. La ficha lo usa para poner
   * «Registrar trabajo» como la acción de la etapa.
   */
  needsLinkedRecord: boolean
}

/**
 * Alta desde otro módulo (hallazgo de inspección) dentro de SU transacción. No
 * valida permisos de OT: el llamador ya validó los suyos. Devuelve el id y el
 * folio; las notificaciones las dispara el llamador después del commit con
 * `notifyWorkOrderCreated`.
 */
export interface SystemWorkOrderInput {
  vehicleId: string
  inspectionFindingId: string | null
  repair: boolean
  maintenance: boolean
  repairDescription: string | null
  observations: string | null
  requesterName: string
  annexItems?: string[]
  maintenanceItems?: string[]
}
