import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { migratePGlite } from "@/lib/testing/pglite-migrate"
import { describe, it, expect, beforeAll, vi } from "vitest"
import path from "node:path"
import type { Session } from "next-auth"
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

const { getFuelLogTotal, getFuelLogRows, getFuelLogRowsBySelection } = await import("@/lib/combustibles/fuel-log")

/**
 * Prueba de integración PostgreSQL del read model de la bitácora general
 * (sección 19, "Filtros y bitácora") — `fuel-log.ts` no tenía ninguna prueba.
 * Cubre combinación de filtros, alcance de faena, paginación, ordenamiento
 * y selección manual, contra las dos fuentes con datos reales (TAE y
 * facturación); el log operacional queda fuera por alcance — requeriría
 * además `fuel_operation_batches`, sin agregar cobertura nueva al mecanismo
 * (ya lo comparte con las otras dos ramas vía el mismo `unionAll`).
 */
function globalSession(): Session {
  return {
    user: { id: "user-1", name: "Global", email: "global@example.com", roles: ["administrador"], permissions: [], worksiteIds: [], primaryWorksiteId: null, avatarColor: null, isActive: true, isGlobal: true },
    expires: "2099-01-01T00:00:00.000Z",
  }
}

function scopedSession(worksiteIds: string[]): Session {
  return {
    user: { id: "user-2", name: "Scoped", email: "scoped@example.com", roles: ["solicitante_faena"], permissions: [], worksiteIds, primaryWorksiteId: worksiteIds[0] ?? null, avatarColor: null, isActive: true },
    expires: "2099-01-01T00:00:00.000Z",
  }
}

