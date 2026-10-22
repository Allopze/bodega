import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { migratePGlite } from "@/lib/testing/pglite-migrate"
import { describe, it, expect, beforeAll, vi } from "vitest"
import path from "node:path"
import * as schema from "@/db/schema"
import { nanoid } from "@/lib/id"

// ── In-memory PostgreSQL database & migrations ────────────────────────────
const pg = new PGlite()
const inMemoryDb = drizzle(pg, { schema })
const testGlobal = globalThis as typeof globalThis & { __db?: typeof inMemoryDb }
// @ts-expect-error — PGlite es estructuralmente compatible en runtime; postgres-js difiere sólo en el tipo HKT del resultado.
testGlobal.__db = inMemoryDb

vi.mock("@/db", () => ({
  get db() {
    return testGlobal.__db
  },
}))

await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))

const { syncAnomalyRuleCatalog, getAnomalyCases } = await import("@/lib/combustibles/anomaly-cases")

/** Rol global: estas pruebas verifican la detección, no el alcance por faena. */
const TEST_SESSION = { user: { id: "test-user", isGlobal: true, worksiteIds: [] } } as unknown as import("next-auth").Session
const { runAllBatchRules } = await import("@/lib/combustibles/anomaly-detector")

/**
 * Reglas batch de rendimiento y consumo del motor de anomalías (separadas de
 * `anomaly-detection-integration.test.ts`, que cubre la detección inline al
 * revisar una carga TAE). Cada `describe` siembra sus propios datos.
 */
beforeAll(async () => {
  await syncAnomalyRuleCatalog()
})

describe("rendimiento_fuera_historico (batch — performance outlier vs history)", () => {
  const wsId = nanoid()
  const eqTypeId = nanoid()
  const vehId = nanoid()
  const batchId = nanoid()
  const testUserId = nanoid()

  beforeAll(async () => {
    await inMemoryDb.insert(schema.worksites).values({
      id: wsId, name: "Faena rendimiento histórico", code: `RH-${nanoid().slice(0, 6)}`, isActive: true,
    })
    await inMemoryDb.insert(schema.users).values({
      id: testUserId, name: "Test rendimiento", email: `rh-${nanoid()}@example.com`, hashedPassword: "x", isActive: true,
    })
    await inMemoryDb.insert(schema.fuelEquipmentTypes).values({
      id: eqTypeId, slug: `perf-camion-${nanoid().slice(0, 6)}`, name: "Camión rendimiento",
    })
    await inMemoryDb.insert(schema.fuelVehicles).values({
      id: vehId, plate: `PERF${nanoid().slice(0, 4).toUpperCase()}`, type: "camion",
      equipmentTypeId: eqTypeId, worksiteId: wsId, isActive: true,
      performanceUnit: "km_per_liter",
    })
    await inMemoryDb.insert(schema.fuelOperationBatches).values({
      id: batchId, archivoNombre: "perf.xlsx", hashArchivo: nanoid(), estado: "importado",
      periodoDesde: "2026-06-01", periodoHasta: "2026-06-30",
      importadoPor: testUserId,
    })
  })

  it("crea un caso cuando el rendimiento de un equipo se desvía más de N stddevs de su propio historial", async () => {
    // Insertar 7 registros con rendimiento ~10, y un octavo con rendimiento 30 (outlier claro a ~6 stddevs)
    const records = Array.from({ length: 7 }, (_, i) => ({
      id: nanoid(), batchId, worksiteId: wsId, vehicleId: vehId,
      plate: `PERF_TEST`, fecha: `2026-06-${String(i + 1).padStart(2, "0")}`,
      liters: 10, monto: 100, rendimiento: 10 + Math.random(),
    }))
    records.push({
      id: nanoid(), batchId, worksiteId: wsId, vehicleId: vehId,
      plate: `PERF_TEST`, fecha: "2026-06-10",
      liters: 10, monto: 100, rendimiento: 30,
    })
    await inMemoryDb.insert(schema.fuelOperationRecords).values(records)

    await runAllBatchRules()

    const { cases } = await getAnomalyCases({ ruleCode: "rendimiento_fuera_historico" }, TEST_SESSION)
    expect(cases.length).toBeGreaterThan(0)
  })
})

