import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { asc, eq } from "drizzle-orm"
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { Session } from "next-auth"
import { migratePGlite } from "@/lib/testing/pglite-migrate"
import * as schema from "@/db/schema"
import type { DB } from "@/db"
import { computeRutDv } from "@/lib/rut"

/**
 * Contratos desde la faena, mandantes y el ajuste de `saveContractAction`
 * (Facturación) contra Postgres de verdad. Lo de cobro que cargó Facturación
 * no se pisa desde la faena, y las asignaciones de equipos no quedan colgando
 * de un contrato que cambia de faena, de estado o de término.
 */

const pg = new PGlite()
const testDb = drizzle(pg, { schema }) as unknown as DB
const testGlobal = globalThis as typeof globalThis & { __db?: DB }
testGlobal.__db = testDb
vi.mock("@/db", () => ({ get db() { return testGlobal.__db } }))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }))

const SESSION = {
  user: {
    id: "u-1", name: "Jefatura", email: "j@chome.test",
    permissions: ["billing:manage_clients"], roles: ["administrador"], worksiteIds: [], isGlobal: true,
  },
  expires: "2099-01-01T00:00:00.000Z",
} as unknown as Session
vi.mock("@/lib/auth/can", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth/can")>()),
  guardPermission: vi.fn(async () => ({ session: SESSION, error: null })),
}))

await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))

afterAll(async () => {
  delete testGlobal.__db
  await pg.close()
})

const { saveOperationalContract, createMandante, listMandanteOptions } = await import("@/lib/services/contracts/contracts")
const { assignVehiclesToContract } = await import("@/lib/services/contracts/assignments")
const { saveContractAction } = await import("@/app/(app)/facturacion/actions")

const actor = { userId: "u-1", email: "j@chome.test" }

let rutSeq = 76_100_000
const nextRut = () => {
  const body = String(++rutSeq)
  return `${body}-${computeRutDv(body)}`
}
/** `76123456-0` → `76.123.456-0`: así llegan los receptores de las facturas. */
const dotted = (rut: string) => rut.replace(/^(\d+?)(\d{3})(\d{3})-/, "$1.$2.$3-")

let folio = 0
const seedSale = (receiverTaxId: string, receiverName: string, direction: "sale" | "purchase" = "sale") =>
  testDb.insert(schema.billingInvoices).values({
    id: `inv-${++folio}`, direction, docType: "33", folio, issuerTaxId: "99999999-9", issuerName: "Chome",
    receiverTaxId, receiverName, issueDate: "2026-03-10", totalAmount: 1000, source: "manual",
  })

const contractRow = async (id: string) => (await testDb.select().from(schema.contracts).where(eq(schema.contracts.id, id)))[0]!
const assignmentRows = () => testDb.select().from(schema.contractVehicleAssignments)
  .orderBy(asc(schema.contractVehicleAssignments.vehicleId))

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] })
  vi.setSystemTime(new Date("2026-11-20T12:00:00.000Z"))
  await pg.exec("TRUNCATE audit_log, billing_invoices, contract_vehicle_assignments, contracts, clients, fuel_vehicles, worksites, users CASCADE")
  await testDb.insert(schema.users).values({ id: "u-1", name: "Jefatura", email: "j@chome.test", hashedPassword: "x" })
  await testDb.insert(schema.worksites).values([
    { id: "w-a", name: "Cholguan - Arauco", code: "W-A", isActive: true },
    { id: "w-b", name: "Biodiversa", code: "W-B", isActive: true },
  ])
  await testDb.insert(schema.fuelVehicles).values([
    { id: "v-1", plate: "RBYD98", code: "KA-11", type: "camion", equipmentTypeId: "fet-camion", worksiteId: "w-a" },
    { id: "v-2", plate: "RBYD99", code: "KA-12", type: "camion", equipmentTypeId: "fet-camion", worksiteId: "w-a" },
  ])
  await testDb.insert(schema.clients).values([
    { id: "cl-1", rut: "76123456-0", name: "Maderas Arauco S.A." },
    { id: "cl-2", rut: "96510970-6", name: "Forestal Mininco S.A." },
  ])
})

afterEach(() => {
  vi.useRealTimers()
})

const createInput = (fields: Record<string, unknown> = {}) => ({
  worksiteId: "w-a", clientId: "cl-1", name: "Movimiento de residuos", status: "active", ...fields,
})

async function createContract(fields: Record<string, unknown> = {}) {
  const result = await saveOperationalContract(actor, createInput(fields))
  if (!result.ok) throw new Error(result.message)
  return result
}

