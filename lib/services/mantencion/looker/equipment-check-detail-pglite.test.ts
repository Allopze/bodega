import { PGlite } from "@electric-sql/pglite"
import { eq } from "drizzle-orm"
import { drizzle } from "drizzle-orm/pglite"
import { beforeAll, describe, expect, it, vi } from "vitest"
import * as schema from "@/db/schema"
import type { DB } from "@/db"
import { migratePGlite } from "@/lib/testing/pglite-migrate"

/**
 * Ficha de un equipo en Preventivo contra Postgres de verdad: pautas del período con los mismos alcances que las
 * tablas, lo no realizado con su motivo (registro de la plataforma) o sin él (formulario histórico, que no lo trae),
 * el sistema del histórico sólo cuando coincide exacto con la pauta vigente, y los límites de alcance.
 */

const pg = new PGlite()
const testDb = drizzle(pg, { schema }) as unknown as DB
const testGlobal = globalThis as typeof globalThis & { __db?: DB }
testGlobal.__db = testDb

vi.mock("@/db", () => ({
  get db() { return testGlobal.__db },
  get Tx() { return undefined },
}))

const { loadEquipmentCheckDetail } = await import("@/lib/services/mantencion/looker/equipment-check-detail")

const WS_A = "ws-ficha-a"
const WS_B = "ws-ficha-b"
const U = "u-ficha"
const V1 = "v-ficha-1"
const V2 = "v-ficha-2"
const PERIOD = { from: "2026-10-01", to: "2026-12-31" }
const GLOBAL = { userId: U, email: null, permissions: ["mant:records:view_all"], worksiteIds: [], isGlobal: true }
const SCOPED_A = { userId: U, email: null, permissions: ["mant:records:view_worksite"], worksiteIds: [WS_A], isGlobal: false }
const NO_PERMISSION = { userId: U, email: null, permissions: ["mant:records:view_own"], worksiteIds: [WS_A], isGlobal: false }
const DRIVE = "https://drive.google.com/open?id=abc"
const SNAP = (code: string, plate: string) => ({ code, plate, noPlate: false, type: "Camión", brand: "Scania", model: "R450", year: 2021, worksite: "Faena A", unit: "km" as const })