describe("rendimiento_fuera_grupo (batch — performance outlier vs group)", () => {
  const wsId = nanoid()
  const eqTypeId = nanoid()
  const veh1Id = nanoid()
  const veh2Id = nanoid()
  const batchId = nanoid()
  const testUserId = nanoid()

  beforeAll(async () => {
    await inMemoryDb.insert(schema.worksites).values({
      id: wsId, name: "Faena rendimiento grupo", code: `RG-${nanoid().slice(0, 6)}`, isActive: true,
    })
    await inMemoryDb.insert(schema.users).values({
      id: testUserId, name: "Test grupo", email: `rg-${nanoid()}@example.com`, hashedPassword: "x", isActive: true,
    })
    await inMemoryDb.insert(schema.fuelEquipmentTypes).values({
      id: eqTypeId, slug: `grupo-camion-${nanoid().slice(0, 6)}`, name: "Camión grupo",
    })
    await inMemoryDb.insert(schema.fuelVehicles).values([
      { id: veh1Id, plate: `GRP1${nanoid().slice(0, 4).toUpperCase()}`, type: "camion",
        equipmentTypeId: eqTypeId, worksiteId: wsId, isActive: true,
        performanceUnit: "km_per_liter", comparisonGroup: "camiones_pesados" },
      { id: veh2Id, plate: `GRP2${nanoid().slice(0, 4).toUpperCase()}`, type: "camion",
        equipmentTypeId: eqTypeId, worksiteId: wsId, isActive: true,
        performanceUnit: "km_per_liter", comparisonGroup: "camiones_pesados" },
    ])
    await inMemoryDb.insert(schema.fuelOperationBatches).values({
      id: batchId, archivoNombre: "grupo.xlsx", hashArchivo: nanoid(), estado: "importado",
      periodoDesde: "2026-06-01", periodoHasta: "2026-06-30",
      importadoPor: testUserId,
    })
  })

  it("crea un caso cuando un equipo dentro del grupo tiene rendimiento atípico", async () => {
    // veh1: 5 registros con rendimiento ~10
    const veh1Records = Array.from({ length: 5 }, (_, i) => ({
      id: nanoid(), batchId, worksiteId: wsId, vehicleId: veh1Id,
      plate: `GRP1`, fecha: `2026-06-${String(i + 1).padStart(2, "0")}`,
      liters: 10, monto: 100, rendimiento: 10 + Math.random(),
    }))
    // veh2: 5 registros con rendimiento ~10 también
    const veh2Records = Array.from({ length: 5 }, (_, i) => ({
      id: nanoid(), batchId, worksiteId: wsId, vehicleId: veh2Id,
      plate: `GRP2`, fecha: `2026-06-${String(i + 1).padStart(2, "0")}`,
      liters: 10, monto: 100, rendimiento: 10 + Math.random(),
    }))
    // veh2: un sexto registro outlier (rendimiento 35)
    veh2Records.push({
      id: nanoid(), batchId, worksiteId: wsId, vehicleId: veh2Id,
      plate: `GRP2`, fecha: "2026-06-15",
      liters: 10, monto: 100, rendimiento: 35,
    })
    await inMemoryDb.insert(schema.fuelOperationRecords).values([...veh1Records, ...veh2Records])

    await runAllBatchRules()

    const { cases } = await getAnomalyCases({ ruleCode: "rendimiento_fuera_grupo" }, TEST_SESSION)
    expect(cases.length).toBeGreaterThan(0)
  })
})

