import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { eq } from "drizzle-orm"
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest"
import { migratePGlite } from "@/lib/testing/pglite-migrate"
import * as schema from "@/db/schema"
import type { DB } from "@/db"

/**
 * Lo que la base garantiza por sí sola de `contract_vehicle_assignments` y del
 * contrato que la recibe. Lo demás (sin traslapes, faena coincidente) lo
 * sostiene el servicio y se prueba en `contract-assignments-pglite.test.ts`.
 */

const pg = new PGlite()
const testDb = drizzle(pg, { schema }) as unknown as DB
const testGlobal = globalThis as typeof globalThis & { __db?: DB }
testGlobal.__db = testDb
vi.mock("@/db", () => ({ get db() { return testGlobal.__db } }))

await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))

afterAll(async () => {
  delete testGlobal.__db
  await pg.close()
})

const { nextCodeTx } = await import("@/lib/code-sequences")

async function rejection(promise: Promise<unknown>): Promise<string> {
  try {
    await promise
  } catch (error) {
    const err = error as { message?: string; cause?: { message?: string; constraint?: string } }
    return [err.message, err.cause?.message, err.cause?.constraint].filter(Boolean).join(" | ")
  }
  throw new Error("se esperaba un rechazo")
}

const assign = (values: Partial<typeof schema.contractVehicleAssignments.$inferInsert> & { id: string }) =>
  testDb.insert(schema.contractVehicleAssignments).values({ contractId: "c-1", vehicleId: "v-1", validFrom: "2026-03-01", ...values })

beforeEach(async () => {
  await pg.exec("TRUNCATE contract_vehicle_assignments, contracts, clients, fuel_vehicles, worksites, users CASCADE")
  await testDb.insert(schema.users).values({ id: "u-1", name: "Jefatura", email: "j@chome.test", hashedPassword: "x" })
  await testDb.insert(schema.worksites).values({ id: "w-a", name: "Cholguan - Arauco", code: "W-A", isActive: true })
  await testDb.insert(schema.fuelVehicles).values({ id: "v-1", plate: "RBYD-98", type: "camion", equipmentTypeId: "fet-camion", worksiteId: "w-a" })
  await testDb.insert(schema.clients).values({ id: "cl-1", rut: "76123456-0", name: "Maderas Arauco S.A." })
  await testDb.insert(schema.contracts).values({ id: "c-1", code: "CTR-2026-0001", clientId: "cl-1", name: "Movimiento de residuos", worksiteId: "w-a", billingCycle: "none" })
})

describe("contract_vehicle_assignments", () => {
  it("rechaza valid_to anterior a valid_from", async () => {
    expect(await rejection(assign({ id: "a-1", validFrom: "2026-03-10", validTo: "2026-03-09" })))
      .toMatch(/contract_vehicle_assignments_dates_valid/)
  })

  it("admite valid_to igual a valid_from (un día es inclusivo en ambos extremos)", async () => {
    await assign({ id: "a-1", validFrom: "2026-03-10", validTo: "2026-03-10" })
    const rows = await testDb.select().from(schema.contractVehicleAssignments)
    expect(rows).toHaveLength(1)
  })

  it("admite una sola asignación abierta por equipo", async () => {
    await assign({ id: "a-1", validTo: null })
    expect(await rejection(assign({ id: "a-2", validFrom: "2026-04-01", validTo: null })))
      .toMatch(/contract_vehicle_assignments_open_unique/)
  })

  it("rechaza fechas que no son días YYYY-MM-DD", async () => {
    expect(await rejection(assign({ id: "a-1", validFrom: "2026-3-1" })))
      .toMatch(/contract_vehicle_assignments_from_format/)
  })

  it("no deja borrar una faena con contratos", async () => {
    expect(await rejection(testDb.delete(schema.worksites).where(eq(schema.worksites.id, "w-a"))))
      .toMatch(/contracts_worksite_id_worksites_id_fk|foreign key/i)
  })

  it("emite códigos CTR por año", async () => {
    expect(await nextCodeTx(testDb, "CTR", 2026)).toBe("CTR-2026-0001")
    expect(await nextCodeTx(testDb, "CTR", 2026)).toBe("CTR-2026-0002")
  })
})