beforeAll(async () => {
  await migratePGlite(pg, "db/migrations")
  const now = new Date().toISOString()
  await testDb.insert(schema.users).values({ id: U, name: "Usuario Ficha", email: `${U}@chome.test`, hashedPassword: "hash", isActive: true, createdAt: now, updatedAt: now })
  await testDb.insert(schema.worksites).values([
    { id: WS_A, name: "Faena A", code: "FICHA-A", isActive: true, createdAt: now, updatedAt: now },
    { id: WS_B, name: "Faena B", code: "FICHA-B", isActive: true, createdAt: now, updatedAt: now },
  ])
  await testDb.insert(schema.fuelEquipmentTypes).values({ id: "fet-ficha", slug: "ficha-km", name: "Camión", category: "truck", defaultMeterType: "odometer", defaultPerformanceUnit: "km_per_liter" })
  await testDb.insert(schema.mantBrands).values({ id: "b-ficha", name: "Scania", nameKey: "scania-ficha" })
  await testDb.insert(schema.fuelVehicles).values([
    { id: V1, code: "KA-F1", plate: "FICHA-01", type: "Camión", equipmentTypeId: "fet-ficha", worksiteId: WS_A, model: "R450", year: 2021, brand: "Scania" },
    { id: V2, code: "KA-F2", plate: "FICHA-02", type: "Camión", equipmentTypeId: "fet-ficha", worksiteId: WS_B, model: "R450", year: 2021, brand: "Scania" },
  ])
  await testDb.insert(schema.mantEquipmentProfiles).values([V1, V2].map((vehicleId) => ({ vehicleId, brandId: "b-ficha" })))

  // Pauta vigente de V1: «Cambio aceite motor» está en un solo sistema; «Revisión general» en dos (no se adivina).
  await testDb.insert(schema.mantSchedules).values({ id: "s-ficha", name: "Camiones", nameKey: "camiones-ficha", unit: "km", version: 1 })
  await testDb.insert(schema.mantScheduleVersions).values({
    scheduleId: "s-ficha", version: 1, summary: "Pauta de prueba", createdBy: U,
    snapshot: {
      id: "s-ficha", name: "Camiones", unit: "km", version: 1, intervals: [40_000], brandRules: [],
      groups: [
        { name: "Motor", items: [{ key: "a", name: "Cambio aceite motor", applies: [true] }, { key: "b", name: "Revisión general", applies: [true] }] },
        { name: "Frenos", items: [{ key: "c", name: "Revisión general", applies: [true] }] },
      ],
    },
  })
  await testDb.update(schema.mantEquipmentProfiles).set({ scheduleId: "s-ficha" }).where(eq(schema.mantEquipmentProfiles.vehicleId, V1))

  const historical = (sourceKey: string, vehicleId: string, worksiteId: string, performedOn: string, extra: Record<string, unknown> = {}) => ({
    sourceKey, fingerprint: `fp-${sourceKey}`, sourceFile: "consolidado.xlsx", sourceSheet: "PAUTAS_PREVENTIVAS", sourceRow: 3,
    submittedAt: `${performedOn} 10:00:00`, performedOn, formKind: "CAMIONES", scheduleLabel: "40.000 KM", equipmentText: "KA / FICHA",
    vehicleId, equipmentMatch: "linked", worksiteText: "Faena", worksiteId, reading: 145_000, doneCount: 1, notDoneCount: 1,
    notApplicableCount: 1, compliance: 0.5, mechanic: "Javier Roa", isTest: false, fields: [], importedBy: U, ...extra,
  })
  await testDb.insert(schema.mantHistoricalScheduleChecks).values([
    // 15-10 con detalle por ítem, un enlace de Drive y SIN sticker.
    historical("h-detalle", V1, WS_A, "2026-10-15", { filtersPhotoUrl: DRIVE, observations: "Todo en orden" }),
    // 02-10 sin detalle por ítem: sólo los nombres de lo no realizado.
    historical("h-sin-detalle", V1, WS_A, "2026-10-02", { itemsNotDone: ["Filtro cabina", " Filtro cabina "], doneCount: 5, notDoneCount: 1, notApplicableCount: 0 }),
    // Fuera del período.
    historical("h-viejo", V1, WS_A, "2026-09-20"),
    // Otro equipo, otra faena.
    historical("h-ajena", V2, WS_B, "2026-10-10"),
  ])
  await testDb.insert(schema.mantHistoricalScheduleItems).values([
    { sourceKey: "i-1", checkSourceKey: "h-detalle", itemName: "Cambio aceite motor", result: "realizado", sortOrder: 0 },
    { sourceKey: "i-2", checkSourceKey: "h-detalle", itemName: "Revisión frenos", result: "no_realizado", sortOrder: 1 },
    { sourceKey: "i-3", checkSourceKey: "h-detalle", itemName: "Revisión general", result: "no_aplica", sortOrder: 2 },
    { sourceKey: "i-4", checkSourceKey: "h-ajena", itemName: "Ítem de otra faena", result: "no_realizado", sortOrder: 0 },
  ])

  // Registro de la plataforma desde el corte: 1 R, 1 NR con motivo, 1 NA; foto de filtros pero no sticker.
  await testDb.insert(schema.mantRecords).values({
    id: "rec-ficha", folio: "MR-P-77", kind: "P", vehicleId: V1, equipmentSnapshot: SNAP("KA-F1", "FICHA-01"), worksiteId: WS_A,
    reading: 151_000, unit: "km", workDate: "2026-12-10", registeredBy: U, executorKind: "yo", executorUserId: U,
    executorName: "Mecánico Nativo", signedAt: "2026-12-10T15:00:00Z", receivedAt: "2026-12-10T15:00:00Z",
    status: "vigente", review: "pendiente", scheduleVersion: 1, scheduleNameSnapshot: "Camiones", intervalValue: 40_000,
    suggestedIntervalValue: 40_000, notes: "Pauta de diciembre",
  })
  await testDb.insert(schema.mantRecordItems).values([
    { id: "ri-1", recordId: "rec-ficha", itemKey: "a", groupName: "Motor", itemName: "Cambio aceite motor", sortOrder: 0, value: "R" },
    { id: "ri-2", recordId: "rec-ficha", itemKey: "c", groupName: "Frenos", itemName: "Revisión frenos", sortOrder: 1, value: "NR", reason: "Sin repuesto" },
    { id: "ri-3", recordId: "rec-ficha", itemKey: "d", groupName: "Frenos", itemName: "Revisión ABS", sortOrder: 2, value: "NA" },
  ])
  await testDb.insert(schema.mantRecordPhotos).values({
    id: "ph-ficha", recordId: "rec-ficha", kind: "filtros", storageKey: "storage/mantencion/ph-ficha.jpg", mimeType: "image/jpeg",
    sha256: "0".repeat(64), bytes: 4, width: 100, height: 100, stampedAt: "2026-12-10T15:00:00Z", uploadedBy: U, sortOrder: 0,
  })
})