describe("fuel-log read model (PostgreSQL integration)", () => {
  const worksiteA = nanoid()
  const worksiteB = nanoid()
  const productId = nanoid()
  const supplierX = nanoid()
  const supplierY = nanoid()
  const equipmentTypeId = nanoid()
  const vehicleId = nanoid()
  const userId = nanoid()
  const taeEarly = nanoid()
  const taeLate = nanoid()
  const loadX = nanoid()
  const loadY = nanoid()
  const loadInB = nanoid()

  beforeAll(async () => {
    await inMemoryDb.insert(schema.worksites).values([
      { id: worksiteA, name: "Faena A", code: `FA-${nanoid().slice(0, 8)}`, isActive: true },
      { id: worksiteB, name: "Faena B", code: `FB-${nanoid().slice(0, 8)}`, isActive: true },
    ])
    await inMemoryDb.insert(schema.users).values({ id: userId, name: "Importador", email: `import-${nanoid()}@example.com`, hashedPassword: "x", isActive: true })
    await inMemoryDb.insert(schema.fuelProducts).values({ id: productId, code: `DIESEL-${nanoid().slice(0, 6)}`, name: "Diésel", category: "diesel", unit: "liter" })
    await inMemoryDb.insert(schema.fuelSuppliers).values([
      { id: supplierX, name: "Copec" },
      { id: supplierY, name: "Shell" },
    ])
    await inMemoryDb.insert(schema.fuelEquipmentTypes).values({ id: equipmentTypeId, slug: `camion-${nanoid().slice(0, 6)}`, name: "Camión" })
    await inMemoryDb.insert(schema.fuelVehicles).values({ id: vehicleId, plate: `CC${nanoid().slice(0, 4).toUpperCase()}`, type: "camion", equipmentTypeId, worksiteId: worksiteA, isActive: true })

    // 2 cargas TAE en faena A, en orden cronológico distinto.
    await inMemoryDb.insert(schema.fuelTaeSubmissions).values([
      {
        id: taeEarly, clientSubmissionId: nanoid(), source: "public_pwa", publicResultToken: nanoid(32),
        worksiteId: worksiteA, vehicleId, productId, equipmentCodeSnapshot: "CC-1",
        loadedAt: "2026-06-01T08:00:00.000Z", submittedAt: "2026-06-01T08:00:00.000Z",
        driverNameSnapshot: "Conductor 1", supervisorNameSnapshot: "Supervisor 1", meterType: "odometer",
        liters: 40, status: "submitted",
      },
      {
        id: taeLate, clientSubmissionId: nanoid(), source: "public_pwa", publicResultToken: nanoid(32),
        worksiteId: worksiteA, vehicleId, productId, equipmentCodeSnapshot: "CC-1",
        loadedAt: "2026-06-05T08:00:00.000Z", submittedAt: "2026-06-05T08:00:00.000Z",
        driverNameSnapshot: "Conductor 2", supervisorNameSnapshot: "Supervisor 2", meterType: "odometer",
        liters: 60, status: "submitted",
      },
    ])
    // 2 facturas en faena A con proveedores distintos, 1 factura en faena B.
    await inMemoryDb.insert(schema.fuelLoads).values([
      { id: loadX, loadDate: "2026-06-02", month: "2026-06", serviceType: "TCT", vehicleId, fuelSupplierId: supplierX, worksiteId: worksiteA, product: "PETROLEO DIESEL", productId, liters: 100, baseAmount: 1000, totalAmount: 1190, createdBy: userId },
      { id: loadY, loadDate: "2026-06-03", month: "2026-06", serviceType: "TCT", vehicleId, fuelSupplierId: supplierY, worksiteId: worksiteA, product: "PETROLEO DIESEL", productId, liters: 80, baseAmount: 800, totalAmount: 952, createdBy: userId },
      { id: loadInB, loadDate: "2026-06-04", month: "2026-06", serviceType: "TCT", vehicleId, fuelSupplierId: supplierX, worksiteId: worksiteB, product: "PETROLEO DIESEL", productId, liters: 50, baseAmount: 500, totalAmount: 595, createdBy: userId },
    ])
  })

  it("sin filtros, una sesión global ve las 5 filas de faena A + faena B (2 TAE + 3 facturas)", async () => {
    const total = await getFuelLogTotal(globalSession(), {})
    expect(total).toBe(5)
  })

  it("aplica el alcance de faena: una sesión acotada a A no ve la factura de B", async () => {
    const total = await getFuelLogTotal(scopedSession([worksiteA]), {})
    expect(total).toBe(4)
    const rows = await getFuelLogRows(scopedSession([worksiteA]), {}, { limit: 50, offset: 0, sort: "desc" })
    expect(rows.every((r) => r.worksiteName === "Faena A")).toBe(true)
  })

  it("combina el filtro de fuente con el de faena", async () => {
    const total = await getFuelLogTotal(globalSession(), { worksiteId: worksiteA, source: "tae_pwa" })
    expect(total).toBe(2)
  })

  it("filtra por proveedor exacto (sólo aplica a la rama de facturación)", async () => {
    const rows = await getFuelLogRows(globalSession(), { supplierId: supplierX }, { limit: 50, offset: 0, sort: "desc" })
    expect(rows).toHaveLength(2) // loadX (faena A) + loadInB (faena B)
    expect(rows.every((r) => r.supplierId === supplierX)).toBe(true)
  })

  it("pagina en servidor: limit=1 devuelve una sola fila sin importar el total", async () => {
    const rows = await getFuelLogRows(globalSession(), {}, { limit: 1, offset: 0, sort: "desc" })
    expect(rows).toHaveLength(1)
    const total = await getFuelLogTotal(globalSession(), {})
    expect(total).toBe(5)
  })

  it("ordena en servidor por fecha de ocurrencia, asc y desc", async () => {
    const desc = await getFuelLogRows(globalSession(), { worksiteId: worksiteA, source: "tae_pwa" }, { limit: 50, offset: 0, sort: "desc" })
    expect(desc[0]!.id).toBe(taeLate)
    const asc = await getFuelLogRows(globalSession(), { worksiteId: worksiteA, source: "tae_pwa" }, { limit: 50, offset: 0, sort: "asc" })
    expect(asc[0]!.id).toBe(taeEarly)
  })

  it("acciones masivas: getFuelLogRowsBySelection devuelve exactamente las filas seleccionadas, cruzando fuentes", async () => {
    const rows = await getFuelLogRowsBySelection(globalSession(), [
      { source: "tae_pwa", id: taeEarly },
      { source: "invoiced", id: loadY },
    ])
    expect(rows.map((r) => r.id).sort()).toEqual([loadY, taeEarly].sort())
  })
})
