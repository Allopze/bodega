import { IDBFactory } from "fake-indexeddb"
import type { CatalogEquipment, CatalogWorkOrder, MantCatalog, SyncCorrectiveRecord, SyncPreventiveRecord, WorkOrderOpPayload, WorkOrderOpRequest } from "../../contracts"
import type { MantScheduleSnapshot } from "../../types"
import { resetDbConnectionForTests } from "../db"
import { resetSignalForTests } from "../signal"
import { newRecordItem, newWorkOrderItem } from "../queue"
import type { DeviceAccount, QueueRecordItem, QueueWorkOrderItem, StoredCatalog, StoredPhoto } from "../types"

/** Base limpia entre pruebas: cierra la conexión y entrega un IndexedDB nuevo. */
export async function freshDb(): Promise<void> {
  await resetDbConnectionForTests()
  ;(globalThis as { indexedDB: IDBFactory }).indexedDB = new IDBFactory()
  resetSignalForTests()
}

export const UUID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`

export const SCHEDULE: MantScheduleSnapshot = {
  id: "sch-km",
  name: "Camiones y tractos",
  unit: "km",
  version: 3,
  intervals: [10_000, 20_000, 40_000],
  groups: [
    { name: "Motor", items: [
      { key: "m1", name: "Inspección visual", applies: [true, true, true] },
      { key: "m2", name: "Cambio aceite motor", applies: [false, true, true] },
    ] },
    { name: "Frenos", items: [
      { key: "f1", name: "Revisión pastillas", applies: [true, true, true] },
      { key: "f2", name: "Cambio líquido", applies: [false, false, true] },
    ] },
  ],
  brandRules: [{ itemKey: "m1", brandId: "b-scania", value: "W" }],
}

export function equipment(overrides: Partial<CatalogEquipment> = {}): CatalogEquipment {
  return {
    id: "veh-1", code: "KA-140", plate: "SGCP-84", noPlate: false, typeName: "Camión", unit: "km",
    brandId: "b-scania", brandName: "Scania", model: "P 410", worksiteId: "ws-bio", worksiteName: "Biodiversa",
    scheduleId: "sch-km", readings: [{ value: 40_312, date: "2026-10-01", source: "MP-BIO-0001" }],
    initialReading: { value: 30_000, date: "2026-01-01" }, state: "vencida", nextReading: 40_000, remaining: -312,
    nextIntervalValue: 40_000, lastPreventive: { reading: 20_000, date: "2026-09-12", intervalValue: 20_000 },
    recentPreventives: [], workshop: null,
    ...overrides,
  }
}

export function catalog(userId = "u-1", equipmentList: CatalogEquipment[] = [equipment()]): MantCatalog {
  return {
    version: "v1", generatedAt: "2026-10-28T12:00:00.000Z",
    user: { id: userId, name: "Javier Roa", worksiteIds: ["ws-bio"] },
    worksites: [{ id: "ws-bio", name: "Biodiversa" }],
    equipment: equipmentList, schedules: [SCHEDULE],
    brands: [{ id: "b-scania", name: "Scania" }], workshops: [{ id: "w-1", name: "Maestranza Melo" }],
    drivers: [{ id: "d-1", name: "AEDO POLANCO JOSE A." }], workTypes: [{ id: "t-1", name: "Mecánico" }],
    oils: [{ id: "o-1", name: "Motor" }], mechanics: [{ id: "u-2", name: "Luis Campos" }],
    myRecords: [], observations: [],
  }
}

export function storedCatalog(userId = "u-1", equipmentList?: CatalogEquipment[]): StoredCatalog {
  return { userId, etag: '"v1"', catalog: catalog(userId, equipmentList), fetchedAt: "2026-10-28T12:00:00.000Z", others: null }
}

export function account(userId = "u-1", overrides: Partial<DeviceAccount> = {}): DeviceAccount {
  return {
    userId, name: "Javier Roa", email: `${userId}@e2e.chome.cl`, token: `token-${userId}`,
    expiresAt: new Date(Date.now() + 20 * 24 * 3600_000).toISOString(), pin: null, pinFailures: 0, pinLockedUntil: null,
    status: "ok", lastUsedAt: "2026-10-28T10:00:00.000Z", ...overrides,
  }
}

export function preventivePayload(id: string, photoIds: [string, string], overrides: Partial<SyncPreventiveRecord> = {}): SyncPreventiveRecord {
  return {
    kind: "P", id, vehicleId: "veh-1", reading: 40_312, workDate: "2026-10-28", signedAt: "2026-10-28T15:00:00.000Z",
    offlineSince: null, deviceId: UUID(900), appVersion: "test", readingJumpConfirmed: false, duplicateConfirmed: false,
    correctsRecordId: null,
    photos: [{ id: photoIds[0], kind: "filtros" }, { id: photoIds[1], kind: "sticker" }],
    scheduleId: "sch-km", scheduleVersion: 3, intervalValue: 40_000, suggestedIntervalValue: 40_000, manualScheduleReason: null,
    items: [{ itemKey: "m1", value: "R", reason: null }], notes: "sin novedad",
    ...overrides,
  }
}

export function correctivePayload(id: string, photoId: string, overrides: Partial<SyncCorrectiveRecord> = {}): SyncCorrectiveRecord {
  return {
    kind: "C", id, vehicleId: "veh-1", reading: 40_400, workDate: "2026-10-28", signedAt: "2026-10-28T15:00:00.000Z",
    offlineSince: null, deviceId: UUID(900), appVersion: "test", readingJumpConfirmed: false, duplicateConfirmed: false,
    correctsRecordId: null, photos: [{ id: photoId, kind: "correctiva" }],
    jobs: [{ workTypeId: "t-1", hours: 2, noParts: true, parts: [] }], oilIds: [], noOilChange: true, executor: { kind: "yo" }, description: "Cambio de manguera",
    inWorkshop: true, workshopEntryDate: "2026-10-28", workshopReason: "Espera un repuesto", workOrder: null, driverIds: ["d-1"],
    ...overrides,
  }
}

export function photo(id: string, authorUserId = "u-1", overrides: Partial<StoredPhoto> = {}): StoredPhoto {
  return {
    id, authorUserId, kind: "filtros", blob: new Blob(["jpeg-bytes"], { type: "image/jpeg" }), sha256: "a".repeat(64),
    width: 1600, height: 1200, stampedAt: "2026-10-28T15:00:00.000Z", takenAtExif: null, exif: null, deviceId: UUID(900),
    uploaded: false, createdAt: "2026-10-28T15:00:00.000Z", ...overrides,
  }
}

export function recordItem(id: string, authorUserId: string, photoIds: [string, string], now = "2026-10-28T15:00:00.000Z"): QueueRecordItem {
  return newRecordItem({
    authorUserId,
    payload: preventivePayload(id, photoIds),
    photoIds,
    summary: { kind: "P", vehicleId: "veh-1", equipmentCode: "KA-140", equipmentPlate: "SGCP-84", unit: "km", intervalValue: 40_000, workDate: "2026-10-28", reading: 40_312, inWorkshop: false, workshopEntryDate: null },
  }, now)
}

export function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } })
}

/** Una OT del catálogo: por defecto «asignada» a u-1, con un ítem pedido de cada lista. */
export function workOrder(overrides: Partial<CatalogWorkOrder> = {}): CatalogWorkOrder {
  return {
    id: "ot-1", folio: "OT-BIO-0001", status: "asignada", vehicleId: "veh-1", equipmentCode: "KA-140", equipmentPlate: "SGCP-84", equipmentType: "Camión", unit: "km",
    worksiteId: "ws-bio", worksiteName: "Biodiversa", outOfWorksite: false, repair: true, maintenance: true, requestDate: "2026-10-27", requesterName: "Marcela Soto",
    repairDescription: "Fuga de aceite en el cárter", observations: null, assignedToUserId: "u-1", assignedToName: "Javier Roa", entry: null, exitAt: null,
    items: [
      { id: "it-1", kind: "anexo", origin: "solicitud", description: "Cambiar manguera de freno", done: null, note: null },
      { id: "it-2", kind: "mantencion", origin: "solicitud", description: "Cambio de aceite", done: null, note: null },
    ],
    lastRejection: null, linkedRecords: [],
    ...overrides,
  }
}

export const ENTRY = {
  workshopKind: "interno" as const, workshopName: null, workshopManagerName: "Pedro Silva", operatorName: "José Aedo", entryAt: "2026-10-28T13:00:00.000Z",
  odometer: 40_400, hourmeter: null, estimatedDeliveryDate: "2026-10-30",
}

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never
export type OtOpBody = DistributiveOmit<WorkOrderOpPayload, "id" | "workOrderId" | "createdAt" | "deviceId">

/** Una operación de OT lista para la cola (el id de la operación es el de la cola; `n` ordena por hora de creación). */
export function otOpItem(n: number, body: OtOpBody, overrides: { workOrderId?: string; authorUserId?: string; createdAt?: string } = {}): QueueWorkOrderItem {
  const createdAt = overrides.createdAt ?? `2026-10-28T15:0${n}:00.000Z`
  const workOrderId = overrides.workOrderId ?? "ot-1"
  return newWorkOrderItem({
    authorUserId: overrides.authorUserId ?? "u-1",
    payload: { ...body, id: UUID(500 + n), workOrderId, createdAt, deviceId: UUID(900) } as WorkOrderOpPayload,
    summary: { workOrderId, folio: "OT-BIO-0001", equipmentCode: "KA-140", equipmentPlate: "SGCP-84" },
  }, createdAt)
}

/** Un «tomar» que quedó en la cola de un teléfono antes de que se retirara (2026-11). */
export function legacyTakeItem(n: number, overrides: { workOrderId?: string; authorUserId?: string; createdAt?: string } = {}): QueueWorkOrderItem {
  const item = otOpItem(n, { action: "estimate", estimatedDeliveryDate: "2026-10-30", reason: null }, overrides)
  const { id, workOrderId, createdAt, deviceId } = item.payload
  return { ...item, payload: { id, workOrderId, createdAt, deviceId, action: "take" } satisfies WorkOrderOpRequest }
}
