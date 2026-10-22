/**
 * Proyección del control de combustible contra un Postgres real (PGlite con
 * todas las migraciones): cargas en terreno/TAE y log operacional →
 * `fuel_equipment_loads`, idempotencia, duplicadas entre canales, anulación y
 * reversión de lote con recálculo de la serie.
 */

import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { asc, eq } from "drizzle-orm"
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest"
import * as schema from "@/db/schema"
import { migratePGlite } from "@/lib/testing/pglite-migrate"

const pg = new PGlite()
const inMemoryDb = drizzle(pg, { schema })
const testGlobal = globalThis as typeof globalThis & { __db?: typeof inMemoryDb }
// @ts-expect-error — PGlite is structurally compatible at runtime
testGlobal.__db = inMemoryDb

vi.mock("@/db", () => ({
  get db() {
    return testGlobal.__db
  },
}))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }))
vi.mock("@/lib/auth/auth", () => ({ auth: vi.fn() }))

await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))

import type { Tx } from "@/db"
import {
  projectOperationRecords,
  projectTaeSubmissions,
  recomputeVehicleSeries,
  removeProjectionsForOperationBatch,
} from "@/lib/combustibles/control/projection"
import { backfillFuelEquipmentLoads } from "@/scripts/backfill-fuel-equipment-loads"
import { getPerformanceControlSettings, savePerformanceControlSettings } from "@/lib/combustibles/control/settings"
import { DEFAULT_PERFORMANCE_CONTROL_SETTINGS, PERFORMANCE_SETTINGS_KEY } from "@/lib/combustibles/control/contracts"

const tx = inMemoryDb as unknown as Tx
let seq = 0

async function taeSubmission(partial: Partial<typeof schema.fuelTaeSubmissions.$inferInsert> = {}) {
  seq += 1
  const id = partial.id ?? `sub-${seq}`
  await inMemoryDb.insert(schema.fuelTaeSubmissions).values({
    id,
    clientSubmissionId: `client-${id}`,
    publicResultToken: `token-${id}`,
    source: "public_pwa",
    worksiteId: "ws-a",
    loadingPointId: "lp-a",
    vehicleId: "veh-1",
    productId: "prod-diesel",
    equipmentCodeSnapshot: "CAM-01",
    loadedAt: "2026-03-01T12:00:00.000Z",
    submittedAt: "2026-03-01T12:01:00.000Z",
    driverNameSnapshot: "Conductor Uno",
    supervisorNameSnapshot: "Supervisor Uno",
    meterType: "odometer",
    meterReading: null,
    liters: 100,
    removedSealNumber: "0504",
    installedSealNumber: "0507",
    ...partial,
  })
  return id
}

async function operationRecord(partial: Partial<typeof schema.fuelOperationRecords.$inferInsert> = {}) {
  seq += 1
  const id = partial.id ?? `rec-${seq}`
  await inMemoryDb.insert(schema.fuelOperationRecords).values({
    id,
    batchId: "batch-1",
    worksiteId: "ws-a",
    vehicleId: "veh-1",
    plate: "AAAA11",
    fecha: "2026-02-01",
    horaCarga: "08:30",
    horometro: null,
    liters: 100,
    ...partial,
  })
  return id
}

const loadsOf = (vehicleId = "veh-1") => inMemoryDb.select().from(schema.fuelEquipmentLoads)
  .where(eq(schema.fuelEquipmentLoads.vehicleId, vehicleId))
  .orderBy(asc(schema.fuelEquipmentLoads.occurredAt), asc(schema.fuelEquipmentLoads.id))

const stable = (rows: Array<typeof schema.fuelEquipmentLoads.$inferSelect>) =>
  rows.map(({ updatedAt: _u, createdAt: _c, ...rest }) => rest)

