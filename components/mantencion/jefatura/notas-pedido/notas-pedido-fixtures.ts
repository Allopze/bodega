import type {
  PartsNoteDetail, PartsNoteDetailLine, PartsNoteListRow, PendingConciliationRow, WorkOrderAvailablePart, WorkOrderPartsOverview,
} from "@/lib/services/mantencion/parts/types"

/** Datos de prueba de las pantallas de notas de pedido (no se importa desde código de producción). */
export function noteRow(overrides: Partial<PartsNoteListRow> = {}): PartsNoteListRow {
  return {
    id: "n1", code: "NP-2026-0001", status: "enviada", workOrderId: "ot-1", workOrderFolio: "OT-BIO-0001", equipmentCode: "KA-135", equipmentPlate: "RBYD-98",
    worksiteId: "ws-1", worksiteName: "Biodiversa", requestedByName: "Javier Roa", equipmentStopped: false, pendingLines: 2, totalLines: 3,
    createdAt: "2026-11-20T15:00:00.000Z", urgent: false, ...overrides,
  }
}

export function noteLine(overrides: Partial<PartsNoteDetailLine> = {}): PartsNoteDetailLine {
  return {
    id: "i1", description: "Filtro de aceite", quantity: 2, unit: "unidad", partNumber: "1R-0750", productId: "p1", productName: "Filtro de aceite motor",
    resolution: "pendiente", resolutionReason: null, resolvedByName: null, resolvedAt: null, stage: "pedido", arrived: 0, used: 0, purchases: [], freeInWorksite: 5,
    charge: null, suggestedSupplierId: null, supplierHint: null,
    ...overrides,
  }
}

export function noteDetail(overrides: Partial<PartsNoteDetail> = {}): PartsNoteDetail {
  const { pendingLines: _pending, totalLines: _total, ...base } = noteRow()
  void _pending
  void _total
  return {
    ...base,
    notes: "Se rompió en la ruta; el equipo no puede salir.",
    voidReason: null,
    canManage: true,
    lines: [noteLine()],
    ...overrides,
  }
}

export function pendingRow(overrides: Partial<PendingConciliationRow> = {}): PendingConciliationRow {
  return {
    recordPartId: "rp-1", recordId: "rec-1", recordFolio: "MC-BIO-0007", workOrderId: "ot-1", workOrderFolio: "OT-BIO-0001", worksiteId: "ws-1", worksiteName: "Biodiversa",
    productId: "p1", productName: "Filtro de aceite motor", quantity: 2, freeNow: 3, note: "No había stock al sincronizar", signedAt: "2026-11-21T12:00:00.000Z",
    ...overrides,
  }
}

export function availablePart(overrides: Partial<WorkOrderAvailablePart> = {}): WorkOrderAvailablePart {
  return {
    workOrderId: "ot-1", allocationId: "al-1", productId: "p1", name: "Filtro de aceite", partNumber: "1R-0750", unit: "unidad", wholeOnly: true,
    worksiteId: "ws-1", worksiteName: "Santa Fe", remaining: 2, ...overrides,
  }
}

export function partsOverview(overrides: Partial<WorkOrderPartsOverview> = {}): WorkOrderPartsOverview {
  return {
    notes: [{
      id: "n1", code: "NP-2026-0001", status: "en_gestion", equipmentStopped: true, createdAt: "2026-11-20T15:00:00.000Z",
      lines: [
        { id: "i1", description: "Filtro de aceite", quantity: 2, unit: "unidad", partNumber: "1R-0750", stage: "en_bodega", arrived: 2, used: 1, rejectionReason: null },
        { id: "i2", description: "Correa", quantity: 1, unit: "unidad", partNumber: null, stage: "en_compra", arrived: 0, used: 0, rejectionReason: null },
        { id: "i3", description: "Sello", quantity: 1, unit: "unidad", partNumber: null, stage: "rechazado", arrived: 0, used: 0, rejectionReason: "Ya hay en la faena" },
      ],
    }],
    available: [availablePart()],
    consumptions: [
      { recordPartId: "rp-1", recordId: "rec-1", recordFolio: "MC-BIO-0007", productId: "p1", description: "Filtro de aceite", quantity: 1, source: "stock", stockStatus: "descontado", stockNote: null },
      { recordPartId: "rp-2", recordId: "rec-2", recordFolio: "MC-BIO-0008", productId: "p2", description: "Correa", quantity: 1, source: "stock", stockStatus: "pendiente_conciliar", stockNote: "No había stock al sincronizar" },
      { recordPartId: "rp-3", recordId: "rec-2", recordFolio: "MC-BIO-0008", productId: null, description: "Grasa", quantity: 1, source: "externo", stockStatus: "sin_movimiento", stockNote: null },
      { recordPartId: "rp-4", recordId: "rec-3", recordFolio: null, productId: "p3", description: "Perno", quantity: 4, source: "stock", stockStatus: "revertido", stockNote: null },
    ],
    ...overrides,
  }
}