describe("saveOperationalContract", () => {
  it("crea un contrato de faena con código CTR del año y ciclo Sin calendario", async () => {
    const result = await saveOperationalContract(actor, createInput({ startDate: "2026-03-01", endDate: "", status: "closed" }))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.code).toMatch(/^CTR-2026-\d{4}$/)
    const row = await contractRow(result.id)
    expect(row).toMatchObject({
      code: result.code, clientId: "cl-1", worksiteId: "w-a", name: "Movimiento de residuos",
      startDate: "2026-03-01", endDate: null, billingCycle: "none", currency: "CLP", status: "active", periodAmount: null,
    })
    const audit = await testDb.select().from(schema.auditLog).where(eq(schema.auditLog.entityType, "contract"))
    expect(audit).toHaveLength(1)
    expect(audit[0]).toMatchObject({ action: "create", entityId: result.id, worksiteId: "w-a", userId: "u-1" })
    // Dos altas seguidas no repiten código.
    const second = await createContract()
    expect(second.code).not.toBe(result.code)
  })

  it("no cambia los campos de cobro al editar desde la faena", async () => {
    const { id } = await createContract()
    await testDb.update(schema.contracts)
      .set({ periodAmount: 1000, billingCycle: "monthly", paymentTermsDays: 30, clientPoNumber: "OC-77" })
      .where(eq(schema.contracts.id, id))
    const result = await saveOperationalContract(actor, createInput({ id, name: "Transporte de rollizos", clientId: "cl-2", startDate: "2026-02-01" }))
    expect(result.ok).toBe(true)
    expect(await contractRow(id)).toMatchObject({
      name: "Transporte de rollizos", clientId: "cl-2", startDate: "2026-02-01",
      periodAmount: 1000, billingCycle: "monthly", paymentTermsDays: 30, clientPoNumber: "OC-77", currency: "CLP",
    })
    const audit = await testDb.select().from(schema.auditLog).where(eq(schema.auditLog.action, "update"))
    expect(audit).toHaveLength(1)
    expect(audit[0]).toMatchObject({ entityType: "contract", entityId: id, worksiteId: "w-a" })
  })

  it("rechaza cambiar la faena de un contrato con equipos asignados", async () => {
    const { id } = await createContract()
    expect(await assignVehiclesToContract(actor, { contractId: id, vehicleIds: ["v-1"], validFrom: "2026-03-01" })).toMatchObject({ ok: true })
    const result = await saveOperationalContract(actor, createInput({ id, worksiteId: "w-b" }))
    expect(result.ok).toBe(false)
    expect((await contractRow(id)).worksiteId).toBe("w-a")
    expect(await assignmentRows()).toHaveLength(1)
  })

  it("rechaza cambiar el mandante de un contrato con facturación", async () => {
    const { id } = await createContract()
    await testDb.insert(schema.billingProposals).values({
      id: "p-1", code: "PF-1", clientId: "cl-1", contractId: id, servicePeriod: "2026-08", createdBy: "u-1",
    })
    const result = await saveOperationalContract(actor, createInput({ id, clientId: "cl-2" }))
    expect(result.ok).toBe(false)
    expect((await contractRow(id)).clientId).toBe("cl-1")
    // Sin cambiar de mandante sigue pudiéndose corregir el nombre.
    expect((await saveOperationalContract(actor, createInput({ id, name: "Otro nombre" }))).ok).toBe(true)
  })

  it("fijar el término desde la faena acota las asignaciones abiertas en la misma operación", async () => {
    const { id } = await createContract()
    await assignVehiclesToContract(actor, { contractId: id, vehicleIds: ["v-1", "v-2"], validFrom: "2026-03-01" })
    const result = await saveOperationalContract(actor, createInput({ id, endDate: "2026-12-31" }))
    expect(result.ok).toBe(true)
    expect((await assignmentRows()).map((row) => [row.vehicleId, row.validTo])).toEqual([["v-1", "2026-12-31"], ["v-2", "2026-12-31"]])
    // Cerrarlo con equipos asignados hasta una fecha futura dejaría costo corriendo a un
    // contrato cerrado: se rechaza. Con término hoy (reloj fijo: 2026-11-20) sí se cierra.
    expect((await saveOperationalContract(actor, createInput({ id, endDate: "2026-12-31", status: "closed" }))).ok).toBe(false)
    expect((await saveOperationalContract(actor, createInput({ id, endDate: "2026-11-20", status: "closed" }))).ok).toBe(true)
    expect((await assignmentRows()).map((row) => row.validTo)).toEqual(["2026-11-20", "2026-11-20"])
  })

  it("rechaza un término anterior al inicio de una asignación y cerrar con equipos abiertos sin término", async () => {
    const { id } = await createContract()
    await assignVehiclesToContract(actor, { contractId: id, vehicleIds: ["v-1"], validFrom: "2026-03-01" })
    const early = await saveOperationalContract(actor, createInput({ id, endDate: "2026-02-28" }))
    expect(early.ok).toBe(false)
    if (!early.ok) expect(early.message).toContain("2026-03-01")
    expect((await saveOperationalContract(actor, createInput({ id, status: "closed" }))).ok).toBe(false)
    expect((await contractRow(id)).endDate).toBeNull()
    expect((await assignmentRows()).map((row) => row.validTo)).toEqual([null])
  })

  it("devuelve errores por campo y rechaza mandante o contrato inexistentes", async () => {
    const bad = await saveOperationalContract(actor, createInput({ name: "x", startDate: "2026-05-01", endDate: "2026-04-01" }))
    expect(bad.ok).toBe(false)
    if (!bad.ok) expect(bad.fieldErrors?.name?.[0]).toBeDefined()
    const dates = await saveOperationalContract(actor, createInput({ startDate: "2026-05-01", endDate: "2026-04-01" }))
    expect(dates.ok).toBe(false)
    if (!dates.ok) expect(dates.fieldErrors?.endDate?.[0]).toContain("anterior")
    expect((await saveOperationalContract(actor, createInput({ clientId: "nope" }))).ok).toBe(false)
    expect((await saveOperationalContract(actor, createInput({ id: "nope" }))).ok).toBe(false)
    expect((await saveOperationalContract(actor, createInput({ worksiteId: "nope" }))).ok).toBe(false)
    expect(await testDb.select().from(schema.contracts)).toHaveLength(0)
  })
})

