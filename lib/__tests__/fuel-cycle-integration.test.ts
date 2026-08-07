import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { migratePGlite } from "@/lib/testing/pglite-migrate"
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest"
import path from "node:path"
import type { Session } from "next-auth"
import * as schema from "@/db/schema"
import { nanoid } from "@/lib/id"

// ── In-memory PostgreSQL database & migrations ────────────────────────────
const pg = new PGlite()
const inMemoryDb = drizzle(pg, { schema })
const testGlobal = globalThis as typeof globalThis & { __db?: typeof inMemoryDb }
// @ts-expect-error — PGlite is structurally compatible at runtime; postgres-js type differs only in result-type HKT
testGlobal.__db = inMemoryDb

vi.mock("@/db", () => ({
  get db() {
    return testGlobal.__db
  },
}))

await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))

const { getFuelCycleComparison, getFuelStorageBalances } = await import("@/lib/combustibles/fuel-cycle")

/**
 * Prueba de integración PostgreSQL del read model del ciclo físico (sección 1,
 * criterio de salida). Las pruebas unitarias existentes cubren las fórmulas de
 * diferencia en aislado; ésta ejercita las tres fuentes reales (movimientos,
 * cargas TAE, cargas facturadas) contra Postgres, incluyendo el alcance de
 * faena que sólo SQL puede validar.
 */
function globalSession(): Session {
  return {
    user: { id: "user-1", name: "Test", email: "test@example.com", roles: ["administrador"], permissions: [], worksiteIds: [], primaryWorksiteId: null, avatarColor: null, isActive: true },
    expires: "2099-01-01T00:00:00.000Z",
  }
}

function scopedSession(worksiteIds: string[]): Session {
  return {
    user: { id: "user-2", name: "Scoped", email: "scoped@example.com", roles: ["solicitante_faena"], permissions: [], worksiteIds, primaryWorksiteId: worksiteIds[0] ?? null, avatarColor: null, isActive: true },
    expires: "2099-01-01T00:00:00.000Z",
  }
}