describe("proveedor_no_habitual (batch — supplier mismatch)", () => {
  const wsId = nanoid()
  const eqTypeId = nanoid()
  const vehId = nanoid()
  const supplierUsual = nanoid()
  const supplierOther = nanoid()
  const testUserId = nanoid()

  beforeAll(async () => {
    await inMemoryDb.insert(schema.worksites).values({
      id: wsId, name: "Faena proveedores", code: `FP-${nanoid().slice(0, 6)}`, isActive: true,
    })
    await inMemoryDb.insert(schema.fuelEquipmentTypes).values({
      id: eqTypeId, slug: `prov-camion-${nanoid().slice(0, 6)}`, name: "Camión proveedor",
    })
    await inMemoryDb.insert(schema.users).values({
      id: testUserId, name: "Creador", email: `creator-${nanoid()}@example.com`, hashedPassword: "x", isActive: true,
    })
    await inMemoryDb.insert(schema.fuelSuppliers).values([
      { id: supplierUsual, name: "Proveedor habitual" },
      { id: supplierOther, name: "Otro proveedor" },
    ])
    await inMemoryDb.insert(schema.fuelVehicles).values({
      id: vehId, plate: `PROV${nanoid().slice(0, 4).toUpperCase()}`, type: "camion",
      equipmentTypeId: eqTypeId, worksiteId: wsId, isActive: true,
      usualFuelSupplierId: supplierUsual,
    })
  })

  it("crea un caso cuando la carga se factura con un proveedor distinto del habitual del equipo", async () => {
    const productId = nanoid()
    await inMemoryDb.insert(schema.fuelProducts).values({
      id: productId, code: `DP-${nanoid().slice(0, 6)}`, name: "Diésel", category: "diesel", unit: "liter",
    })
    await inMemoryDb.insert(schema.fuelLoads).values({
      id: nanoid(), loadDate: "2026-06-15", month: "2026-06",
      serviceType: "TCT", vehicleId: vehId,
      fuelSupplierId: supplierOther, // distinto del habitual
      worksiteId: wsId, product: "PETROLEO DIESEL", productId,
      liters: 50, baseAmount: 25000, totalAmount: 29750,
      createdBy: testUserId,
    })

    await runAllBatchRules()

    const { cases } = await getAnomalyCases({ ruleCode: "proveedor_no_habitual" }, TEST_SESSION)
    expect(cases.length).toBeGreaterThan(0)
  })
})

describe("consumo_durante_inactividad (batch — consumption while inactive)", () => {
  const wsId = nanoid()
  const eqTypeId = nanoid()
  const vehId = nanoid()
  const productId = nanoid()

  beforeAll(async () => {
    await inMemoryDb.insert(schema.worksites).values({
      id: wsId, name: "Faena inactividad", code: `FI-${nanoid().slice(0, 6)}`, isActive: true,
    })
    await inMemoryDb.insert(schema.fuelProducts).values({
      id: productId, code: `DIESEL-IN-${nanoid().slice(0, 6)}`, name: "Diésel inactividad", category: "diesel", unit: "liter",
    })
    await inMemoryDb.insert(schema.fuelEquipmentTypes).values({
      id: eqTypeId, slug: `inact-camion-${nanoid().slice(0, 6)}`, name: "Camión inactividad",
    })
    await inMemoryDb.insert(schema.fuelVehicles).values({
      id: vehId, plate: `INACT${nanoid().slice(0, 4).toUpperCase()}`, type: "camion",
      equipmentTypeId: eqTypeId, worksiteId: wsId, isActive: true,
      operationalStatus: "mantencion", // not "operativo" → inactivo
    })
    // El detector acota la ventana al intervalo de inactividad VIGENTE: sin
    // este intervalo abierto (el que crea la app real en cada cambio de
    // estado, vía actions-module/vehicles.ts) no tiene desde-cuándo confiable
    // y se salta el vehículo a propósito.
    await inMemoryDb.insert(schema.fuelVehicleOperationalIntervals).values({
      id: nanoid(), vehicleId: vehId, status: "mantencion",
      startedAt: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
      reason: "Fixture de prueba",
    })
  })

  it("crea un caso cuando un equipo inactivo tiene cargas registradas después de volverse inactivo", async () => {
    await inMemoryDb.insert(schema.fuelTaeSubmissions).values({
      id: nanoid(), clientSubmissionId: nanoid(), source: "public_pwa",
      publicResultToken: nanoid(32),
      worksiteId: wsId, vehicleId: vehId, productId,
      equipmentCodeSnapshot: "INACT",
      loadedAt: new Date().toISOString(), submittedAt: new Date().toISOString(),
      driverNameSnapshot: "Conductor", supervisorNameSnapshot: "Supervisor",
      manualIdentity: false, meterType: "odometer", liters: 10,
      status: "validated",
    })

    await runAllBatchRules()

    const { cases } = await getAnomalyCases({ ruleCode: "consumo_durante_inactividad" }, TEST_SESSION)
    expect(cases.length).toBeGreaterThan(0)
  })

  it("NO crea caso si la carga es anterior al intervalo de inactividad vigente", async () => {
    const vehId2 = nanoid()
    await inMemoryDb.insert(schema.fuelVehicles).values({
      id: vehId2, plate: `OLDIN${nanoid().slice(0, 4).toUpperCase()}`, type: "camion",
      equipmentTypeId: eqTypeId, worksiteId: wsId, isActive: true,
      operationalStatus: "fuera_servicio",
    })
    await inMemoryDb.insert(schema.fuelVehicleOperationalIntervals).values({
      id: nanoid(), vehicleId: vehId2, status: "fuera_servicio",
      startedAt: new Date().toISOString(),
    })
    // Carga de cuando el equipo SÍ operaba, mucho antes del intervalo actual.
    await inMemoryDb.insert(schema.fuelTaeSubmissions).values({
      id: nanoid(), clientSubmissionId: nanoid(), source: "public_pwa",
      publicResultToken: nanoid(32),
      worksiteId: wsId, vehicleId: vehId2, productId,
      equipmentCodeSnapshot: "OLDIN",
      loadedAt: new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString(),
      submittedAt: new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString(),
      driverNameSnapshot: "Conductor", supervisorNameSnapshot: "Supervisor",
      manualIdentity: false, meterType: "odometer", liters: 10,
      status: "validated",
    })

    await runAllBatchRules()

    const { cases } = await getAnomalyCases({ ruleCode: "consumo_durante_inactividad" }, TEST_SESSION)
    expect(cases.some((c) => c.vehicleId === vehId2)).toBe(false)
  })
})

