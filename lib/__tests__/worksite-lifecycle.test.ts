import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { eq } from "drizzle-orm"
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest"
import { migratePGlite } from "@/lib/testing/pglite-migrate"
import * as schema from "@/db/schema"
import type { DB } from "@/db"

const pg = new PGlite()
const pgLiteDb = drizzle(pg, { schema })
const inMemoryDb = pgLiteDb as unknown as DB
const testGlobal = globalThis as typeof globalThis & { __db?: DB }
testGlobal.__db = inMemoryDb

vi.mock("@/db", () => ({ get db() { return testGlobal.__db } }))

await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))

const now = "2026-08-14T12:00:00.000Z"

afterAll(async () => {
  delete testGlobal.__db
  await pg.close()
})

beforeEach(async () => {
  await inMemoryDb.delete(schema.auditLog)
  await inMemoryDb.delete(schema.preventionCapaTransitions)
  await inMemoryDb.delete(schema.preventionCapaActions)
  await inMemoryDb.delete(schema.pdtpProgramWorksites)
  await inMemoryDb.delete(schema.pdtpPrograms)
  await inMemoryDb.delete(schema.worksites)
  await inMemoryDb.delete(schema.users)

  await inMemoryDb.insert(schema.users).values({
    id: "actor-1", name: "Admin", email: "admin@example.test", hashedPassword: "x",
  })
  await inMemoryDb.insert(schema.worksites).values({
    id: "ws-life", name: "Faena a cerrar", code: "LIFE", isActive: true,
  })
  await inMemoryDb.insert(schema.pdtpPrograms).values({
    id: "prog-life", year: 2026, version: 1, title: "Programa", status: "active",
    elaboratedByName: "Test", elaboratedByTitle: "Prevención", createdAt: now, updatedAt: now,
  })
  await inMemoryDb.insert(schema.pdtpProgramWorksites).values({
    id: "pw-life", programId: "prog-life", worksiteId: "ws-life", isActive: true, addedAt: now,
  })
  await inMemoryDb.insert(schema.preventionCapaActions).values([
    {
      id: "capa-life-open", code: "CAPA-2026-9101", sourceType: "manual", sourceId: "x",
      worksiteId: "ws-life", finding: "Hallazgo abierto", actionDescription: "Corregir",
      priority: "medium", targetDate: "2026-09-01", status: "in_progress",
      createdByUserId: "actor-1", createdAt: now, updatedAt: now,
    },
    {
      id: "capa-life-verified", code: "CAPA-2026-9102", sourceType: "manual", sourceId: "y",
      worksiteId: "ws-life", finding: "Hallazgo resuelto", actionDescription: "Conservar",
      priority: "low", targetDate: "2026-07-01", status: "verified",
      createdByUserId: "actor-1", createdAt: now, updatedAt: now,
    },
  ])
})

describe("worksite lifecycle", () => {
  it("cierra membresía, CAPA y faena en una sola operación auditada", async () => {
    const { setWorksiteActive } = await import("@/lib/services/worksite-lifecycle")
    const result = await setWorksiteActive({
      worksiteId: "ws-life",
      activate: false,
      reason: "Término definitivo del contrato principal.",
      actorUserId: "actor-1",
      actorEmail: "admin@example.test",
      scope: { mode: "all", ids: [] },
    })

    expect(result).toMatchObject({ programsDropped: 1, capaCancelled: 1 })
    const [worksite] = await inMemoryDb.select().from(schema.worksites).where(eq(schema.worksites.id, "ws-life"))
    const [membership] = await inMemoryDb.select().from(schema.pdtpProgramWorksites)
      .where(eq(schema.pdtpProgramWorksites.worksiteId, "ws-life"))
    const capas = await inMemoryDb.select().from(schema.preventionCapaActions)
    const transitions = await inMemoryDb.select().from(schema.preventionCapaTransitions)
    const audits = await inMemoryDb.select().from(schema.auditLog)

    expect(worksite?.isActive).toBe(false)
    expect(membership?.isActive).toBe(false)
    expect(capas.find((row) => row.id === "capa-life-open")).toMatchObject({
      status: "cancelled", cancelledByUserId: "actor-1", version: 2,
    })
    expect(capas.find((row) => row.id === "capa-life-verified")?.status).toBe("verified")
    expect(transitions).toHaveLength(1)
    expect(audits.some((row) => row.entityId === "ws-life")).toBe(true)
  })

  it("revierte todo si una escritura del cierre falla", async () => {
    const { setWorksiteActive } = await import("@/lib/services/worksite-lifecycle")
    await expect(setWorksiteActive({
      worksiteId: "ws-life",
      activate: false,
      reason: "Término definitivo del contrato principal.",
      actorUserId: "actor-inexistente",
      scope: { mode: "all", ids: [] },
    })).rejects.toThrow()

    const [worksite] = await inMemoryDb.select().from(schema.worksites).where(eq(schema.worksites.id, "ws-life"))
    const [membership] = await inMemoryDb.select().from(schema.pdtpProgramWorksites)
      .where(eq(schema.pdtpProgramWorksites.worksiteId, "ws-life"))
    const [capa] = await inMemoryDb.select().from(schema.preventionCapaActions)
      .where(eq(schema.preventionCapaActions.id, "capa-life-open"))

    expect(worksite?.isActive).toBe(true)
    expect(membership?.isActive).toBe(true)
    expect(capa?.status).toBe("in_progress")
  })
})
