import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { eq } from "drizzle-orm"
import path from "node:path"
import { beforeAll, describe, expect, it, vi } from "vitest"
import * as schema from "@/db/schema"
import { migratePGlite } from "@/lib/testing/pglite-migrate"

/**
 * Fusión del medio «Copec» con «TCT» (decisión 2026-11-16): Copec tiene dos flujos, la tarjeta del
 * equipo en la estación (TCT) y la carga a una vasija (TAE). El script simula por defecto, mueve
 * las cargas y los alias, desactiva «Copec», deja auditoría y es idempotente.
 */

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

await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))

const { applyCopecMedioTct, FROM_MEDIUM_ID, TO_MEDIUM_ID } = await import("../../scripts/apply-copec-medio-tct-2026-11-16")

const ACTOR = "qa-copec@example.cl"
const at = "2026-11-10T12:00:00.000Z"

function submission(id: string, supplyMediumId: string, liters: number) {
  return {
    id, clientSubmissionId: `client-${id}`, publicResultToken: `token-${id}`, source: "public_pwa", worksiteId: "ws-copec",
    vehicleId: "veh-copec", productId: "prod-copec", supplyMediumId, equipmentCodeSnapshot: "KA-1", loadedAt: at, submittedAt: at,
    driverNameSnapshot: "C", supervisorNameSnapshot: "S", meterType: "odometer", liters, status: "submitted",
  } as const
}

const mediumOf = async (id: string) => (await inMemoryDb.select().from(schema.fuelSupplyMedia).where(eq(schema.fuelSupplyMedia.id, id)))[0]!
const submissionMedium = async (id: string) => (await inMemoryDb.select({ m: schema.fuelTaeSubmissions.supplyMediumId }).from(schema.fuelTaeSubmissions).where(eq(schema.fuelTaeSubmissions.id, id)))[0]!.m

describe("medio «Copec» → «TCT»", () => {
  beforeAll(async () => {
    await inMemoryDb.insert(schema.worksites).values({ id: "ws-copec", name: "Faena Copec", code: "FC", isActive: true })
    await inMemoryDb.insert(schema.users).values({ id: "u-copec", name: "QA", email: ACTOR, hashedPassword: "x", isActive: true })
    await inMemoryDb.insert(schema.fuelEquipmentTypes).values({ id: "type-copec", slug: "camion-copec", name: "Camión" })
    await inMemoryDb.insert(schema.fuelVehicles).values({ id: "veh-copec", plate: "AB1234", code: "KA-1", type: "camion", equipmentTypeId: "type-copec", worksiteId: "ws-copec", isActive: true })
    await inMemoryDb.insert(schema.fuelProducts).values({ id: "prod-copec", code: "DIESEL-COPEC", name: "Diésel", category: "diesel", unit: "liter" })
    await inMemoryDb.insert(schema.fuelTaeSubmissions).values([submission("s-copec", FROM_MEDIUM_ID, 40), submission("s-tct", TO_MEDIUM_ID, 25)])
  })

  it("sin --apply sólo cuenta: no mueve cargas ni toca el catálogo", async () => {
    const outcome = await applyCopecMedioTct({ actorEmail: ACTOR })
    expect(outcome.result).toBe("dry-run")
    expect(outcome.counts.find((count) => count.table === "fuel_tae_submissions")).toEqual({ table: "fuel_tae_submissions", rows: 1, liters: 40 })
    expect(outcome.aliasesMoved).toEqual(["COPEC"])
    expect(await submissionMedium("s-copec")).toBe(FROM_MEDIUM_ID)
    expect((await mediumOf(FROM_MEDIUM_ID)).isActive).toBe(true)
  })

  it("con --apply pasa las cargas y los alias a TCT, desactiva «Copec» y deja auditoría", async () => {
    const outcome = await applyCopecMedioTct({ actorEmail: ACTOR, apply: true })
    expect(outcome.result).toBe("aplicado")
    expect(await submissionMedium("s-copec")).toBe(TO_MEDIUM_ID)
    expect(await submissionMedium("s-tct")).toBe(TO_MEDIUM_ID)
    const copec = await mediumOf(FROM_MEDIUM_ID)
    expect(copec.isActive).toBe(false)
    expect(copec.aliases).toEqual([])
    expect((await mediumOf(TO_MEDIUM_ID)).aliases).toContain("COPEC")
    const audit = await inMemoryDb.select().from(schema.auditLog).where(eq(schema.auditLog.entityType, "fuel_supply_medium"))
    expect(audit).toHaveLength(1)
    expect(audit[0]!.entityId).toBe(FROM_MEDIUM_ID)
  })

  it("una segunda corrida no hace nada", async () => {
    expect((await applyCopecMedioTct({ actorEmail: ACTOR, apply: true })).result).toBe("ya estaba")
    expect(await inMemoryDb.select().from(schema.auditLog).where(eq(schema.auditLog.entityType, "fuel_supply_medium"))).toHaveLength(1)
  })

  it("sin un responsable activo no corre", async () => {
    await expect(applyCopecMedioTct({ actorEmail: "nadie@example.cl" })).rejects.toThrow("la bitácora necesita un responsable")
  })
})