describe("variacion_brusca_consumo (batch — sharp consumption change)", () => {
  const wsId = nanoid()
  const eqTypeId = nanoid()
  const vehId = nanoid()
  const importBatchId = nanoid()
  const testUserId = nanoid()

  beforeAll(async () => {
    await inMemoryDb.insert(schema.worksites).values({
      id: wsId, name: "Faena variación", code: `FV-${nanoid().slice(0, 6)}`, isActive: true,
    })
    await inMemoryDb.insert(schema.users).values({
      id: testUserId, name: "Test variación", email: `fv-${nanoid()}@example.com`, hashedPassword: "x", isActive: true,
    })
    await inMemoryDb.insert(schema.fuelEquipmentTypes).values({
      id: eqTypeId, slug: `var-camion-${nanoid().slice(0, 6)}`, name: "Camión variación",
    })
    await inMemoryDb.insert(schema.fuelVehicles).values({
      id: vehId, plate: `VAR${nanoid().slice(0, 4).toUpperCase()}`, type: "camion",
      equipmentTypeId: eqTypeId, worksiteId: wsId, isActive: true,
    })
    await inMemoryDb.insert(schema.fuelImportBatches).values({
      id: importBatchId, worksiteId: wsId, fuente: "Copec", archivoNombre: "variacion.xlsx", hashArchivo: nanoid(),
      estado: "importado", periodoDesde: "2026-06-01", periodoHasta: "2026-07-30",
      importadoPor: testUserId,
    })
  })

  it("crea un caso cuando el consumo de un equipo varía más del umbral entre períodos consecutivos", async () => {
    // Dos períodos consecutivos para el mismo vehículo: 100L → 250L = 150% de cambio, supera umbral 50%
    await inMemoryDb.insert(schema.fuelConsumptionRecords).values([
      {
        id: nanoid(), batchId: importBatchId, worksiteId: wsId, vehicleId: vehId,
        patente: `VAR`, cantidadUnidad: 100, monto: 50000,
        numeroTransacciones: 2, numeroTarjetas: 1,
        periodoDesde: "2026-06-01", periodoHasta: "2026-06-30",
        rendimientoPromedio: 10,
      },
      {
        id: nanoid(), batchId: importBatchId, worksiteId: wsId, vehicleId: vehId,
        patente: `VAR`, cantidadUnidad: 250, monto: 125000,
        numeroTransacciones: 4, numeroTarjetas: 1,
        periodoDesde: "2026-07-01", periodoHasta: "2026-07-31",
        rendimientoPromedio: 10,
      },
    ])

    await runAllBatchRules()

    const { cases } = await getAnomalyCases({ ruleCode: "variacion_brusca_consumo" }, TEST_SESSION)
    expect(cases.length).toBeGreaterThan(0)
  })
})