describe("fuel cycle read model (PostgreSQL integration)", () => {
  const worksiteA = nanoid()
  const worksiteB = nanoid()
  const worksiteC = nanoid()
  const productId = nanoid()
  const supplierId = nanoid()
  const equipmentTypeId = nanoid()
  const vehicleId = nanoid()
  const userId = nanoid()
  const storageId = nanoid()
  const loadingPointId = nanoid()
  const from = "2026-06-01T00:00:00.000Z"
  const to = "2026-06-30T23:59:59.999Z"

  beforeAll(async () => {
    const now = new Date().toISOString()
    await inMemoryDb.insert(schema.worksites).values([
      { id: worksiteA, name: "Faena A", code: `FA-${nanoid().slice(0, 8)}`, isActive: true },
      { id: worksiteB, name: "Faena B", code: `FB-${nanoid().slice(0, 8)}`, isActive: true },
      { id: worksiteC, name: "Faena C", code: `FC-${nanoid().slice(0, 8)}`, isActive: true },
    ])
    await inMemoryDb.insert(schema.users).values({ id: userId, name: "Importador", email: `import-${nanoid()}@example.com`, hashedPassword: "x", isActive: true })
    await inMemoryDb.insert(schema.fuelProducts).values({ id: productId, code: `DIESEL-${nanoid().slice(0, 6)}`, name: "Diésel", category: "diesel", unit: "liter" })
    await inMemoryDb.insert(schema.fuelSuppliers).values({ id: supplierId, name: "Copec" })
    await inMemoryDb.insert(schema.fuelEquipmentTypes).values({ id: equipmentTypeId, slug: `camion-${nanoid().slice(0, 6)}`, name: "Camión" })
    await inMemoryDb.insert(schema.fuelVehicles).values({ id: vehicleId, plate: `AA${nanoid().slice(0, 4).toUpperCase()}`, type: "camion", equipmentTypeId, worksiteId: worksiteA, isActive: true })
    await inMemoryDb.insert(schema.fuelStorageLocations).values({ id: storageId, worksiteId: worksiteA, productId, name: "Camión estanque 1", capacityLiters: 1000, isActive: true })
    await inMemoryDb.insert(schema.fuelTaeLoadingPoints).values({ id: loadingPointId, worksiteId: worksiteA, storageLocationId: storageId, name: "Punto 1", type: "truck_dispenser" })

    // Recibido: 100 L de Copec hacia la vasija.
    await inMemoryDb.insert(schema.fuelCycleMovements).values({
      id: nanoid(), eventType: "received", worksiteId: worksiteA, productId, quantity: 100,
      occurredAt: "2026-06-05T12:00:00.000Z", supplierId, targetLocationId: storageId, createdBy: userId,
    })
    // Entregado vía PWA: 30 L desde la vasija (cuenta en delivered y en el saldo).
    await inMemoryDb.insert(schema.fuelTaeSubmissions).values({
      id: nanoid(), clientSubmissionId: nanoid(), source: "public_pwa", publicResultToken: nanoid(32),
      worksiteId: worksiteA, loadingPointId, vehicleId, productId, equipmentCodeSnapshot: "KA-1",
      loadedAt: "2026-06-06T12:00:00.000Z", submittedAt: "2026-06-06T12:00:00.000Z",
      driverNameSnapshot: "Conductor", supervisorNameSnapshot: "Supervisor", meterType: "odometer",
      liters: 30, status: "submitted",
    })
    // Entregado vía PWA pero ANULADA: no debe contar ni en delivered ni en el saldo.
    await inMemoryDb.insert(schema.fuelTaeSubmissions).values({
      id: nanoid(), clientSubmissionId: nanoid(), source: "public_pwa", publicResultToken: nanoid(32),
      worksiteId: worksiteA, loadingPointId, vehicleId, productId, equipmentCodeSnapshot: "KA-1",
      loadedAt: "2026-06-07T12:00:00.000Z", submittedAt: "2026-06-07T12:00:00.000Z",
      driverNameSnapshot: "Conductor", supervisorNameSnapshot: "Supervisor", meterType: "odometer",
      liters: 999, status: "voided",
    })
    // Entregado vía ledger manual: 10 L adicionales desde la misma vasija.
    await inMemoryDb.insert(schema.fuelCycleMovements).values({
      id: nanoid(), eventType: "tank_delivery", worksiteId: worksiteA, productId, quantity: 10,
      occurredAt: "2026-06-08T12:00:00.000Z", sourceLocationId: storageId, vehicleId, createdBy: userId,
    })
    // Registrado: 100 L facturados en el mismo período/faena/producto.
    await inMemoryDb.insert(schema.fuelLoads).values({
      id: nanoid(), loadDate: "2026-06-10", month: "2026-06", serviceType: "TCT", vehicleId,
      fuelSupplierId: supplierId, worksiteId: worksiteA, product: "PETROLEO DIESEL", productId,
      liters: 100, baseAmount: 100000, totalAmount: 119000, status: "registered", createdBy: userId,
    })
    // Ruido en otra faena: no debe filtrarse en los resultados de A ni en el alcance restringido.
    const storageB = nanoid()
    await inMemoryDb.insert(schema.fuelStorageLocations).values({ id: storageB, worksiteId: worksiteB, productId, name: "Vasija B", isActive: true })
    await inMemoryDb.insert(schema.fuelCycleMovements).values({
      id: nanoid(), eventType: "received", worksiteId: worksiteB, productId, quantity: 500,
      occurredAt: "2026-06-05T12:00:00.000Z", supplierId, targetLocationId: storageB, createdBy: userId,
    })
    // Borde nocturno: recepción a las 21:30 del 30-06 en Chile (= 01:30 UTC del
    // 01-07). Su factura queda con loadDate "2026-06-30" (día calendario
    // chileno); si la ventana se compara contra instantes UTC, el movimiento se
    // cae de junio y la pantalla inventa −20.000 L en junio y +20.000 en julio.
    const storageC = nanoid()
    await inMemoryDb.insert(schema.fuelStorageLocations).values({ id: storageC, worksiteId: worksiteC, productId, name: "Vasija C", isActive: true })
    await inMemoryDb.insert(schema.fuelCycleMovements).values({
      id: nanoid(), eventType: "received", worksiteId: worksiteC, productId, quantity: 20000,
      occurredAt: "2026-07-01T01:30:00.000Z", supplierId, targetLocationId: storageC, createdBy: userId,
    })
    await inMemoryDb.insert(schema.fuelLoads).values({
      id: nanoid(), loadDate: "2026-06-30", month: "2026-06", serviceType: "TAE", vehicleId,
      fuelSupplierId: supplierId, worksiteId: worksiteC, product: "PETROLEO DIESEL", productId,
      liters: 20000, baseAmount: 100000, totalAmount: 119000, status: "registered", createdBy: userId,
    })
    void now
  })

  afterAll(async () => {
    await pg.close()
  })

  it("cuadra recibido, entregado y registrado desde las tres fuentes reales", async () => {
    const result = await getFuelCycleComparison(globalSession(), { worksiteId: worksiteA, from, to })

    expect(result.received).toEqual({ liters: 100, records: 1 })
    // 30 L PWA (submitted) + 10 L ledger manual; la anulada (999 L) queda excluida.
    expect(result.delivered).toEqual({ liters: 40, records: 2 })
    expect(result.registered).toEqual({ liters: 100, records: 1 })
    expect(result.differences.receivedVsRegistered).toEqual({ status: "available", absolute: 0, percent: 0 })
    expect(result.differences.receivedVsDelivered).toEqual({ status: "available", absolute: 60, percent: 150 })
  })

  it("no filtra por faena cuando el rol es global, pero sí cuando el alcance está restringido", async () => {
    const scoped = await getFuelCycleComparison(scopedSession([worksiteB]), { worksiteId: worksiteA, from, to })
    expect(scoped.received).toBeNull()

    const scopedOwnWorksite = await getFuelCycleComparison(scopedSession([worksiteA]), { worksiteId: worksiteA, from, to })
    expect(scopedOwnWorksite.received).toEqual({ liters: 100, records: 1 })
  })

  it("calcula el saldo por vasija como recibido menos entregado", async () => {
    const [balance] = await getFuelStorageBalances(globalSession(), { worksiteId: worksiteA, from, to })

    expect(balance).toMatchObject({
      storageLocationId: storageId,
      receivedLiters: 100,
      deliveredLiters: 40,
      balanceLiters: 60,
      capacityLiters: 1000,
    })
  })

  it("cuenta la recepción nocturna del último día en el mes chileno, igual que su factura", async () => {
    const result = await getFuelCycleComparison(globalSession(), { worksiteId: worksiteC, from, to })

    expect(result.received).toEqual({ liters: 20000, records: 1 })
    expect(result.registered).toEqual({ liters: 20000, records: 1 })
    expect(result.differences.receivedVsRegistered).toEqual({ status: "available", absolute: 0, percent: 0 })

    // Y no reaparece en julio.
    const july = await getFuelCycleComparison(globalSession(), { worksiteId: worksiteC, from: "2026-07-01T00:00:00.000Z", to: "2026-07-31T23:59:59.999Z" })
    expect(july.received).toBeNull()
  })

  it("muestra 'sin fuente disponible' cuando falta la etapa registrada", async () => {
    const result = await getFuelCycleComparison(globalSession(), { worksiteId: worksiteA, productId, from: "2020-01-01T00:00:00.000Z", to: "2020-01-31T23:59:59.999Z" })

    expect(result.received).toBeNull()
    expect(result.differences.receivedVsRegistered).toEqual({ status: "unavailable", absolute: null, percent: null })
  })
})
