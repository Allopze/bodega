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

export interface WorkOrderDetail extends WorkOrderListRow {
  version: number
  unit: MantUnit
  repairDescription: string | null
  observations: string | null
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
  /** Transiciones que el usuario que mira puede ejecutar ahora (la UI sólo las refleja). */
  allowedTransitions: OtTransition[]
  canEditRequest: boolean
  canEditExecution: boolean
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