describe("kilometraje_regresivo / horometro_regresivo (batch — más allá de TAE)", () => {
  // `detectTaeAnomaliesInTx` (fuel-tae.ts) sólo compara cargas TAE contra
  // otras cargas TAE; estos detectores batch cubren el log operacional
  // (fuel_operation_records) y las cargas manuales (fuel_loads) — CO-023.
  const wsId = nanoid()
  const eqTypeId = nanoid()
  const vehOpId = nanoid()
  const vehLoadId = nanoid()
  const supplierId = nanoid()
  const productId = nanoid()
  const testUserId = nanoid()
  const opBatchId = nanoid()

  beforeAll(async () => {
    await inMemoryDb.insert(schema.worksites).values({
      id: wsId, name: "Faena regresiva", code: `FR-${nanoid().slice(0, 6)}`, isActive: true,
    })
    await inMemoryDb.insert(schema.users).values({
      id: testUserId, name: "Test regresiva", email: `fr-${nanoid()}@example.com`, hashedPassword: "x", isActive: true,
    })
    await inMemoryDb.insert(schema.fuelEquipmentTypes).values({
      id: eqTypeId, slug: `reg-camion-${nanoid().slice(0, 6)}`, name: "Camión regresiva",
    })
    await inMemoryDb.insert(schema.fuelVehicles).values([
      { id: vehOpId, plate: `ROP${nanoid().slice(0, 4).toUpperCase()}`, type: "camion", equipmentTypeId: eqTypeId, worksiteId: wsId, isActive: true },
      { id: vehLoadId, plate: `RLD${nanoid().slice(0, 4).toUpperCase()}`, type: "camion", equipmentTypeId: eqTypeId, worksiteId: wsId, isActive: true },
    ])
    await inMemoryDb.insert(schema.fuelSuppliers).values({ id: supplierId, name: "Proveedor regresiva" })
    await inMemoryDb.insert(schema.fuelProducts).values({
      id: productId, code: `DIESEL-REG-${nanoid().slice(0, 6)}`, name: "Diésel regresiva", category: "diesel", unit: "liter",
    })
    await inMemoryDb.insert(schema.fuelOperationBatches).values({
      id: opBatchId, archivoNombre: "regresiva.xlsx", hashArchivo: nanoid(),
      periodoDesde: "2026-06-01", periodoHasta: "2026-06-30", importadoPor: testUserId,
    })
  })

  it("crea un caso kilometraje_regresivo cuando el log operacional baja de una carga a la siguiente", async () => {
    await inMemoryDb.insert(schema.fuelOperationRecords).values([
      {
        id: nanoid(), batchId: opBatchId, worksiteId: wsId, vehicleId: vehOpId, plate: "ROP",
        fecha: "2026-06-01", horaCarga: "08:00", horometro: 10_000, medidoPor: "km", liters: 50,
      },
      {
        id: nanoid(), batchId: opBatchId, worksiteId: wsId, vehicleId: vehOpId, plate: "ROP",
        fecha: "2026-06-05", horaCarga: "08:00", horometro: 4_000, medidoPor: "km", liters: 50,
      },
    ])

    await runAllBatchRules()

    const { cases } = await getAnomalyCases({ ruleCode: "kilometraje_regresivo" }, TEST_SESSION)
    expect(cases.some((c) => c.referenceEntityType === "fuel_operation_record" && c.vehicleId === vehOpId)).toBe(true)
  })

  it("crea un caso horometro_regresivo cuando una carga manual baja respecto a la anterior", async () => {
    await inMemoryDb.insert(schema.fuelLoads).values([
      {
        id: nanoid(), loadDate: "2026-06-01", month: "2026-06", serviceType: "TCT", vehicleId: vehLoadId,
        fuelSupplierId: supplierId, worksiteId: wsId, product: "PETROLEO DIESEL", productId,
        liters: 50, baseAmount: 50_000, totalAmount: 50_000, status: "registered", createdBy: testUserId,
        hourMeterReading: 500,
      },
      {
        id: nanoid(), loadDate: "2026-06-10", month: "2026-06", serviceType: "TCT", vehicleId: vehLoadId,
        fuelSupplierId: supplierId, worksiteId: wsId, product: "PETROLEO DIESEL", productId,
        liters: 50, baseAmount: 50_000, totalAmount: 50_000, status: "registered", createdBy: testUserId,
        hourMeterReading: 200,
      },
    ])

    await runAllBatchRules()

    const { cases } = await getAnomalyCases({ ruleCode: "horometro_regresivo" }, TEST_SESSION)
    expect(cases.some((c) => c.referenceEntityType === "fuel_load" && c.vehicleId === vehLoadId)).toBe(true)
  })
})
