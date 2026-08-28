import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { eq } from "drizzle-orm"
import { drizzle } from "drizzle-orm/pglite"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import { migratePGlite } from "@/lib/testing/pglite-migrate"
import * as schema from "@/db/schema"

const pg = new PGlite()
const inMemoryDb = drizzle(pg, { schema })
const testGlobal = globalThis as typeof globalThis & { __db?: typeof inMemoryDb }
// @ts-expect-error PGlite is runtime-compatible with the app database.
testGlobal.__db = inMemoryDb

vi.mock("@/db", () => ({
  get db() {
    return testGlobal.__db
  },
}))

await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))

const { reevaluateFuelLoadAnomalies, resolveCorrectedMeterCases } = await import("@/lib/combustibles/fuel-load-anomaly-reevaluation")
const { lastKnownMeterReading, meterReadingFieldErrors } = await import("@/lib/combustibles/meter-readings")

const ACTOR_ID = "fuel-anomaly-actor"
const WORKSITE_ID = "fuel-anomaly-worksite"
const PRODUCT_ID = "fuel-anomaly-product"
const EQUIPMENT_TYPE_ID = "fuel-anomaly-type"
const USUAL_SUPPLIER_ID = "fuel-anomaly-usual-supplier"
const OTHER_SUPPLIER_ID = "fuel-anomaly-other-supplier"
const VEHICLE_ID = "fuel-anomaly-vehicle"
const LOAD_ID = "fuel-anomaly-load"
const RULE_ID = "fuel-anomaly-rule"

beforeAll(async () => {
  await inMemoryDb.insert(schema.users).values({
    id: ACTOR_ID, name: "Analista", email: "analista-anomalias@example.test", hashedPassword: "x",
  })
  await inMemoryDb.insert(schema.worksites).values({ id: WORKSITE_ID, name: "Faena", code: "FAR-01", isActive: true })
  await inMemoryDb.insert(schema.fuelProducts).values({ id: PRODUCT_ID, code: "FAR-DIESEL", name: "Diésel", category: "diesel", unit: "liter" })
  await inMemoryDb.insert(schema.fuelEquipmentTypes).values({ id: EQUIPMENT_TYPE_ID, slug: "far-camion", name: "Camión" })
  await inMemoryDb.insert(schema.fuelSuppliers).values([
    { id: USUAL_SUPPLIER_ID, name: "Proveedor habitual" },
    { id: OTHER_SUPPLIER_ID, name: "Proveedor alternativo" },
  ])
  await inMemoryDb.insert(schema.fuelVehicles).values({
    id: VEHICLE_ID, plate: "FAR-001", type: "camion", equipmentTypeId: EQUIPMENT_TYPE_ID,
    worksiteId: WORKSITE_ID, usualFuelSupplierId: USUAL_SUPPLIER_ID, isActive: true,
  })
  await inMemoryDb.insert(schema.fuelLoads).values({
    id: LOAD_ID, loadDate: "2026-07-28", month: "2026-07", serviceType: "TCT",
    vehicleId: VEHICLE_ID, fuelSupplierId: OTHER_SUPPLIER_ID, worksiteId: WORKSITE_ID,
    product: "PETROLEO DIESEL", productId: PRODUCT_ID, liters: 100,
    baseAmount: 1_000, iecFixed: 0, iecVariable: 0, iecTotal: 0, ivaAmount: 190, totalAmount: 1_190,
    createdBy: ACTOR_ID,
  })
  await inMemoryDb.insert(schema.fuelAnomalyRules).values({
    id: RULE_ID, code: "proveedor_no_habitual", name: "Proveedor no habitual", severity: "low", isActive: true, config: "{}",
  })
})

afterAll(async () => {
  delete testGlobal.__db
  await pg.close()
})