describe("createMandante", () => {
  it("crea el mandante con el RUT normalizado y lo audita", async () => {
    const rut = nextRut()
    const result = await createMandante(actor, { rut: dotted(rut), name: "  Forestal Nueva S.A.  " })
    expect(result).toMatchObject({ ok: true, existed: false })
    if (!result.ok) return
    const [row] = await testDb.select().from(schema.clients).where(eq(schema.clients.id, result.id))
    expect(row).toMatchObject({ rut, name: "Forestal Nueva S.A.", isActive: true, defaultCurrency: "CLP" })
    const audit = await testDb.select().from(schema.auditLog).where(eq(schema.auditLog.entityType, "client"))
    expect(audit).toHaveLength(1)
  })

  it("crear mandante con un RUT existente devuelve el cliente existente", async () => {
    const result = await createMandante(actor, { rut: "76.123.456-0", name: "Otro nombre" })
    expect(result).toEqual({ ok: true, id: "cl-1", existed: true })
    const all = await testDb.select().from(schema.clients)
    expect(all).toHaveLength(2)
    expect(all.find((row) => row.id === "cl-1")?.name).toBe("Maderas Arauco S.A.")
  })

  it("rechaza un RUT inválido", async () => {
    const rut = nextRut()
    const wrongDv = `${rut.slice(0, -1)}${rut.endsWith("1") ? "2" : "1"}`
    expect((await createMandante(actor, { rut: wrongDv, name: "Forestal Mala" })).ok).toBe(false)
    expect((await createMandante(actor, { rut: "abc", name: "Forestal Mala" })).ok).toBe(false)
    expect((await createMandante(actor, { rut: "", name: "Forestal Mala" })).ok).toBe(false)
    expect((await createMandante(actor, { rut, name: "x" })).ok).toBe(false)
    expect(await testDb.select().from(schema.clients)).toHaveLength(2)
  })
})

