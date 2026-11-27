/**
 * Tipos compartidos de repuestos con stock y notas de pedido (ADR mantención
 * 0001, 2026-11-26). Las firmas de servicio de abajo son el contrato entre las
 * líneas de trabajo: cada una la implementa su dueño (ver el plan de ejecución)
 * y las demás programan contra ella. Cambiar una firma exige avisar a quien la usa.
 */

import type { CatalogPartsAvailable, CatalogPartsNote, PartsNoteLineStage, PartsNoteStatus } from "@/lib/mantencion/contracts"
import type { NoteActionKey } from "../parts-notes/transitions"

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

/**
 * Pestañas de la bandeja de notas de pedido (fase 2, 2026-11-27): siguen el recorrido de la compra.
 *  - `por_revisar`: queda alguna línea por resolver (enviada, aceptada, en espera, en gestión).
 *  - `en_compra`: lo pedido se envió a compra y alguna compra viva aún no tiene orden de compra activa.
 *  - `en_recepcion`: recibida parcial, o todas sus compras vivas ya están en una OC activa y falta que llegue.
 *  - `cerradas`: cerrada, rechazada o anulada.
 * Cada nota cae en UNA sola pestaña (las condiciones están en `parts-notes/list-filters.ts`).
 */
export type PartsNoteTab = "por_revisar" | "en_compra" | "en_recepcion" | "cerradas"

/** Tramos de antigüedad de la bandeja (días en el estado actual): `?antiguedad=`. Ver `lib/mantencion/parts-notes-age.ts`. */
export type PartsNoteAgeKey = "0-2" | "3-6" | "7-13" | "14+"

/**
 * Filtros de la bandeja de notas de pedido, tal como los lee el servidor de la URL. El alcance NUNCA sale de aquí:
 * lo pone `noteVisibility(viewer)` y un filtro sólo recorta lo que ya se veía.
 */
export type PartsNoteFilterSet = {
  worksiteId?: string
  /** Búsqueda de texto: código de NP, folio externo, folio de OT, equipo, solicitante o repuesto. */
  q?: string
  /** Estado exacto (uno de los nueve), dentro de la pestaña. */
  status?: PartsNoteStatus
  /** `true`: sólo urgentes; `false`: sólo normales. */
  urgent?: boolean
  /** Rango de creación, días civiles `YYYY-MM-DD` en hora de Chile, ambos inclusivos. */
  from?: string
  to?: string
  /** Quién la pidió: texto contenido en su nombre (usuario o nombre de una nota importada). */
  requester?: string
  /** Equipo de la nota o de cualquiera de sus líneas (código, patente) o el cargo original sin calce. */
  equipment?: string
  /** Repuesto: texto de la línea, N° de parte o producto del catálogo (nombre, SKU). */
  article?: string
  /** Tramo de antigüedad: días civiles (hora de Chile) desde que la nota está en su estado actual (`status_since`). */
  age?: PartsNoteAgeKey
}

export type PartsNoteListFilters = PartsNoteFilterSet & {
  tab: PartsNoteTab
  page?: number
  pageSize?: number
  /** El «ahora» con que se miden los días en el estado (pruebas); por omisión, el día de hoy en Chile. */
  now?: Date
}

/** Una línea pendiente de la nota, tal como la bandeja la muestra para decidirla sin abrir la nota. */
export type PartsNotePendingLine = {
  id: string
  description: string
  quantity: number
  unitOfMeasure: string
}