describe("proyección del control de combustible", () => {
  beforeEach(async () => {
    await inMemoryDb.delete(schema.fuelEquipmentLoads)
    await inMemoryDb.delete(schema.fuelTaeSubmissions)
    await inMemoryDb.delete(schema.fuelOperationRecords)
    await inMemoryDb.delete(schema.fuelOperationBatches)
    await inMemoryDb.delete(schema.fuelTaeLoadingPoints)
    await inMemoryDb.delete(schema.fuelVehicles)
    await inMemoryDb.delete(schema.auditLog)
    await inMemoryDb.delete(schema.users)
    await inMemoryDb.delete(schema.worksites)

    await inMemoryDb.insert(schema.worksites).values([
      { id: "ws-a", name: "Faena A", code: "FN-A" },
      { id: "ws-b", name: "Faena B", code: "FN-B" },
    ])
    await inMemoryDb.insert(schema.users).values({ id: "u-1", name: "Importador", email: "imp@example.com", hashedPassword: "x" })
    await inMemoryDb.insert(schema.fuelProducts).values({ id: "prod-diesel", code: "DIESEL-T", name: "Diésel prueba", category: "diesel" }).onConflictDoNothing()
    await inMemoryDb.insert(schema.fuelEquipmentTypes).values({ id: "fet-test", slug: "camion-test", name: "Camión prueba" }).onConflictDoNothing()
    await inMemoryDb.insert(schema.fuelVehicles).values([
      { id: "veh-1", plate: "AAAA11", type: "camion", equipmentTypeId: "fet-test", worksiteId: "ws-a", meterType: "odometer", performanceUnit: "km_per_liter", tankCapacityLiters: 300 },
      { id: "veh-2", plate: "BBBB22", type: "camion", equipmentTypeId: "fet-test", worksiteId: "ws-a", meterType: "hour_meter", performanceUnit: "liters_per_hour" },
    ])
    await inMemoryDb.insert(schema.fuelTaeLoadingPoints).values({ id: "lp-a", worksiteId: "ws-a", name: "Camión surtidor", type: "truck_dispenser" })
    await inMemoryDb.insert(schema.fuelOperationBatches).values({
      id: "batch-1", archivoNombre: "consolidado.xlsx", hashArchivo: "h1", periodoDesde: "2026-01-01", periodoHasta: "2026-03-31", importadoPor: "u-1",
    })
  })

  afterAll(async () => {
    delete testGlobal.__db
    await pg.close()
  })

  it("proyecta cargas en terreno con rendimiento calculado, y proyectar dos veces deja las mismas filas", async () => {
    const s1 = await taeSubmission({ loadedAt: "2026-03-01T12:00:00.000Z", meterReading: 1000 })
    const s2 = await taeSubmission({ loadedAt: "2026-03-05T12:00:00.000Z", meterReading: 1500, liters: 50 })

    const first = await projectTaeSubmissions(tx, [s1, s2])
    expect(first).toMatchObject({ projected: 2, vehicleIds: ["veh-1"] })
    const rows = await loadsOf()
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({ source: "field", performanceStatus: "first_load", loadingPointType: "truck_dispenser", month: "2026-03", meterType: "odometer", driverName: "Conductor Uno" })
    expect(rows[1]).toMatchObject({ performanceStatus: "computed", performanceUnit: "km_per_liter", performanceValue: 10, anchorLoadId: rows[0]!.id, reviewStatus: "ok" })

    await projectTaeSubmissions(tx, [s1, s2])
    expect(stable(await loadsOf())).toEqual(stable(rows))
  })

  it("histórico con sello de relleno → legacy_tae marcado en revisión", async () => {
    const id = await taeSubmission({ source: "legacy_xlsx", removedSealNumber: "777777", meterReading: 1000 })
    await projectTaeSubmissions(tx, [id])
    const [row] = await loadsOf()
    expect(row).toMatchObject({ source: "legacy_tae", reviewStatus: "flagged", flagReasons: ["filler_value"] })
  })

  it("carga sin equipo de catálogo: unknown_vehicle, sin serie", async () => {
    const id = await taeSubmission({ vehicleId: null })
    const result = await projectTaeSubmissions(tx, [id])
    expect(result.vehicleIds).toEqual([])
    const [row] = await inMemoryDb.select().from(schema.fuelEquipmentLoads)
    expect(row).toMatchObject({ vehicleId: null, performanceStatus: "not_applicable", reviewStatus: "flagged", flagReasons: ["unknown_vehicle"] })
  })

  it("proyecta el log operacional: hora chilena, medio por alias, rendimiento declarado solo como contraste; omite sin faena y 0 L", async () => {
    const r1 = await operationRecord({ horometro: 1000, proveedorNombre: " copec  tct ", rendimiento: 99 })
    const r2 = await operationRecord({ fecha: "2026-02-03", horaCarga: "9:15", horometro: 1400, liters: 40, rendimiento: 99 })
    const noWorksite = await operationRecord({ worksiteId: null })
    const zero = await operationRecord({ liters: 0 })
    const filler = await operationRecord({ fecha: "1899-12-30", horaCarga: null })

    const result = await projectOperationRecords(tx, [r1, r2, noWorksite, zero, filler])
    expect(result.projected).toBe(3)
    expect(result.skipped).toEqual(expect.arrayContaining([
      { recordId: noWorksite, reason: "El registro no tiene faena asignada" },
      { recordId: zero, reason: "La carga no tiene litros (0 L o menos)" },
    ]))

    const rows = await loadsOf()
    expect(rows).toHaveLength(3)
    const [fillerRow, first, second] = rows
    expect(fillerRow).toMatchObject({ month: "1899-12", flagReasons: ["filler_value"], reviewStatus: "flagged" })
    // 08:30 en Santiago en febrero (verano, UTC−3) = 11:30 UTC.
    expect(new Date(first!.occurredAt).toISOString()).toBe("2026-02-01T11:30:00.000Z")
    expect(first).toMatchObject({ source: "operations_import", supplyMediumId: "fsm-tct", declaredPerformance: 99 })
    expect(second).toMatchObject({ performanceStatus: "computed", performanceValue: 10, declaredPerformance: 99 })

    const again = await projectOperationRecords(tx, [r1, r2, noWorksite, zero, filler])
    expect(again.projected).toBe(3)
    expect(stable(await loadsOf())).toEqual(stable(rows))
  })

  it("misma carga por planilla y por terreno dentro de la ventana: la segunda queda duplicada y fuera de la serie", async () => {
    const s = await taeSubmission({ loadedAt: "2026-02-01T11:30:00.000Z", meterReading: 1000 })
    const r = await operationRecord({ fecha: "2026-02-01", horaCarga: "08:40", horometro: 1000, liters: 100.3 })
    await projectTaeSubmissions(tx, [s])
    await projectOperationRecords(tx, [r])
    const [original, duplicate] = await loadsOf()
    expect(original).toMatchObject({ source: "field", duplicateOfId: null })
    expect(duplicate).toMatchObject({ source: "operations_import", duplicateOfId: original!.id, performanceStatus: "excluded", reviewStatus: "flagged", flagReasons: ["duplicate"] })
  })

  it("recalcula la serie al anular una carga en terreno", async () => {
    const s1 = await taeSubmission({ loadedAt: "2026-03-01T12:00:00.000Z", meterReading: 1000 })
    const s2 = await taeSubmission({ loadedAt: "2026-03-02T12:00:00.000Z", meterReading: 1200, liters: 40 })
    const s3 = await taeSubmission({ loadedAt: "2026-03-03T12:00:00.000Z", meterReading: 1500, liters: 50 })
    await projectTaeSubmissions(tx, [s1, s2, s3])
    expect((await loadsOf())[2]).toMatchObject({ performanceValue: 6, accumulatedLiters: 50 })

    await inMemoryDb.update(schema.fuelTaeSubmissions)
      .set({ status: "voided", reviewNote: "Carga digitada dos veces", reviewedAt: "2026-03-04T00:00:00.000Z" })
      .where(eq(schema.fuelTaeSubmissions.id, s2))
    await projectTaeSubmissions(tx, [s2])

    const [first, voided, third] = await loadsOf()
    expect(voided).toMatchObject({ performanceStatus: "excluded", voidReason: "Carga digitada dos veces" })
    expect(voided!.voidedAt).not.toBeNull()
    // Sin la anulada: 500 km ÷ 50 L desde la primera.
    expect(third).toMatchObject({ anchorLoadId: first!.id, meterDelta: 500, accumulatedLiters: 50, performanceValue: 10 })
  })

  it("si cambian los litros de una carga aprobada, la decisión vuelve a ok y se informa", async () => {
    const id = await taeSubmission({ meterReading: 1000 })
    await projectTaeSubmissions(tx, [id])
    const [row] = await loadsOf()
    await inMemoryDb.update(schema.fuelEquipmentLoads)
      .set({ reviewStatus: "approved", reviewNote: "Revisado en terreno", reviewedBy: "u-1", reviewedAt: "2026-03-02T00:00:00.000Z" })
      .where(eq(schema.fuelEquipmentLoads.id, row!.id))

    const unchanged = await projectTaeSubmissions(tx, [id])
    expect(unchanged.resetLoadIds).toEqual([])
    expect((await loadsOf())[0]!.reviewStatus).toBe("approved")

    await inMemoryDb.update(schema.fuelTaeSubmissions).set({ liters: 120 }).where(eq(schema.fuelTaeSubmissions.id, id))
    const changed = await projectTaeSubmissions(tx, [id])
    expect(changed.resetLoadIds).toEqual([row!.id])
    expect((await loadsOf())[0]).toMatchObject({ reviewStatus: "ok", reviewedBy: null, liters: 120 })
  })

  it("cambio de equipo recalcula también la serie del equipo anterior", async () => {
    const s1 = await taeSubmission({ loadedAt: "2026-03-01T12:00:00.000Z", meterReading: 1000 })
    const s2 = await taeSubmission({ loadedAt: "2026-03-02T12:00:00.000Z", meterReading: 1500, liters: 50 })
    await projectTaeSubmissions(tx, [s1, s2])
    await inMemoryDb.update(schema.fuelTaeSubmissions).set({ vehicleId: "veh-2" }).where(eq(schema.fuelTaeSubmissions.id, s1))
    const result = await projectTaeSubmissions(tx, [s1])
    expect(result.vehicleIds.sort()).toEqual(["veh-1", "veh-2"])
    expect((await loadsOf("veh-1"))[0]).toMatchObject({ performanceStatus: "first_load", anchorLoadId: null })
    expect((await loadsOf("veh-2"))[0]).toMatchObject({ meterType: "hour_meter", performanceStatus: "first_load" })
  })

  it("revertir un lote del log operacional borra sus proyecciones y recalcula el equipo", async () => {
    const s1 = await taeSubmission({ loadedAt: "2026-03-01T12:00:00.000Z", meterReading: 1000 })
    const r = await operationRecord({ fecha: "2026-03-02", horometro: 1200, liters: 40 })
    const s3 = await taeSubmission({ loadedAt: "2026-03-03T12:00:00.000Z", meterReading: 1500, liters: 50 })
    await projectTaeSubmissions(tx, [s1, s3])
    await projectOperationRecords(tx, [r])
    expect((await loadsOf()).at(-1)).toMatchObject({ meterDelta: 300, performanceValue: 6 })

    await removeProjectionsForOperationBatch(tx, "batch-1")
    const rows = await loadsOf()
    expect(rows).toHaveLength(2)
    expect(rows[1]).toMatchObject({ anchorLoadId: rows[0]!.id, meterDelta: 500, performanceValue: 10 })
  })

  it("recomputeVehicleSeries no escribe filas que no cambiaron", async () => {
    const s1 = await taeSubmission({ loadedAt: "2026-03-01T12:00:00.000Z", meterReading: 1000 })
    await projectTaeSubmissions(tx, [s1])
    const [before] = await loadsOf()
    await new Promise((resolve) => setTimeout(resolve, 5))
    await recomputeVehicleSeries(tx, "veh-1")
    const [after] = await loadsOf()
    expect(after!.updatedAt).toBe(before!.updatedAt)
  })

  it("los umbrales se guardan auditados, el k va a la regla y el recálculo los usa", async () => {
    await inMemoryDb.delete(schema.auditLog)
    await inMemoryDb.delete(schema.systemSettings).where(eq(schema.systemSettings.key, PERFORMANCE_SETTINGS_KEY))
    await inMemoryDb.delete(schema.fuelAnomalyRules).where(eq(schema.fuelAnomalyRules.code, "rendimiento_fuera_historico"))
    await inMemoryDb.insert(schema.fuelAnomalyRules).values({
      id: "rule-perf", code: "rendimiento_fuera_historico", name: "Rendimiento fuera del historial",
      config: JSON.stringify({ thresholdStdDevs: 2, equipmentTypes: { excavadora: { thresholdStdDevs: 3 } } }),
    })
    expect(await getPerformanceControlSettings()).toEqual(DEFAULT_PERFORMANCE_CONTROL_SETTINGS)

    const next = { ...DEFAULT_PERFORMANCE_CONTROL_SETTINGS, thresholdStdDevs: 2.5, maxKmPerLiter: 12 }
    await inMemoryDb.transaction(async (t) => savePerformanceControlSettings(t as unknown as Tx, next, { userId: "u-1" }))
    expect(await getPerformanceControlSettings()).toEqual(next)
    const [rule] = await inMemoryDb.select().from(schema.fuelAnomalyRules).where(eq(schema.fuelAnomalyRules.id, "rule-perf"))
    // Se conserva la excepción por tipo de equipo.
    expect(JSON.parse(rule!.config!)).toEqual({ thresholdStdDevs: 2.5, equipmentTypes: { excavadora: { thresholdStdDevs: 3 } } })
    const [audit] = await inMemoryDb.select().from(schema.auditLog).where(eq(schema.auditLog.entityType, "fuel_control_settings"))
    expect(JSON.parse(audit!.newState!)).toMatchObject({ maxKmPerLiter: 12 })

    await expect(inMemoryDb.transaction(async (t) => savePerformanceControlSettings(t as unknown as Tx, { ...next, minSamples: 0 }, { userId: "u-1" })))
      .rejects.toThrow("Se necesitan al menos 2 muestras")

    // 13 km/L supera la nueva cota de 12: implausible.
    const s1 = await taeSubmission({ loadedAt: "2026-03-01T12:00:00.000Z", meterReading: 1000 })
    const s2 = await taeSubmission({ loadedAt: "2026-03-02T12:00:00.000Z", meterReading: 1650, liters: 50 })
    await projectTaeSubmissions(tx, [s1, s2])
    expect((await loadsOf())[1]).toMatchObject({ performanceValue: 13, flagReasons: ["implausible"], reviewStatus: "flagged" })
    await inMemoryDb.delete(schema.systemSettings).where(eq(schema.systemSettings.key, PERFORMANCE_SETTINGS_KEY))
  })

  it("el backfill de despliegue proyecta lo pendiente y la segunda corrida no hace nada", async () => {
    await taeSubmission({ loadedAt: "2026-03-01T12:00:00.000Z", meterReading: 1000 })
    await taeSubmission({ loadedAt: "2026-03-05T12:00:00.000Z", meterReading: 1500, liters: 50 })
    await operationRecord({ fecha: "2026-03-03", horometro: 1200, liters: 40 })
    await operationRecord({ worksiteId: null })
    await taeSubmission({ vehicleId: null })

    const first = await backfillFuelEquipmentLoads()
    expect(first).toMatchObject({ pendientesTerreno: 3, pendientesLog: 1, equipos: 1, sinEquipo: 1, proyectadas: 4 })
    const rows = await loadsOf()
    expect(rows.map((row) => row.performanceStatus)).toEqual(["first_load", "computed", "computed"])

    const second = await backfillFuelEquipmentLoads()
    expect(second).toMatchObject({ pendientesTerreno: 0, pendientesLog: 0, proyectadas: 0 })
    // El resumen de la cola de revisión es lo que el log de despliegue muestra:
    // tiene que coincidir con la tabla, también cuando no quedó nada pendiente.
    const flagged = (await inMemoryDb.select({ reasons: schema.fuelEquipmentLoads.flagReasons }).from(schema.fuelEquipmentLoads)
      .where(eq(schema.fuelEquipmentLoads.reviewStatus, "flagged")))
    expect(second.enRevision).toBe(flagged.length)
    expect(second.enRevision).toBeGreaterThan(0)
    expect(Object.values(second.enRevisionPorMotivo).reduce((sum, count) => sum + count, 0)).toBe(flagged.flatMap((row) => row.reasons).length)
    expect(stable(await loadsOf())).toEqual(stable(rows))
  })

  it("la corrección «cambio de tablero» (raw_row.meterReset) parte la serie en la carga corregida", async () => {
    const s1 = await taeSubmission({ loadedAt: "2026-03-01T12:00:00.000Z", meterReading: 90_000 })
    const s2 = await taeSubmission({ loadedAt: "2026-03-02T12:00:00.000Z", meterReading: 100, liters: 40 })
    const s3 = await taeSubmission({ loadedAt: "2026-03-03T12:00:00.000Z", meterReading: 600, liters: 50 })
    await projectTaeSubmissions(tx, [s1, s2, s3])
    expect((await loadsOf())[1]).toMatchObject({ performanceStatus: "meter_regression", reviewStatus: "flagged" })

    await inMemoryDb.update(schema.fuelTaeSubmissions).set({ rawRow: { meterReset: true } }).where(eq(schema.fuelTaeSubmissions.id, s2))
    await projectTaeSubmissions(tx, [s2])
    const [, reset, after] = await loadsOf()
    expect(reset).toMatchObject({ meterReset: true, performanceStatus: "meter_reset", reviewStatus: "ok", flagReasons: [] })
    expect(after).toMatchObject({ anchorLoadId: reset!.id, meterDelta: 500, performanceValue: 10 })

    await inMemoryDb.update(schema.fuelTaeSubmissions).set({ rawRow: {} }).where(eq(schema.fuelTaeSubmissions.id, s2))
    await projectTaeSubmissions(tx, [s2])
    expect((await loadsOf())[1]).toMatchObject({ meterReset: false, performanceStatus: "meter_regression" })
  })
})
