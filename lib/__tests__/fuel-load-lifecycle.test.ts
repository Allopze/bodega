/**
 * CO-015: sólo `reconciled` bloqueaba la edición y el borrado, así que una carga
 * anulada se podía editar de vuelta al circuito y el registro no comprobaba el
 * estado al escribir. Ahora el conjunto de estados viaja también en el `WHERE`
 * de cada mutación: entre la lectura y la escritura otra sesión puede conciliar,
 * anular o asignar la carga a un estado de cuenta.
 */
import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { eq } from "drizzle-orm"
import type { Session } from "next-auth"
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest"
import * as schema from "@/db/schema"
import { migratePGlite } from "@/lib/testing/pglite-migrate"

const pg = new PGlite()
const inMemoryDb = drizzle(pg, { schema })
const testGlobal = globalThis as typeof globalThis & { __db?: typeof inMemoryDb }
// @ts-expect-error — PGlite es estructuralmente compatible en runtime.
testGlobal.__db = inMemoryDb

vi.mock("@/db", () => ({
  get db() {
    return testGlobal.__db
  },
}))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }))

const mockAuth = vi.hoisted(() => vi.fn())
vi.mock("@/lib/auth/auth", () => ({ auth: mockAuth }))
vi.mock("@/lib/services/module-toggles", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/services/module-toggles")>()),
  assertPermissionModuleEnabled: vi.fn(async () => {}),
  assertRouteModuleEnabled: vi.fn(async () => {}),
}))

await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))

const { deleteFuelLoadAction, registerFuelLoadAction, updateFuelLoadAction } =
  await import("@/app/(app)/combustibles/actions-module/loads")

function session(): Session {
  return {
    user: {
      id: "actor", name: "Operador", email: "op@example.com", roles: ["administrador"],
      permissions: ["combustibles:create", "combustibles:delete"],
      worksiteIds: [], primaryWorksiteId: null, avatarColor: null, isActive: true, isGlobal: true,
    },
    expires: "2099-01-01T00:00:00.000Z",
  } as unknown as Session
}

const baseLoad = (id: string, status: string) => ({
  id, loadDate: "2026-06-10", month: "2026-06", serviceType: "TCT", vehicleId: "veh-a",
  fuelSupplierId: "sup-1", worksiteId: "ws-a", product: "PETROLEO DIESEL", productId: "prod-1",
  liters: 10, baseAmount: 10_000, ivaAmount: 1_900, iecTotal: 0, totalAmount: 11_900,
  status, createdBy: "actor",
})

function editForm(id: string) {
  const form = new FormData()
  form.set("id", id)
  form.set("loadDate", "2026-06-11")
  form.set("liters", "20")
  form.set("baseAmount", "20000")
  return form
}

describe("ciclo de vida de una carga de combustible", () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    mockAuth.mockResolvedValue(session())
    await inMemoryDb.delete(schema.fuelLoads)
    await inMemoryDb.delete(schema.fuelVehicles)
    await inMemoryDb.delete(schema.fuelEquipmentTypes)
    await inMemoryDb.delete(schema.fuelSuppliers)
    await inMemoryDb.delete(schema.fuelProducts)
    await inMemoryDb.delete(schema.auditLog)
    await inMemoryDb.delete(schema.users)
    await inMemoryDb.delete(schema.worksites)

    await inMemoryDb.insert(schema.worksites).values({ id: "ws-a", name: "Faena A", code: "FN-A" })
    await inMemoryDb.insert(schema.users).values({ id: "actor", name: "Operador", email: "op@example.com", hashedPassword: "x" })
    await inMemoryDb.insert(schema.fuelSuppliers).values({ id: "sup-1", name: "Copec" })
    await inMemoryDb.insert(schema.fuelProducts).values({ id: "prod-1", code: "DIESEL", name: "Diésel", category: "diesel", unit: "liter" })
    await inMemoryDb.insert(schema.fuelEquipmentTypes).values({ id: "fet-1", slug: "camioneta", name: "Camioneta" })
    await inMemoryDb.insert(schema.fuelVehicles).values({ id: "veh-a", plate: "AAAA11", type: "camioneta", equipmentTypeId: "fet-1", worksiteId: "ws-a", isActive: true })
  })

  afterAll(async () => {
    delete testGlobal.__db
    await pg.close()
  })

  it("no deja editar una carga anulada", async () => {
    await inMemoryDb.insert(schema.fuelLoads).values(baseLoad("load-cancelled", "cancelled"))

    const state = await updateFuelLoadAction({ ok: false }, editForm("load-cancelled"))

    expect(state.ok).toBe(false)
    expect(state.message).toMatch(/anulada/i)
    const untouched = await inMemoryDb.query.fuelLoads.findFirst({ where: eq(schema.fuelLoads.id, "load-cancelled") })
    expect(untouched?.loadDate).toBe("2026-06-10")
  })

  it("no deja editar ni eliminar una carga conciliada", async () => {
    await inMemoryDb.insert(schema.fuelLoads).values(baseLoad("load-reconciled", "reconciled"))

    const edit = await updateFuelLoadAction({ ok: false }, editForm("load-reconciled"))
    const remove = await deleteFuelLoadAction("load-reconciled")

    expect(edit.message).toMatch(/conciliada/i)
    expect(remove.message).toMatch(/conciliada/i)
    expect(await inMemoryDb.query.fuelLoads.findFirst({ where: eq(schema.fuelLoads.id, "load-reconciled") })).toBeTruthy()
  })

  it("registrar exige borrador y no se aplica dos veces", async () => {
    await inMemoryDb.insert(schema.fuelLoads).values(baseLoad("load-draft", "draft"))

    const first = await registerFuelLoadAction("load-draft")
    const second = await registerFuelLoadAction("load-draft")

    expect(first.ok).toBe(true)
    expect(second.ok).toBe(false)
    expect(second.message).toMatch(/borrador/i)
    const stored = await inMemoryDb.query.fuelLoads.findFirst({ where: eq(schema.fuelLoads.id, "load-draft") })
    expect(stored?.status).toBe("registered")
  })

  it("la edición no pisa una carga que quedó asignada a un estado de cuenta", async () => {
    await inMemoryDb.insert(schema.fuelLoads).values(baseLoad("load-registered", "registered"))
    await inMemoryDb.insert(schema.fuelMonthlyStatements).values({
      id: "stmt-1", month: "2026-06", fuelSupplierId: "sup-1",
      totalLiters: 10, totalBaseAmount: 10_000, totalIva: 1_900, totalIec: 0, totalAmount: 11_900,
      createdBy: "actor",
    })
    await inMemoryDb.update(schema.fuelLoads).set({ statementId: "stmt-1" }).where(eq(schema.fuelLoads.id, "load-registered"))

    const state = await updateFuelLoadAction({ ok: false }, editForm("load-registered"))

    expect(state.ok).toBe(false)
    const untouched = await inMemoryDb.query.fuelLoads.findFirst({ where: eq(schema.fuelLoads.id, "load-registered") })
    expect(untouched?.loadDate).toBe("2026-06-10")
  })
})