describe("reevaluateFuelLoadAnomalies", () => {
  it("crea, resuelve y reabre el mismo caso al editar el proveedor de una carga", async () => {
    await expect(reevaluateFuelLoadAnomalies(LOAD_ID, ACTOR_ID)).resolves.toEqual({ created: 1, reopened: 0, resolved: 0 })
    const [created] = await inMemoryDb.select().from(schema.fuelAnomalyCases)
      .where(eq(schema.fuelAnomalyCases.referenceEntityId, LOAD_ID))
    expect(created).toMatchObject({ ruleCode: "proveedor_no_habitual", status: "open", observedValue: OTHER_SUPPLIER_ID, expectedValue: USUAL_SUPPLIER_ID })

    await inMemoryDb.update(schema.fuelLoads).set({ fuelSupplierId: USUAL_SUPPLIER_ID }).where(eq(schema.fuelLoads.id, LOAD_ID))
    await expect(reevaluateFuelLoadAnomalies(LOAD_ID, ACTOR_ID)).resolves.toEqual({ created: 0, reopened: 0, resolved: 1 })
    const [resolved] = await inMemoryDb.select().from(schema.fuelAnomalyCases).where(eq(schema.fuelAnomalyCases.id, created!.id))
    expect(resolved).toMatchObject({ status: "resolved", resolvedById: ACTOR_ID })

    await inMemoryDb.update(schema.fuelLoads).set({ fuelSupplierId: OTHER_SUPPLIER_ID }).where(eq(schema.fuelLoads.id, LOAD_ID))
    await expect(reevaluateFuelLoadAnomalies(LOAD_ID, ACTOR_ID)).resolves.toEqual({ created: 0, reopened: 1, resolved: 0 })
    const [reopened] = await inMemoryDb.select().from(schema.fuelAnomalyCases).where(eq(schema.fuelAnomalyCases.id, created!.id))
    const comments = await inMemoryDb.select().from(schema.fuelAnomalyComments).where(eq(schema.fuelAnomalyComments.caseId, created!.id))
    const history = await inMemoryDb.select().from(schema.statusHistory).where(eq(schema.statusHistory.entityId, created!.id))
    const audit = await inMemoryDb.select().from(schema.auditLog).where(eq(schema.auditLog.entityId, created!.id))
    expect(reopened).toMatchObject({ status: "reopened", resolvedById: null, observedValue: OTHER_SUPPLIER_ID })
    expect(comments).toHaveLength(2)
    expect(history.map((entry) => [entry.fromStatus, entry.toStatus])).toEqual([
      ["open", "resolved"],
      ["resolved", "reopened"],
    ])
    expect(audit.filter((entry) => entry.action === "status_change")).toHaveLength(2)
  })
})