describe("listMandanteOptions", () => {
  it("las sugerencias de mandante salen de los receptores de facturas de venta sin cliente", async () => {
    const a = nextRut()
    const b = nextRut()
    const c = nextRut()
    // A: 3 facturas (dos con la razón social más usada); B: una; "cl-1" ya es cliente; C sólo compra; uno inválido.
    await seedSale(dotted(a), "Forestal A S.A.")
    await seedSale(a.replace("-", ""), "Forestal A S.A.")
    await seedSale(a, "FORESTAL A")
    await seedSale(dotted(b), "Mandante B")
    await seedSale("76.123.456-0", "Maderas Arauco S.A.")
    await seedSale(c, "Proveedor C", "purchase")
    await seedSale("11.111.111-2", "RUT inválido")
    const options = await listMandanteOptions()
    expect(options.suggestions).toEqual([{ rut: a, name: "Forestal A S.A." }, { rut: b, name: "Mandante B" }])
    expect(options.clients.map((client) => client.id)).toEqual(["cl-2", "cl-1"])
    expect(options.clients[0]).toEqual({ id: "cl-2", rut: "96510970-6", name: "Forestal Mininco S.A." })
  })

  it("deja sólo las 20 sugerencias más frecuentes", async () => {
    for (let i = 0; i < 22; i++) {
      const rut = nextRut()
      // El receptor i recibe (i + 1) facturas: los dos de menos facturas quedan fuera.
      for (let j = 0; j <= i; j++) await seedSale(rut, `Mandante ${String(i).padStart(2, "0")}`)
    }
    const { suggestions } = await listMandanteOptions()
    expect(suggestions).toHaveLength(20)
    expect(suggestions[0]!.name).toBe("Mandante 21")
    expect(suggestions.at(-1)!.name).toBe("Mandante 02")
  })
})

describe("saveContractAction (Facturación)", () => {
  const form = (fields: Record<string, unknown> = {}) => ({
    code: "", clientId: "cl-1", name: "Contrato de cobro", currency: "CLP", billingCycle: "monthly", status: "active", ...fields,
  })

  it("Facturación genera el código si viene vacío", async () => {
    const result = await saveContractAction(form({ worksiteId: "w-a" }))
    expect(result).toEqual({ ok: true, message: "Contrato creado" })
    const [row] = await testDb.select().from(schema.contracts)
    expect(row!.code).toMatch(/^CTR-2026-\d{4}$/)
    expect(row).toMatchObject({ billingCycle: "monthly", worksiteId: "w-a" })
    // Un código escrito a mano se respeta y no puede repetirse.
    expect((await saveContractAction(form({ code: " ct-manual " }))).ok).toBe(true)
    expect((await testDb.select().from(schema.contracts).where(eq(schema.contracts.code, "CT-MANUAL")))).toHaveLength(1)
    expect((await saveContractAction(form({ code: "CT-MANUAL" }))).ok).toBe(false)
  })

  it("editar sin código se rechaza: el código existente no se regenera", async () => {
    const { id } = await createContract()
    expect((await saveContractAction(form({ id, code: "" }))).ok).toBe(false)
  })

  it("Facturación no puede mover de faena un contrato con equipos", async () => {
    const { id, code } = await createContract()
    await assignVehiclesToContract(actor, { contractId: id, vehicleIds: ["v-1"], validFrom: "2026-03-01" })
    const result = await saveContractAction(form({ id, code, worksiteId: "w-b" }))
    expect(result.ok).toBe(false)
    expect(result.message).toContain("equipos asignados")
    expect((await contractRow(id)).worksiteId).toBe("w-a")
    // Dejándolo en su faena la edición pasa.
    expect((await saveContractAction(form({ id, code, worksiteId: "w-a" }))).ok).toBe(true)
  })

  it("Facturación acota las asignaciones al fijar el término y rechaza cerrar sin término", async () => {
    const { id, code } = await createContract()
    await assignVehiclesToContract(actor, { contractId: id, vehicleIds: ["v-1", "v-2"], validFrom: "2026-03-01" })
    const closeWithout = await saveContractAction(form({ id, code, worksiteId: "w-a", status: "closed" }))
    expect(closeWithout.ok).toBe(false)
    expect((await assignmentRows()).map((row) => row.validTo)).toEqual([null, null])

    const early = await saveContractAction(form({ id, code, worksiteId: "w-a", endDate: "2026-02-01" }))
    expect(early.ok).toBe(false)

    // Término futuro y cerrado a la vez: los equipos seguirían sumando costo a un contrato cerrado.
    const futureClose = await saveContractAction(form({ id, code, worksiteId: "w-a", endDate: "2026-12-31", status: "closed" }))
    expect(futureClose.ok).toBe(false)
    expect((await assignmentRows()).map((row) => row.validTo)).toEqual([null, null])

    const closed = await saveContractAction(form({ id, code, worksiteId: "w-a", endDate: "2026-11-15", status: "closed" }))
    expect(closed.ok).toBe(true)
    expect((await assignmentRows()).map((row) => row.validTo)).toEqual(["2026-11-15", "2026-11-15"])
    expect(await contractRow(id)).toMatchObject({ status: "closed", endDate: "2026-11-15" })
  })
})
