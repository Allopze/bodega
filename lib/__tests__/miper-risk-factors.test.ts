import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { beforeAll, describe, expect, it, vi } from "vitest"
import * as schema from "@/db/schema"
import type { DB } from "@/db"
import { migratePGlite } from "@/lib/testing/pglite-migrate"

const pg = new PGlite()
const testDb = drizzle(pg, { schema }) as unknown as DB
const g = globalThis as typeof globalThis & { __db?: DB }
g.__db = testDb
vi.mock("@/db", () => ({ get db() { return g.__db } }))

const svc = await import("@/lib/services/miper/risk-factors")
const admin = { userId: "u-cat", scope: { mode: "all" as const, ids: [] as [] }, permissions: ["prevention:risk:catalog:manage"] }
const nobody = { userId: "u-no", scope: { mode: "all" as const, ids: [] as [] }, permissions: ["prevention:risk:view"] }

beforeAll(async () => {
  await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))
  await testDb.insert(schema.users).values({ id: "u-cat", name: "Catálogo", email: "c@c.cl", hashedPassword: "x", isActive: true })
}, 60_000)

describe("catálogo de factores de riesgo", () => {
  it("lista los sembrados, crea uno nuevo y rechaza código duplicado", async () => {
    expect((await svc.listRiskFactors()).length).toBeGreaterThanOrEqual(11)
    const { id } = await svc.saveRiskFactor({ code: "radiacion", name: "Radiación", sortOrder: 120 }, admin)
    expect((await svc.listRiskFactors()).find((f) => f.id === id)).toMatchObject({ name: "Radiación", isActive: true, usageCount: 0 })
    await expect(svc.saveRiskFactor({ code: "radiacion", name: "Otro nombre", sortOrder: 1 }, admin)).rejects.toThrow(/Ya existe/)
  })
  it("sin permiso de catálogo no escribe; desactivar no borra", async () => {
    await expect(svc.saveRiskFactor({ code: "x_y", name: "XY", sortOrder: 1 }, nobody)).rejects.toThrow(/fuera de alcance/)
    await svc.setRiskFactorActive({ id: "riskfactor-transito", isActive: false }, admin)
    expect((await svc.listRiskFactors()).find((f) => f.id === "riskfactor-transito")?.isActive).toBe(false)
  })
})
