import type { WorkOrderRecordForm } from "@/lib/services/mantencion/web-record"
import type { WorkOrderDetail, WorkOrderListRow } from "@/lib/services/mantencion/work-orders/types"

/** Datos de prueba de las pantallas de OT (no se importa desde código de producción). */
export function otRow(overrides: Partial<WorkOrderListRow> = {}): WorkOrderListRow {
  return {
    id: "ot-1", folio: "OT-BIO-0001", status: "en_ejecucion", vehicleId: "veh-1", equipmentCode: "KA-135", equipmentPlate: "RBYD-98", equipmentType: "Camión",
    worksiteId: "ws-1", worksiteName: "Biodiversa", repair: true, maintenance: false, requestDate: "2026-10-30", requesterName: "Ana Pérez",
    assignedToUserId: "u-mec", assignedToName: "Javier Roa", workshopEntryAt: "2026-10-31T13:00:00.000Z", estimatedDeliveryDate: "2026-11-05",
    workshopExitAt: null, estimateOverdue: false, daysInWorkshop: 2, rejectionCount: 0, createdAt: "2026-10-30T12:00:00.000Z", ...overrides,
  }
}

export function otDetail(overrides: Partial<WorkOrderDetail> = {}): WorkOrderDetail {
  return {
    ...otRow(),
    version: 4,
    unit: "km",
    repairDescription: "Pierde aceite por el cárter y hace ruido al frenar.",
    observations: "Equipo crítico para la faena.",
    totalCost: null,
    requestedByUserId: "u-adm",
    requestedByName: "Ana Pérez",
    assignedByName: "Alexis Soto",
    assignedAt: "2026-10-30T15:00:00.000Z",
    entry: {
      workshopKind: "externo", workshopId: "w-1", workshopName: "Taller Los Aromos", workshopManagerName: "Luis Mena", operatorDriverId: null, operatorName: "Pedro Díaz",
      entryAt: "2026-10-31T13:00:00.000Z", odometer: 120_500, hourmeter: null, estimatedDeliveryDate: "2026-11-05", startedByName: "Javier Roa",
    },
    exit: null,
    reception: null,
    faenaReception: null,
    voided: null,
    items: [
      { id: "i1", kind: "anexo", origin: "solicitud", description: "Cambiar pastillas de freno", sortOrder: 0, done: "si", note: null, markedByName: "Javier Roa", markedAt: "2026-11-01T15:00:00.000Z" },
      { id: "i2", kind: "anexo", origin: "taller", description: "Rectificar discos", sortOrder: 1, done: null, note: null, markedByName: null, markedAt: null },
      { id: "i3", kind: "mantencion", origin: "solicitud", description: "Cambio de aceite y filtros", sortOrder: 0, done: "no", note: "Falta el filtro", markedByName: "Javier Roa", markedAt: "2026-11-01T15:10:00.000Z" },
    ],
    events: [
      { id: "e1", type: "created", fromStatus: null, toStatus: "solicitada", reason: null, changeSet: null, actorName: "Ana Pérez", createdAt: "2026-10-30T12:00:00.000Z" },
      { id: "e2", type: "assigned", fromStatus: "solicitada", toStatus: "asignada", reason: null, changeSet: null, actorName: "Alexis Soto", createdAt: "2026-10-30T15:00:00.000Z" },
      { id: "e3", type: "rejected", fromStatus: "trabajo_terminado", toStatus: "en_ejecucion", reason: "Sigue la fuga de aceite", changeSet: null, actorName: "Ana Pérez", createdAt: "2026-11-02T10:00:00.000Z" },
      { id: "e4", type: "estimate_changed", fromStatus: null, toStatus: null, reason: "Llegó tarde el repuesto", changeSet: { from: "2026-11-03", to: "2026-11-05" }, actorName: "Javier Roa", createdAt: "2026-11-01T09:00:00.000Z" },
    ],
    linkedRecords: [
      { id: "rec-1", folio: "MC-BIO-0007", kind: "C", workDate: "2026-11-01", signedAt: "2026-11-01T16:00:00.000Z", status: "vigente", canOpen: true },
      { id: "rec-2", folio: "MC-SAN-0002", kind: "C", workDate: "2026-11-01", signedAt: "2026-11-01T17:00:00.000Z", status: "vigente", canOpen: false },
    ],
    inspectionFinding: null,
    allowedTransitions: [],
    canEditRequest: false,
    canEditExecution: false,
    canRegisterRecord: false,
    needsLinkedRecord: false,
    ...overrides,
  }
}

/** Formulario de registro desde la ficha: el camión de la OT (con pauta km) y catálogos mínimos. */
export function otRecordForm(overrides: Partial<WorkOrderRecordForm> = {}): WorkOrderRecordForm {
  return {
    equipment: {
      id: "veh-1", code: "KA-135", plate: "RBYD-98", noPlate: false, typeName: "Camión", unit: "km",
      brandId: "b-scania", brandName: "Scania", model: "R450", worksiteId: "ws-1", worksiteName: "Biodiversa",
      scheduleId: "sch-km", readings: [{ value: 120_000, date: "2026-10-01", source: "MC-BIO-0006" }],
      initialReading: { value: 100_000, date: "2026-01-01" }, state: "al_dia", nextReading: 130_000, remaining: 10_000,
      nextIntervalValue: 10_000, lastPreventive: null, recentPreventives: [], workshop: null,
    },
    schedule: {
      id: "sch-km", name: "Camiones y tractos", unit: "km", version: 1, intervals: [10_000, 20_000],
      groups: [{ name: "Motor", items: [{ key: "k1", name: "Revisión aceite motor", applies: [true, true] }] }],
      brandRules: [],
    },
    worksiteIds: ["ws-1"],
    workTypes: [{ id: "wt-mec", name: "Mecánico" }, { id: "wt-sold", name: "Soldadura" }],
    oils: [{ id: "oil-motor", name: "Motor" }],
    drivers: [{ id: "dr-1", name: "AEDO POLANCO JOSE A." }],
    workshops: [{ id: "w-1", name: "Taller Los Aromos" }],
    mechanics: [{ id: "u-2", name: "Marta Lillo" }],
    ...overrides,
  }
}
