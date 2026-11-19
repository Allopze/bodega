import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { asc, eq } from "drizzle-orm"
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest"
import { migratePGlite } from "@/lib/testing/pglite-migrate"
import * as schema from "@/db/schema"
import type { DB, Tx } from "@/db"

/**
 * Servicio de asignaciones equipo → contrato contra Postgres de verdad: lo que
 * la base no expresa sola (sin traslapes, faena coincidente, vigencia del
 * contrato) lo sostiene el servicio y se prueba aquí.
 */

const pg = new PGlite()
const testDb = drizzle(pg, { schema }) as unknown as DB
const testGlobal = globalThis as typeof globalThis & { __db?: DB }
testGlobal.__db = testDb
vi.mock("@/db", () => ({ get db() { return testGlobal.__db } }))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))

await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))

afterAll(async () => {
  delete testGlobal.__db
  await pg.close()
})

const {
  assignVehiclesToContract, endVehicleAssignment, closeContractAssignmentsOnRelocationTx,
  assertContractChangeKeepsAssignmentsTx, capContractAssignmentsTx, listAssignmentWindows, listVehicleAssignmentHistory,
} = await import("@/lib/services/contracts/assignments")

const actor = { userId: "u-1", email: "j@chome.test" }

const assign = (contractId: string, vehicleIds: string[], validFrom: string) =>
  assignVehiclesToContract(actor, { contractId, vehicleIds, validFrom })

const rows = () => testDb.select().from(schema.contractVehicleAssignments)
  .orderBy(asc(schema.contractVehicleAssignments.vehicleId), asc(schema.contractVehicleAssignments.validFrom))

const seedAssignment = (values: Partial<typeof schema.contractVehicleAssignments.$inferInsert> & { id: string }) =>
  testDb.insert(schema.contractVehicleAssignments).values({ contractId: "c-1", vehicleId: "v-1", validFrom: "2026-03-01", ...values })

beforeEach(async () => {
  await pg.exec("TRUNCATE audit_log, contract_vehicle_assignments, fuel_provider_mappings, contracts, clients, fuel_vehicles, worksites, users CASCADE")
  await testDb.insert(schema.users).values({ id: "u-1", name: "Jefatura", email: "j@chome.test", hashedPassword: "x" })
  await testDb.insert(schema.worksites).values([
    { id: "w-a", name: "Cholguan - Arauco", code: "W-A", isActive: true },
    { id: "w-b", name: "Biodiversa", code: "W-B", isActive: true },
  ])
  await testDb.insert(schema.fuelVehicles).values([
    { id: "v-1", plate: "RBYD98", code: "KA-11", type: "camion", equipmentTypeId: "fet-camion", worksiteId: "w-a" },
    { id: "v-2", plate: "RBYD99", code: "KA-12", type: "camion", equipmentTypeId: "fet-camion", worksiteId: "w-a" },
    { id: "v-3", plate: "RBZA01", code: "KA-13", type: "camion", equipmentTypeId: "fet-camion", worksiteId: "w-b" },
  ])
  await testDb.insert(schema.clients).values({ id: "cl-1", rut: "76123456-0", name: "Maderas Arauco S.A." })
  await testDb.insert(schema.contracts).values([
    { id: "c-1", code: "CTR-2026-0001", clientId: "cl-1", name: "Movimiento de residuos", worksiteId: "w-a", billingCycle: "none" },
    { id: "c-2", code: "CTR-2026-0002", clientId: "cl-1", name: "Transporte de rollizos", worksiteId: "w-a", billingCycle: "none" },
    { id: "c-3", code: "CTR-2026-0003", clientId: "cl-1", name: "Caminos", worksiteId: "w-b", billingCycle: "none" },
  ])
})

