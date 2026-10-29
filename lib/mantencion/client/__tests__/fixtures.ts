import { IDBFactory } from "fake-indexeddb"
import type { CatalogEquipment, MantCatalog, SyncCorrectiveRecord, SyncPreventiveRecord } from "../../contracts"
import type { MantScheduleSnapshot } from "../../types"
import { resetDbConnectionForTests } from "../db"
import { resetSignalForTests } from "../signal"
import { newRecordItem } from "../queue"
import type { DeviceAccount, QueueRecordItem, StoredCatalog, StoredPhoto } from "../types"

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
    workTypeIds: ["t-1"], oilIds: [], noOilChange: true, executor: { kind: "yo" }, description: "Cambio de manguera",
    parts: [], noParts: true, hours: 2, inWorkshop: true, workshopEntryDate: "2026-10-28", workOrder: null, driverIds: ["d-1"],
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