describe("Ficha del equipo · pautas y pendientes", () => {
  it("lista las pautas del período, la más reciente primero, sin las de otro equipo ni las de fuera del período", async () => {
    const detail = await loadEquipmentCheckDetail(GLOBAL, V1, PERIOD)
    expect(detail?.vehicle).toMatchObject({ code: "KA-F1", plate: "FICHA-01", typeName: "Camión", worksiteName: "Faena A" })
    expect(detail?.checks.map((check) => check.id)).toEqual(["r:rec-ficha", "h:h-detalle", "h:h-sin-detalle"])
    expect(detail?.checks[0]).toMatchObject({ source: "registro", folio: "MR-P-77", recordId: "rec-ficha", notDone: 1 })
    expect(detail?.checks[1]).toMatchObject({ source: "historial", folio: null, recordId: null })
  })

  it("agrega lo no hecho en todas las pautas: «Revisión frenos» en dos, «Filtro cabina» en una", async () => {
    const detail = await loadEquipmentCheckDetail(GLOBAL, V1, PERIOD)
    expect(detail?.pending.map((item) => [item.name, item.notDoneCount])).toEqual([["Revisión frenos", 2], ["Filtro cabina", 1]])
    expect(detail?.pending[0]).toMatchObject({ system: "Frenos", dates: ["2026-12-10", "2026-10-15"] })
  })
})

describe("Ficha del equipo · detalle de una pauta", () => {
  it("la pauta más reciente (registro nativo): motivo del no realizado, foto de filtros y sticker faltante", async () => {
    const detail = await loadEquipmentCheckDetail(GLOBAL, V1, PERIOD)
    const selected = detail!.selected!
    expect(selected.id).toBe("r:rec-ficha")
    expect(selected.itemDetail).toBe("full")
    expect(selected.items.find((item) => item.state === "no_realizado")).toMatchObject({ name: "Revisión frenos", system: "Frenos", reason: "Sin repuesto" })
    expect(selected.observations).toBe("Pauta de diciembre")
    expect(selected.reading).toBe(151_000)
    expect(selected.filtersPhoto).toMatchObject({ status: "native", id: "ph-ficha" })
    expect(selected.stickerPhoto).toEqual({ status: "missing" })
  })

  it("el histórico no trae motivo y no se inventa; el sistema sólo si el nombre es exacto y único en la pauta vigente", async () => {
    const detail = await loadEquipmentCheckDetail(GLOBAL, V1, PERIOD, "h:h-detalle")
    const selected = detail!.selected!
    expect(selected.id).toBe("h:h-detalle")
    expect(selected.items.every((item) => item.reason === null)).toBe(true)
    expect(selected.items.map((item) => [item.name, item.system])).toEqual([
      ["Cambio aceite motor", "Motor"], // exacto y en un solo sistema
      ["Revisión frenos", null], // la pauta vigente no lo trae
      ["Revisión general", null], // está en dos sistemas: no se adivina
    ])
    expect(selected.filtersPhoto).toEqual({ status: "link", url: DRIVE })
    expect(selected.stickerPhoto).toEqual({ status: "missing" })
    expect(selected.observations).toBe("Todo en orden")
  })

  it("una pauta histórica sin detalle por ítem muestra los nombres de lo no realizado y lo dice", async () => {
    const detail = await loadEquipmentCheckDetail(GLOBAL, V1, PERIOD, "h:h-sin-detalle")
    expect(detail!.selected).toMatchObject({ itemDetail: "not_done_only" })
    expect(detail!.selected!.items).toEqual([{ name: "Filtro cabina", system: null, state: "no_realizado", reason: null }])
  })
})

describe("Ficha del equipo · alcance", () => {
  it("un equipo de otra faena es null para quien sólo ve la suya, y visible para quien ve todo", async () => {
    expect(await loadEquipmentCheckDetail(SCOPED_A, V2, PERIOD)).toBeNull()
    const global = await loadEquipmentCheckDetail(GLOBAL, V2, PERIOD)
    expect(global?.checks.map((check) => check.id)).toEqual(["h:h-ajena"])
  })

  it("quien ve su faena ve la ficha de su equipo", async () => {
    const detail = await loadEquipmentCheckDetail(SCOPED_A, V1, PERIOD)
    expect(detail?.checks).toHaveLength(3)
  })

  it("sin permiso de lectura de faena o total, o con un equipo inexistente, es null", async () => {
    expect(await loadEquipmentCheckDetail(NO_PERMISSION, V1, PERIOD)).toBeNull()
    expect(await loadEquipmentCheckDetail(GLOBAL, "v-no-existe", PERIOD)).toBeNull()
  })

  it("una pauta de otro equipo (o inexistente) en `pauta` se ignora: se muestra la más reciente de ESTE equipo", async () => {
    const foreign = await loadEquipmentCheckDetail(GLOBAL, V1, PERIOD, "h:h-ajena")
    expect(foreign?.selected?.id).toBe("r:rec-ficha")
    expect(JSON.stringify(foreign)).not.toContain("Ítem de otra faena")
    expect((await loadEquipmentCheckDetail(GLOBAL, V1, PERIOD, "h:no-existe"))?.selected?.id).toBe("r:rec-ficha")
  })

  it("un equipo del alcance sin pautas en el período devuelve la ficha vacía, no null", async () => {
    const detail = await loadEquipmentCheckDetail(SCOPED_A, V1, { from: "2026-01-01", to: "2026-01-31" })
    expect(detail).toMatchObject({ checks: [], pending: [], selected: null })
  })
})