export type PartsNoteListRow = {
  id: string
  code: string
  /** Folio del sistema de origen (p. ej. `CHOME-123`) de una nota importada. */
  externalRef: string | null
  status: PartsNoteStatus
  /** Desde cuándo está en este estado: el momento del último evento de su historial. */
  statusSince: string
  /** Null: nota sin OT. */
  workOrderId: string | null
  workOrderFolio: string | null
  /** Vacío si la NP no tiene equipo (sin OT). */
  equipmentCode: string
  equipmentPlate: string
  worksiteId: string
  worksiteName: string
  requestedByName: string
  equipmentStopped: boolean
  /** Urgencia que fijó quien creó la NP (`urgent`). */
  urgent: boolean
  /**
   * Líneas pendientes de la nota (resolución `pendiente`), en el orden de la nota. SÓLO se llenan en la pestaña `por_revisar`
   * (ahí es donde se deciden); en las demás pestañas viene `[]` aunque la nota tenga líneas.
   */
  pendingLines: PartsNotePendingLine[]
  totalLines: number
  /** Días civiles (hora de Chile) desde `statusSince`: la misma cuenta del tramo `?antiguedad=`. */
  ageDays: number
  /** A qué se imputan las líneas (equipo, centro de costo o el texto original), sin repetir y en el orden de las líneas. */
  charges: string[]
  createdAt: string
}

/** Cargo de una línea: a qué se imputa (equipo o centro de costo), con su texto para mostrarlo. */
export type PartsNoteLineCharge = {
  vehicleId: string | null
  costCenterId: string | null
  /** «KA-135 · RBYD-98», «Taller»… o el cargo original (`charge_text`) si no calzó. Null si no hay cargo. */
  label: string | null
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
  /** Cargo de la línea (equipo o centro de costo) y proveedor sugerido, si los trae. */
  charge: PartsNoteLineCharge | null
  suggestedSupplierId: string | null
  /** Nombre del proveedor sugerido del catálogo. */
  suggestedSupplierName: string | null
  supplierHint: string | null
}

/** Un renglón del historial de la nota (`mant_parts_note_events`, append-only): de qué estado a cuál, por qué y quién. */
export type PartsNoteEvent = {
  id: string
  kind: "creada" | "transicion" | "migrada"
  fromStatus: PartsNoteStatus | null
  toStatus: PartsNoteStatus
  reason: string | null
  /** Null = automático del sistema (una llegada, una recepción, la OT que termina). */
  actorName: string | null
  /** Descripción de la línea que causó el cambio, si la hubo. */
  itemDescription: string | null
  createdAt: string
}

/** Repuesto con stock libre en la faena actual del equipo: lo que jefatura puede «Reservar de bodega». */
export type PartsNoteStockOption = {
  productId: string
  name: string
  partNumber: string | null
  unit: string
  free: number
}

export type PartsNoteDetail = Omit<PartsNoteListRow, "pendingLines" | "totalLines" | "charges" | "ageDays"> & {
  notes: string | null
  voidReason: string | null
  /** Motivo de «En espera»; sólo viene con ese estado. */
  holdReason: string | null
  lines: PartsNoteDetailLine[]
  /** Historial completo, del más antiguo al más reciente. */
  events: PartsNoteEvent[]
  /**
   * Acciones de cabecera que quien mira puede hacer hoy (`allowedNoteActions` con su permiso, su alcance y lo que hay en la nota).
   * Es lo que la pantalla ofrece; el servidor repite la regla al ejecutar.
   */
  actions: NoteActionKey[]
  /** Resolver las líneas (reservar de bodega, comprar, rechazar): `mant:np:manage` y la faena de la nota en su alcance. */
  canManage: boolean
  /** Comprar lo pedido: `mant:np:manage` o `mant:np:purchase`, con la faena en su alcance. Sin ninguno la ficha es de lectura. */
  canBuy: boolean
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
  /** Equipo de la OT, o el cargo del equipo de las líneas si la NP no tiene OT (null si no hay). */
  vehicleId: string | null
  vehicleLabel: string | null
  /** Null: nota sin OT. La solicitud se arma sin OT. */
  workOrderId: string | null
  workOrderFolio: string | null
  urgency: "high" | "critical"
  items: Array<{
    partsNoteItemId: string
    productId: string | null
    description: string
    quantity: number
    unitOfMeasure: string
    partNumber: string | null
    /** Equipo al que se imputa la línea (sin OT): la solicitud lo copia en el ítem, con su etiqueta para mostrarlo. */
    chargeVehicleId: string | null
    chargeVehicleLabel: string | null
  }>
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