describe("assignVehiclesToContract", () => {
  it("asigna varios equipos desde una fecha y deja una asignación abierta por equipo", async () => {
    const result = await assign("c-1", ["v-1", "v-2"], "2026-03-01")
    expect(result).toEqual({ ok: true, assigned: 2, warnings: [] })
    expect((await rows()).map((r) => [r.vehicleId, r.contractId, r.validFrom, r.validTo, r.createdByUserId])).toEqual([
      ["v-1", "c-1", "2026-03-01", null, "u-1"],
      ["v-2", "c-1", "2026-03-01", null, "u-1"],
    ])
  })

  it("al reasignar cierra la anterior el día previo", async () => {
    await assign("c-1", ["v-1"], "2026-03-01")
    expect(await assign("c-2", ["v-1"], "2026-06-15")).toMatchObject({ ok: true, assigned: 1 })
    expect((await rows()).map((r) => [r.contractId, r.validFrom, r.validTo])).toEqual([
      ["c-1", "2026-03-01", "2026-06-14"],
      ["c-2", "2026-06-15", null],
    ])
  })

  it("reasignar el mismo día corrige el contrato en vez de cerrar", async () => {
    await assign("c-1", ["v-1"], "2026-03-01")
    expect(await assign("c-2", ["v-1"], "2026-03-01")).toMatchObject({ ok: true, assigned: 1 })
    expect((await rows()).map((r) => [r.contractId, r.validFrom, r.validTo])).toEqual([["c-2", "2026-03-01", null]])
  })

  it("asignar al mismo contrato vigente no hace nada", async () => {
    await assign("c-1", ["v-1"], "2026-03-01")
    expect(await assign("c-1", ["v-1"], "2026-06-01")).toEqual({ ok: true, assigned: 0, warnings: [] })
    expect((await rows()).map((r) => [r.contractId, r.validFrom, r.validTo])).toEqual([["c-1", "2026-03-01", null]])
  })

  it("rechaza una fecha anterior a una asignación existente", async () => {
    await assign("c-1", ["v-1"], "2026-06-01")
    const before = await rows()
    const result = await assign("c-2", ["v-2", "v-1"], "2026-03-01")
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.message).toContain("KA-11")
      expect(result.message).toContain("2026-06-01")
    }
    // Rechaza el lote entero: ni siquiera v-2, que no tenía conflicto, queda asignado.
    expect(await rows()).toEqual(before)
  })

  it("reasignar dentro de una asignación cerrada la acorta al día anterior", async () => {
    await seedAssignment({ id: "a-1", validFrom: "2026-03-01", validTo: "2026-04-30" })
    expect(await assign("c-2", ["v-1"], "2026-04-10")).toMatchObject({ ok: true, assigned: 1 })
    expect((await rows()).map((r) => [r.contractId, r.validFrom, r.validTo])).toEqual([
      ["c-1", "2026-03-01", "2026-04-09"], ["c-2", "2026-04-10", null],
    ])
  })

  it("mover un equipo fuera de un contrato con término acorta su asignación y abre la nueva", async () => {
    await testDb.update(schema.contracts).set({ endDate: "2026-12-31" }).where(eq(schema.contracts.id, "c-1"))
    await assign("c-1", ["v-1", "v-2"], "2026-03-01")
    // La faena en lote y la ficha usan el mismo servicio: este es el caso que no podía hacerse.
    expect(await assign("c-2", ["v-1", "v-2"], "2026-06-15")).toMatchObject({ ok: true, assigned: 2 })
    expect((await rows()).map((r) => [r.vehicleId, r.contractId, r.validFrom, r.validTo])).toEqual([
      ["v-1", "c-1", "2026-03-01", "2026-06-14"], ["v-1", "c-2", "2026-06-15", null],
      ["v-2", "c-1", "2026-03-01", "2026-06-14"], ["v-2", "c-2", "2026-06-15", null],
    ])
  })

  it("no toca una asignación de un contrato de otra faena (antes de un traslado)", async () => {
    // v-3 está hoy en w-b; antes del traslado trabajó para c-1 (w-a) hasta el 30-06.
    await seedAssignment({ id: "a-old", vehicleId: "v-3", contractId: "c-1", validFrom: "2026-01-01", validTo: "2026-06-30" })
    const result = await assign("c-3", ["v-3"], "2026-03-01")
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.message).toContain("otra faena")
    expect((await endVehicleAssignment(actor, { vehicleId: "v-3", lastDay: "2026-04-30" })).ok).toBe(false)
    expect((await rows()).map((r) => [r.id, r.validTo])).toEqual([["a-old", "2026-06-30"]])
    // Desde el traslado en adelante sí se le asigna contrato en su faena actual.
    expect(await assign("c-3", ["v-3"], "2026-07-01")).toMatchObject({ ok: true, assigned: 1 })
  })

  it("rechaza equipos de otra faena", async () => {
    const result = await assign("c-1", ["v-1", "v-3"], "2026-03-01")
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.message).toContain("KA-13")
    expect(await rows()).toHaveLength(0)
  })

  it("rechaza equipos inactivos y equipos que no existen", async () => {
    await testDb.update(schema.fuelVehicles).set({ isActive: false }).where(eq(schema.fuelVehicles.id, "v-2"))
    const inactive = await assign("c-1", ["v-1", "v-2"], "2026-03-01")
    expect(inactive.ok).toBe(false)
    if (!inactive.ok) expect(inactive.message).toContain("KA-12")
    expect((await assign("c-1", ["nope"], "2026-03-01")).ok).toBe(false)
    expect(await rows()).toHaveLength(0)
  })

  it("rechaza contratos suspendidos o cerrados y fechas fuera del contrato", async () => {
    await testDb.update(schema.contracts).set({ status: "suspended" }).where(eq(schema.contracts.id, "c-1"))
    expect((await assign("c-1", ["v-1"], "2026-03-01")).ok).toBe(false)
    await testDb.update(schema.contracts).set({ status: "closed" }).where(eq(schema.contracts.id, "c-1"))
    expect((await assign("c-1", ["v-1"], "2026-03-01")).ok).toBe(false)

    await testDb.update(schema.contracts).set({ status: "active", startDate: "2026-05-01", endDate: "2026-12-31" }).where(eq(schema.contracts.id, "c-2"))
    expect((await assign("c-2", ["v-1"], "2026-04-30")).ok).toBe(false)
    expect((await assign("c-2", ["v-1"], "2027-01-01")).ok).toBe(false)
    expect((await assign("zzz", ["v-1"], "2026-05-01")).ok).toBe(false)
    expect(await rows()).toHaveLength(0)
    // Los extremos del contrato son inclusivos.
    expect((await assign("c-2", ["v-1"], "2026-05-01")).ok).toBe(true)
  })

  it("rechaza un contrato sin faena y entradas mal formadas", async () => {
    await testDb.update(schema.contracts).set({ worksiteId: null }).where(eq(schema.contracts.id, "c-1"))
    expect((await assign("c-1", ["v-1"], "2026-03-01")).ok).toBe(false)
    expect((await assign("c-2", [], "2026-03-01")).ok).toBe(false)
    expect((await assign("c-2", ["v-1"], "2026-02-31")).ok).toBe(false)
    expect((await assignVehiclesToContract(actor, { nada: true })).ok).toBe(false)
  })

  it("una asignación a un contrato con término hereda ese término", async () => {
    await testDb.update(schema.contracts).set({ endDate: "2026-12-31" }).where(eq(schema.contracts.id, "c-1"))
    await assign("c-1", ["v-1"], "2026-03-01")
    expect((await rows()).map((r) => [r.validFrom, r.validTo])).toEqual([["2026-03-01", "2026-12-31"]])
  })

  it("avisa cuando el mapeo de combustible ubica al equipo en otra faena", async () => {
    vi.useFakeTimers({ toFake: ["Date"] })
    vi.setSystemTime(new Date("2026-11-20T12:00:00.000Z"))
    try {
      await testDb.insert(schema.fuelProviderMappings).values({
        id: "m-1", provider: "copec", sourceAccount: "tct:diesel", externalKey: "RBYD98", normalizedValue: "RBYD98",
        worksiteId: "w-b", vehicleId: "v-1", decidedBy: "u-1", reason: "prueba", effectiveFrom: "2026-02-01", effectiveTo: "2026-04-30", isActive: false,
      })
      const result = await assign("c-1", ["v-1", "v-2"], "2026-03-01")
      expect(result).toMatchObject({ ok: true, assigned: 2 })
      if (result.ok) {
        expect(result.warnings).toEqual(["KA-11: el mapeo de combustible lo ubica en otra faena entre 2026-03-01 y 2026-04-30"])
      }
      // Asignar no se bloquea por el aviso.
      expect(await rows()).toHaveLength(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it("no avisa si el mapeo en otra faena terminó antes de la asignación", async () => {
    vi.useFakeTimers({ toFake: ["Date"] })
    vi.setSystemTime(new Date("2026-11-20T12:00:00.000Z"))
    try {
      await testDb.insert(schema.fuelProviderMappings).values({
        id: "m-1", provider: "copec", sourceAccount: "tct:diesel", externalKey: "RBYD98", normalizedValue: "RBYD98",
        worksiteId: "w-b", vehicleId: "v-1", decidedBy: "u-1", reason: "prueba", effectiveFrom: "2026-01-01", effectiveTo: "2026-02-28", isActive: false,
      })
      expect(await assign("c-1", ["v-1"], "2026-03-01")).toEqual({ ok: true, assigned: 1, warnings: [] })
    } finally {
      vi.useRealTimers()
    }
  })

  it("audita cada asignación", async () => {
    await assign("c-1", ["v-1", "v-2"], "2026-03-01")
    const audit = await testDb.select().from(schema.auditLog).where(eq(schema.auditLog.entityType, "contract_vehicle_assignment"))
    expect(audit).toHaveLength(2)
    expect(audit.every((row) => row.action === "create" && row.userId === "u-1" && row.worksiteId === "w-a")).toBe(true)
    expect(new Set(audit.map((row) => row.entityId))).toEqual(new Set((await rows()).map((r) => r.id)))
  })
})

describe("endVehicleAssignment", () => {
  it("quitar del contrato cierra la asignación en el último día indicado", async () => {
    await assign("c-1", ["v-1"], "2026-03-01")
    expect(await endVehicleAssignment(actor, { vehicleId: "v-1", lastDay: "2026-08-31" })).toEqual({ ok: true })
    expect((await rows()).map((r) => [r.validFrom, r.validTo])).toEqual([["2026-03-01", "2026-08-31"]])
    // El equipo queda libre: puede asignarse a otro contrato desde el día siguiente.
    expect(await assign("c-2", ["v-1"], "2026-09-01")).toMatchObject({ ok: true, assigned: 1 })
  })

  it("acorta también una asignación que heredó el término del contrato", async () => {
    await testDb.update(schema.contracts).set({ endDate: "2026-12-31" }).where(eq(schema.contracts.id, "c-1"))
    await assign("c-1", ["v-1"], "2026-03-01")
    expect(await endVehicleAssignment(actor, { vehicleId: "v-1", lastDay: "2026-07-15" })).toEqual({ ok: true })
    expect((await rows()).map((r) => r.validTo)).toEqual(["2026-07-15"])
  })

  it("«Sin contrato» desde el inicio de una asignación la borra: deshace una fecha equivocada", async () => {
    await assign("c-1", ["v-1"], "2026-03-01")
    expect(await endVehicleAssignment(actor, { vehicleId: "v-1", lastDay: "2026-02-28" })).toEqual({ ok: true })
    expect(await rows()).toEqual([])
    const audit = await testDb.select().from(schema.auditLog).where(eq(schema.auditLog.action, "delete"))
    expect(audit).toHaveLength(1)
  })

  it("«Sin contrato» rechaza si el equipo tiene una asignación posterior, en vez de dejarla viva", async () => {
    await assign("c-1", ["v-1"], "2026-03-01")
    await assign("c-2", ["v-1"], "2026-06-15")
    const before = await rows()
    const result = await endVehicleAssignment(actor, { vehicleId: "v-1", lastDay: "2026-04-30" })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.message).toContain("2026-06-15")
    expect(await rows()).toEqual(before)
    // Quitando primero la posterior, y después desde el 01-05, queda sin contrato desde esa fecha.
    expect(await endVehicleAssignment(actor, { vehicleId: "v-1", lastDay: "2026-06-14" })).toEqual({ ok: true })
    expect(await endVehicleAssignment(actor, { vehicleId: "v-1", lastDay: "2026-04-30" })).toEqual({ ok: true })
    expect((await rows()).map((r) => [r.contractId, r.validFrom, r.validTo])).toEqual([["c-1", "2026-03-01", "2026-04-30"]])
  })

  it("rechaza un equipo sin asignación y datos mal formados", async () => {
    await assign("c-1", ["v-1"], "2026-03-01")
    expect((await endVehicleAssignment(actor, { vehicleId: "v-2", lastDay: "2026-08-31" })).ok).toBe(false)
    expect((await endVehicleAssignment(actor, { vehicleId: "v-1", lastDay: "ayer" })).ok).toBe(false)
    expect((await rows()).map((r) => r.validTo)).toEqual([null])
  })

  it("audita el cierre", async () => {
    await assign("c-1", ["v-1"], "2026-03-01")
    await endVehicleAssignment(actor, { vehicleId: "v-1", lastDay: "2026-08-31", reason: "Fin del servicio" })
    const audit = await testDb.select().from(schema.auditLog).where(eq(schema.auditLog.action, "update"))
    expect(audit).toHaveLength(1)
    expect(audit[0]).toMatchObject({ entityType: "contract_vehicle_assignment", reason: "Fin del servicio" })
  })
})

describe("closeContractAssignmentsOnRelocationTx", () => {
  const relocate = (effectiveFrom: string) => testDb.transaction((tx) =>
    closeContractAssignmentsOnRelocationTx(tx as unknown as Tx, { vehicleId: "v-1", effectiveFrom, actorUserId: "u-1", actorEmail: "j@chome.test" }))

  it("closeContractAssignmentsOnRelocationTx cierra la abierta el día anterior y borra las que empiezan después", async () => {
    await seedAssignment({ id: "a-1", validFrom: "2026-01-01", validTo: "2026-02-28" })
    await seedAssignment({ id: "a-2", contractId: "c-2", validFrom: "2026-03-01", validTo: "2026-06-30" })
    await seedAssignment({ id: "a-3", validFrom: "2026-07-01", validTo: null })
    expect(await relocate("2026-06-15")).toBe(2)
    expect((await rows()).map((r) => [r.id, r.validFrom, r.validTo])).toEqual([
      ["a-1", "2026-01-01", "2026-02-28"],
      ["a-2", "2026-03-01", "2026-06-14"],
    ])
  })

  it("cierra la abierta el día anterior cuando es la única", async () => {
    await seedAssignment({ id: "a-1", validFrom: "2026-03-01", validTo: null })
    expect(await relocate("2026-06-15")).toBe(1)
    expect((await rows()).map((r) => [r.validFrom, r.validTo])).toEqual([["2026-03-01", "2026-06-14"]])
  })

  it("borra la asignación que empezaba el mismo día del traslado (cerrarla dejaría valid_to < valid_from)", async () => {
    await seedAssignment({ id: "a-1", validFrom: "2026-06-15", validTo: null })
    expect(await relocate("2026-06-15")).toBe(1)
    expect(await rows()).toHaveLength(0)
  })

  it("no toca equipos sin asignación ni asignaciones ya terminadas antes del traslado", async () => {
    await seedAssignment({ id: "a-1", validFrom: "2026-01-01", validTo: "2026-02-28" })
    expect(await relocate("2026-06-15")).toBe(0)
    expect(await rows()).toHaveLength(1)
  })

  it("audita cada cambio", async () => {
    await seedAssignment({ id: "a-1", validFrom: "2026-03-01", validTo: null })
    await relocate("2026-06-15")
    const audit = await testDb.select().from(schema.auditLog)
    expect(audit).toHaveLength(1)
    expect(audit[0]).toMatchObject({ entityType: "contract_vehicle_assignment", entityId: "a-1", action: "update", userId: "u-1" })
  })
})

describe("assertContractChangeKeepsAssignmentsTx", () => {
  const base = { worksiteId: "w-a", startDate: null, endDate: null, status: "active" as const }
  const check = (contractId: string, next: Parameters<typeof assertContractChangeKeepsAssignmentsTx>[2]) =>
    testDb.transaction((tx) => assertContractChangeKeepsAssignmentsTx(tx as unknown as Tx, contractId, next))

  it("assertContractChangeKeepsAssignmentsTx bloquea cambiar faena, retrasar inicio o cerrar con asignaciones abiertas sin término", async () => {
    await assign("c-1", ["v-1"], "2026-03-01")
    expect(await check("c-1", { ...base, worksiteId: "w-b" })).toEqual(expect.any(String))
    expect(await check("c-1", { ...base, startDate: "2026-04-01" })).toEqual(expect.any(String))
    expect(await check("c-1", { ...base, status: "closed" })).toEqual(expect.any(String))
    expect(await check("c-1", { ...base, status: "suspended" })).toEqual(expect.any(String))
    // Lo que no toca las asignaciones se permite.
    expect(await check("c-1", base)).toBeNull()
    expect(await check("c-1", { ...base, startDate: "2026-03-01" })).toBeNull()
    // Fijar el término es el caso normal: las asignaciones abiertas se acotan al guardar.
    expect(await check("c-1", { ...base, endDate: "2026-12-31" })).toBeNull()
  })

  it("cerrar el contrato con término hasta hoy es válido porque el estado se evalúa después de acotar", async () => {
    vi.useFakeTimers({ toFake: ["Date"] })
    vi.setSystemTime(new Date("2026-11-20T15:00:00.000Z"))
    try {
      await assign("c-1", ["v-1"], "2026-03-01")
      expect(await check("c-1", { ...base, endDate: "2026-10-31", status: "closed" })).toBeNull()
      expect(await check("c-1", { ...base, endDate: "2026-11-20", status: "suspended" })).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })

  it("no deja cerrar ni suspender un contrato con equipos asignados hasta una fecha futura", async () => {
    vi.useFakeTimers({ toFake: ["Date"] })
    vi.setSystemTime(new Date("2026-11-20T15:00:00.000Z"))
    try {
      await testDb.update(schema.contracts).set({ endDate: "2027-12-31" }).where(eq(schema.contracts.id, "c-1"))
      await assign("c-1", ["v-1"], "2026-03-01")
      // La asignación heredó el término 2027-12-31: no está «abierta», pero sigue en vigor.
      expect(await check("c-1", { ...base, endDate: "2027-12-31", status: "closed" })).toContain("2027-12-31")
      expect(await check("c-1", { ...base, endDate: "2026-12-31", status: "suspended" })).toContain("2026-12-31")
    } finally {
      vi.useRealTimers()
    }
  })

  it("rechaza un término anterior al inicio de una asignación", async () => {
    await assign("c-1", ["v-1"], "2026-03-01")
    await assign("c-1", ["v-2"], "2026-06-10")
    const message = await check("c-1", { ...base, endDate: "2026-06-09" })
    expect(message).toContain("2026-06-10")
    // Terminar el mismo día en que empieza la última asignación es coherente (un solo día).
    expect(await check("c-1", { ...base, endDate: "2026-06-10" })).toBeNull()
  })

  it("adelantar el término también acota las asignaciones que heredaron el término", async () => {
    await testDb.update(schema.contracts).set({ endDate: "2026-12-31" }).where(eq(schema.contracts.id, "c-1"))
    await assign("c-1", ["v-1"], "2026-03-01")
    expect(await check("c-1", { ...base, endDate: "2026-10-31" })).toBeNull()
    expect(await check("c-1", { ...base, endDate: "2027-03-31" })).toBeNull()
    expect(await check("c-1", { ...base, endDate: "2026-02-28" })).toEqual(expect.any(String))
  })

  it("sin asignaciones permite cualquier cambio", async () => {
    expect(await check("c-2", { worksiteId: "w-b", startDate: "2027-01-01", endDate: "2027-02-01", status: "closed" })).toBeNull()
    expect(await check("c-2", { worksiteId: null, startDate: null, endDate: null, status: "suspended" })).toBeNull()
  })
})

describe("capContractAssignmentsTx", () => {
  const cap = (contractId: string, endDate: string) =>
    testDb.transaction((tx) => capContractAssignmentsTx(tx as unknown as Tx, contractId, endDate, actor))

  it("fijar el término del contrato acota las asignaciones abiertas", async () => {
    await assign("c-1", ["v-1", "v-2"], "2026-03-01")
    await seedAssignment({ id: "a-old", vehicleId: "v-3", validFrom: "2026-01-01", validTo: "2026-02-28" })
    expect(await cap("c-1", "2026-12-31")).toBe(2)
    expect((await rows()).map((r) => [r.vehicleId, r.validFrom, r.validTo])).toEqual([
      ["v-1", "2026-03-01", "2026-12-31"],
      ["v-2", "2026-03-01", "2026-12-31"],
      ["v-3", "2026-01-01", "2026-02-28"],
    ])
    const audit = await testDb.select().from(schema.auditLog).where(eq(schema.auditLog.reason, "Término del contrato"))
    expect(audit).toHaveLength(2)
    expect(audit.every((row) => row.action === "update" && row.worksiteId === "w-a")).toBe(true)
  })

  it("acota también las que pasaban del término y no toca las que ya terminaban antes", async () => {
    await seedAssignment({ id: "a-1", vehicleId: "v-1", validFrom: "2026-03-01", validTo: "2027-06-30" })
    await seedAssignment({ id: "a-2", vehicleId: "v-2", validFrom: "2026-03-01", validTo: "2026-05-31" })
    expect(await cap("c-1", "2026-12-31")).toBe(1)
    expect((await rows()).map((r) => [r.vehicleId, r.validTo])).toEqual([["v-1", "2026-12-31"], ["v-2", "2026-05-31"]])
    // Idempotente.
    expect(await cap("c-1", "2026-12-31")).toBe(0)
  })

  it("no toca asignaciones de otros contratos", async () => {
    await assign("c-1", ["v-1"], "2026-03-01")
    await assign("c-2", ["v-2"], "2026-03-01")
    await cap("c-1", "2026-12-31")
    expect((await rows()).map((r) => [r.contractId, r.validTo])).toEqual([["c-1", "2026-12-31"], ["c-2", null]])
  })
})

describe("consultas", () => {
  it("listAssignmentWindows devuelve las ventanas que tocan desde el mes de `from` hasta `to`", async () => {
    await seedAssignment({ id: "a-1", validFrom: "2026-01-01", validTo: "2026-02-28" })
    await seedAssignment({ id: "a-2", contractId: "c-2", validFrom: "2026-03-01", validTo: "2026-03-31" })
    await seedAssignment({ id: "a-3", validFrom: "2026-04-01", validTo: null })
    await seedAssignment({ id: "a-4", vehicleId: "v-2", validFrom: "2026-03-10", validTo: null })
    const windows = await listAssignmentWindows(["v-1"], "2026-03-15", "2026-03-20")
    expect(windows).toEqual([{ vehicleId: "v-1", contractId: "c-2", worksiteId: "w-a", validFrom: "2026-03-01", validTo: "2026-03-31" }])
    const wide = await listAssignmentWindows(["v-1", "v-2"], "2026-03-15", "2026-05-20")
    expect(wide.map((w) => [w.vehicleId, w.contractId, w.validFrom])).toEqual([
      ["v-1", "c-2", "2026-03-01"], ["v-1", "c-1", "2026-04-01"], ["v-2", "c-1", "2026-03-10"],
    ])
    expect(await listAssignmentWindows([], "2026-03-01", "2026-03-31")).toEqual([])
  })

  it("listAssignmentWindows incluye ventanas que empiezan después de `to` dentro de su mes", async () => {
    await seedAssignment({ id: "a-1", validFrom: "2026-04-25", validTo: null })
    const windows = await listAssignmentWindows(["v-1"], "2026-04-01", "2026-04-20")
    expect(windows.map((w) => w.validFrom)).toEqual(["2026-04-25"])
  })

  it("listVehicleAssignmentHistory devuelve la más reciente primero, con el contrato", async () => {
    await seedAssignment({ id: "a-1", validFrom: "2026-01-01", validTo: "2026-02-28", reason: "Alta" })
    await seedAssignment({ id: "a-2", contractId: "c-2", validFrom: "2026-03-01", validTo: null })
    expect(await listVehicleAssignmentHistory("v-1")).toEqual([
      { id: "a-2", contractId: "c-2", contractName: "Transporte de rollizos", contractCode: "CTR-2026-0002", contractStatus: "active", validFrom: "2026-03-01", validTo: null, reason: null },
      { id: "a-1", contractId: "c-1", contractName: "Movimiento de residuos", contractCode: "CTR-2026-0001", contractStatus: "active", validFrom: "2026-01-01", validTo: "2026-02-28", reason: "Alta" },
    ])
  })
})