describe("corrección de lectura de medidor", () => {
  // Serie propia para no interferir con el caso de proveedor de arriba.
  const METER_VEHICLE_ID = "far-meter-vehicle"
  const FIRST_LOAD_ID = "far-meter-load-1"
  const SECOND_LOAD_ID = "far-meter-load-2"
  const METER_RULE_ID = "far-meter-rule"

  beforeAll(async () => {
    await inMemoryDb.insert(schema.fuelVehicles).values({
      id: METER_VEHICLE_ID, plate: "FAR-002", type: "camion", equipmentTypeId: EQUIPMENT_TYPE_ID,
      worksiteId: WORKSITE_ID, meterType: "odometer", isActive: true,
    })
    await inMemoryDb.insert(schema.fuelLoads).values([
      {
        id: FIRST_LOAD_ID, loadDate: "2026-07-01", month: "2026-07", serviceType: "TCT",
        vehicleId: METER_VEHICLE_ID, fuelSupplierId: USUAL_SUPPLIER_ID, worksiteId: WORKSITE_ID,
        product: "PETROLEO DIESEL", productId: PRODUCT_ID, liters: 100, odometerReading: 720_325,
        baseAmount: 1_000, iecFixed: 0, iecVariable: 0, iecTotal: 0, ivaAmount: 190, totalAmount: 1_190,
        status: "registered", createdBy: ACTOR_ID,
      },
      {
        // El dígito perdido: 72.000 donde debía decir 720.900.
        id: SECOND_LOAD_ID, loadDate: "2026-07-10", month: "2026-07", serviceType: "TCT",
        vehicleId: METER_VEHICLE_ID, fuelSupplierId: USUAL_SUPPLIER_ID, worksiteId: WORKSITE_ID,
        product: "PETROLEO DIESEL", productId: PRODUCT_ID, liters: 100, odometerReading: 72_000,
        baseAmount: 1_000, iecFixed: 0, iecVariable: 0, iecTotal: 0, ivaAmount: 190, totalAmount: 1_190,
        status: "registered", createdBy: ACTOR_ID,
      },
    ])
    await inMemoryDb.insert(schema.fuelAnomalyRules).values({
      id: METER_RULE_ID, code: "kilometraje_regresivo", name: "Kilometraje regresivo",
      severity: "high", isActive: true, config: "{}",
    })
  })

  it("la última lectura conocida sale de la carga anterior del equipo", async () => {
    const known = await lastKnownMeterReading(inMemoryDb as never, METER_VEHICLE_ID, "odometer", { before: "2026-07-10", excludeLoadId: SECOND_LOAD_ID })
    expect(known).toEqual({ value: 720_325, on: "2026-07-01" })
  })

  it("rechaza en la captura una lectura menor que la conocida", async () => {
    const errors = await meterReadingFieldErrors(inMemoryDb as never, {
      vehicleId: METER_VEHICLE_ID, loadDate: "2026-07-10", odometerReading: 72_000,
    }, { excludeLoadId: SECOND_LOAD_ID })
    expect(errors?.odometerReading?.[0]).toContain("menor que la última registrada")
  })

  it("acepta la lectura corregida y la que avanza", async () => {
    await expect(meterReadingFieldErrors(inMemoryDb as never, {
      vehicleId: METER_VEHICLE_ID, loadDate: "2026-07-10", odometerReading: 720_900,
    }, { excludeLoadId: SECOND_LOAD_ID })).resolves.toBeNull()
  })

  it("cierra el caso como lectura corregida —no como reset— al arreglar el número", async () => {
    await inMemoryDb.insert(schema.fuelAnomalyCases).values({
      id: "far-meter-case", ruleId: METER_RULE_ID, ruleCode: "kilometraje_regresivo", severity: "high",
      worksiteId: WORKSITE_ID, vehicleId: METER_VEHICLE_ID,
      referenceEntityType: "fuel_load", referenceEntityId: SECOND_LOAD_ID,
      description: "Lectura de odómetro (72000) menor que la carga anterior (720325).", status: "open",
    })

    // Con la lectura todavía mala el caso sigue abierto.
    await expect(resolveCorrectedMeterCases(SECOND_LOAD_ID, ACTOR_ID)).resolves.toEqual({ resolved: 0, reopened: 0 })

    await inMemoryDb.update(schema.fuelLoads).set({ odometerReading: 720_900 }).where(eq(schema.fuelLoads.id, SECOND_LOAD_ID))
    await expect(resolveCorrectedMeterCases(SECOND_LOAD_ID, ACTOR_ID)).resolves.toEqual({ resolved: 1, reopened: 0 })

    const [closed] = await inMemoryDb.select().from(schema.fuelAnomalyCases).where(eq(schema.fuelAnomalyCases.id, "far-meter-case"))
    expect(closed!.status).toBe("resolved")
    // La diferencia que importa: `reset_medidor` cortaría la serie del equipo en
    // Flota y Mantenciones; una corrección de tipeo no debe hacerlo.
    expect(closed!.resolutionKind).toBe("lectura_corregida")
  })

  it("reabre el caso cerrado si la carga se vuelve a editar con la lectura mala", async () => {
    // `createAnomalyCase` deduplica en cualquier estado, así que sin esta rama la
    // carga quedaba sin vigilancia para siempre tras el primer cierre.
    await inMemoryDb.update(schema.fuelLoads).set({ odometerReading: 71_000 }).where(eq(schema.fuelLoads.id, SECOND_LOAD_ID))
    await expect(resolveCorrectedMeterCases(SECOND_LOAD_ID, ACTOR_ID)).resolves.toEqual({ resolved: 0, reopened: 1 })

    const [reopened] = await inMemoryDb.select().from(schema.fuelAnomalyCases).where(eq(schema.fuelAnomalyCases.id, "far-meter-case"))
    expect(reopened!.status).toBe("reopened")
    expect(reopened!.resolutionKind).toBeNull()
  })

  it("no reabre un caso cerrado como reset de medidor: eso fue un hecho físico", async () => {
    await inMemoryDb.update(schema.fuelAnomalyCases)
      .set({ status: "dismissed", resolutionKind: "reset_medidor", resolvedById: ACTOR_ID })
      .where(eq(schema.fuelAnomalyCases.id, "far-meter-case"))

    await expect(resolveCorrectedMeterCases(SECOND_LOAD_ID, ACTOR_ID)).resolves.toEqual({ resolved: 0, reopened: 0 })
    const [untouched] = await inMemoryDb.select().from(schema.fuelAnomalyCases).where(eq(schema.fuelAnomalyCases.id, "far-meter-case"))
    expect(untouched!.status).toBe("dismissed")
  })
})
