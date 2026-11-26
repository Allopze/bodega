/**
 * Tipos compartidos de repuestos con stock y notas de pedido (ADR mantención
 * 0001, 2026-11-26). Las firmas de servicio de abajo son el contrato entre las
 * líneas de trabajo: cada una la implementa su dueño (ver el plan de ejecución)
 * y las demás programan contra ella. Cambiar una firma exige avisar a quien la usa.
 */

import type { CatalogPartsAvailable, CatalogPartsNote, PartsNoteLineStage, PartsNoteStatus } from "@/lib/mantencion/contracts"

export type { CatalogPartsAvailable, CatalogPartsNote, PartsNoteLineStage, PartsNoteStatus }

/** Error de datos de entrada (la API responde 422 con `field`). No es falta de stock. */
export class PartsValidationError extends Error {
  readonly field: string | undefined
  constructor(message: string, field?: string) {
    super(message)
    this.name = "PartsValidationError"
    this.field = field
  }
}

export type AllocationSource = "recepcion" | "stock_existente" | "traslado"
export type AllocationShrinkSource = "anulacion_recepcion" | "anulacion_guia" | "cotejo"
export type NoteItemResolution = "pendiente" | "desde_stock" | "en_compra" | "rechazada"
export type RecordPartSource = "stock" | "externo" | "texto"
export type RecordPartStockStatus = "no_aplica" | "descontado" | "pendiente_conciliar" | "revertido" | "sin_movimiento"

/**
 * Movimientos de consumo y reverso: apuntan al REGISTRO (`referenceType`
 * `mant_record` / `mant_record_void`, `referenceId` = id del registro) para que el
 * kárdex enlace a `/mantencion/registros/{id}` sin consultas. La línea se enlaza
 * por su `inventory_movement_id` / `reversal_movement_id` (únicos).
 */
export const MANT_CONSUMPTION_REFERENCE = "mant_record"
export const MANT_CONSUMPTION_REVERSAL_REFERENCE = "mant_record_void"

export type ConsumePartInput = {
  /** Id del registro (lo genera el teléfono): `referenceId` del movimiento. */
  recordId: string
  workOrderId: string
  /** Faena del registro (la del equipo al firmar). Se usa sólo si la OT no tiene reserva de ese repuesto. */
  recordWorksiteId: string
  productId: string
  allocationId?: string | null
  quantity: number
  actorUserId: string
  userEmail?: string
}

export type ConsumePartResult =
  | { status: "descontado"; movementId: string; allocationId: string | null; worksiteId: string }
  | { status: "pendiente_conciliar"; allocationId: string | null; worksiteId: string; note: string }

export type ReleasedAllocation = { allocationId: string; productId: string; worksiteId: string; quantity: number }

/** Fila de «Disponibles para esta OT» (app y registro web). */
export type WorkOrderAvailablePart = CatalogPartsAvailable & { workOrderId: string }

// ── Viewer y actor (los mismos de mantención) ───────────────────────────────

export type { MantViewer } from "@/lib/services/mantencion/access"

// ── Contratos de servicio de las líneas ─────────────────────────────────────
//
// Las firmas viven como stubs tipados (lanzan «pendiente») en:
//   L3 · lib/services/mantencion/parts-notes/create.ts   createPartsNoteFromDevice
//        lib/services/mantencion/parts-notes/query.ts    listPartsNotes, getPartsNote, loadPartsNotePrefill, loadWorkOrderPartsOverview
//        lib/services/mantencion/parts-notes/resolve.ts  resolveNoteItemFromStock, rejectNoteItem, voidPartsNote, linkNoteItemsToRequestTx
//   L4 · lib/services/mantencion/parts/conciliation.ts   conciliatePart, listPendingConciliation
// El dueño reemplaza el cuerpo sin cambiar la firma; los demás programan contra ella.

export type PartsActionResult = { ok: true; message?: string } | { ok: false; message: string; field?: string }

export type PartsNoteTab = "pendientes" | "en_gestion" | "cerradas"

export type PartsNoteListFilters = {
  tab: PartsNoteTab
  worksiteId?: string
  /** Búsqueda de la TopBar: NP, folio de OT, equipo o repuesto. */
  q?: string
  page?: number
  pageSize?: number
}

export type PartsNoteListRow = {
  id: string
  code: string
  status: PartsNoteStatus
  workOrderId: string
  workOrderFolio: string
  equipmentCode: string
  equipmentPlate: string
  worksiteId: string
  worksiteName: string
  requestedByName: string
  equipmentStopped: boolean
  pendingLines: number
  totalLines: number
  createdAt: string
}

export type PartsNoteDetailLine = {
  id: string
  description: string
  quantity: number
  unit: string
  partNumber: string | null
  productId: string | null
  productName: string | null
  resolution: NoteItemResolution
  resolutionReason: string | null
  resolvedByName: string | null
  resolvedAt: string | null
  stage: PartsNoteLineStage
  arrived: number
  used: number
  /** Ítems de solicitud que la compran, con su solicitud y su OC si ya existe. */
  purchases: Array<{ requestItemId: string; requestId: string; requestCode: string; status: string; orderId: string | null; orderCode: string | null }>
  /** Stock libre del producto en la faena de la OT (para «Reservar de bodega»); null sin producto. */
  freeInWorksite: number | null
}

/** Repuesto con stock libre en la faena actual del equipo: lo que jefatura puede «Reservar de bodega». */
export type PartsNoteStockOption = {
  productId: string
  name: string
  partNumber: string | null
  unit: string
  free: number
}

export type PartsNoteDetail = Omit<PartsNoteListRow, "pendingLines" | "totalLines"> & {
  notes: string | null
  voidReason: string | null
  lines: PartsNoteDetailLine[]
  canManage: boolean
  /**
   * Repuestos del catálogo con stock libre en la faena actual del equipo (sólo para quien
   * resuelve). El mecánico pide en texto libre: jefatura elige aquí cuál saca de la bodega.
   */
  stockOptions?: PartsNoteStockOption[]
}

/** Lo que `?np=<id>` precarga en la solicitud de repuestos (L2). */
export type PartsNotePrefill = {
  noteId: string
  noteCode: string
  worksiteId: string
  vehicleId: string
  vehicleLabel: string
  workOrderId: string
  workOrderFolio: string
  urgency: "high" | "critical"
  items: Array<{ partsNoteItemId: string; productId: string | null; description: string; quantity: number; unitOfMeasure: string; partNumber: string | null }>
}

/** La sección «Repuestos» de la OT (web) y su espejo en la app. */
export type WorkOrderPartsOverview = {
  notes: CatalogPartsNote[]
  available: WorkOrderAvailablePart[]
  /** Consumos de la OT: línea de registro, cantidad, estado de stock. */
  consumptions: Array<{
    recordPartId: string
    recordId: string
    recordFolio: string | null
    productId: string | null
    description: string
    quantity: number
    source: RecordPartSource
    stockStatus: RecordPartStockStatus
    stockNote: string | null
  }>
}

export type ConciliateInput =
  | { recordPartId: string; mode: "aplicar" }
  | { recordPartId: string; mode: "sin_movimiento"; reason: string }

export type PendingConciliationRow = {
  recordPartId: string
  recordId: string
  recordFolio: string | null
  workOrderId: string | null
  workOrderFolio: string | null
  worksiteId: string
  worksiteName: string
  productId: string
  productName: string
  quantity: number
  freeNow: number
  note: string | null
  signedAt: string
}
