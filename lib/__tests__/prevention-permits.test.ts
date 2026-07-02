import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest"
import { migratePGlite } from "@/lib/testing/pglite-migrate"
import * as schema from "@/db/schema"

const pg = new PGlite()
const inMemoryDb = drizzle(pg, { schema })
const testGlobal = globalThis as typeof globalThis & { __db?: typeof inMemoryDb }
// @ts-expect-error PGlite is compatible with the app DB shape in tests.
testGlobal.__db = inMemoryDb

vi.mock("@/db", () => ({
  get db() {
    return testGlobal.__db
  },
}))

await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))

afterAll(async () => {
  delete testGlobal.__db
  await pg.close()
})

beforeEach(async () => {
  await inMemoryDb.delete(schema.permitSignoffs)
  await inMemoryDb.delete(schema.permitAttachments)
  await inMemoryDb.delete(schema.permitRequests)
  await inMemoryDb.delete(schema.permitTemplates)
  await inMemoryDb.delete(schema.worksites)
  await inMemoryDb.delete(schema.users)

  await inMemoryDb.insert(schema.users).values({
    id: "user-1", name: "Prevencionista", email: "prev@example.test", hashedPassword: "x",
  })
  await inMemoryDb.insert(schema.worksites).values([
    { id: "ws-1", name: "Faena A", code: "FA", isActive: true },
    { id: "ws-2", name: "Faena B", code: "FB", isActive: true },
  ])
})

describe("prevention permits service (P3.21)", () => {
  it("runs the full lifecycle: template -> request -> approve -> sign", async () => {
    const {
      createPermitTemplate, createPermitRequest, approvePermitRequest, signPermit, listSignoffsForPermits,
    } = await import("@/lib/services/prevention-permits")

    const template = await createPermitTemplate({
      code: "AST-ALTURA-01",
      title: "AST trabajo en altura",
      riskType: "altura",
      astFields: {},
      validityHours: 24,
      requiresSignoff: { prevencionista: true, jefe_terreno: true },
    })

    const request = await createPermitRequest({
      templateId: template.id,
      worksiteId: "ws-1",
      task: "Mantención de antena",
      location: "Torre norte",
      plannedStart: "2026-07-01T08:00:00.000Z",
      plannedEnd: "2026-07-01T12:00:00.000Z",
      ast: {},
    }, "user-1", ["ws-1"])
    expect(request.status).toBe("solicitado")

    const approved = await approvePermitRequest(request.id, "user-1", ["ws-1"])
    expect(approved.status).toBe("aprobado")

    await signPermit({ permitId: request.id, role: "prevencionista", signature: "Juan Perez, 11.111.111-1" }, "user-1", ["ws-1"])
    await signPermit({ permitId: request.id, role: "jefe_terreno", signature: "Ana Soto, 22.222.222-2" }, "user-1", ["ws-1"])

    const signoffs = await listSignoffsForPermits([request.id])
    expect(signoffs.map((s) => s.role).sort()).toEqual(["jefe_terreno", "prevencionista"])
  })

  it("denies approving a permit outside the caller's worksite scope", async () => {
    const { createPermitTemplate, createPermitRequest, approvePermitRequest } = await import("@/lib/services/prevention-permits")

    const template = await createPermitTemplate({
      code: "AST-CALIENTE-01",
      title: "AST trabajo en caliente",
      riskType: "caliente",
      astFields: {},
      requiresSignoff: {},
    })
    const request = await createPermitRequest({
      templateId: template.id,
      worksiteId: "ws-2",
      task: "Soldadura",
      location: "Taller",
      plannedStart: "2026-07-01T08:00:00.000Z",
      plannedEnd: "2026-07-01T09:00:00.000Z",
      ast: {},
    }, "user-1", ["ws-2"])

    await expect(approvePermitRequest(request.id, "user-1", ["ws-1"])).rejects.toThrow(/sin acceso/i)
  })

  it("denies signing a permit outside the caller's worksite scope", async () => {
    const { createPermitTemplate, createPermitRequest, signPermit } = await import("@/lib/services/prevention-permits")

    const template = await createPermitTemplate({
      code: "AST-IZAJES-01",
      title: "AST izaje",
      riskType: "izaje",
      astFields: {},
      requiresSignoff: {},
    })
    const request = await createPermitRequest({
      templateId: template.id,
      worksiteId: "ws-2",
      task: "Izaje carga",
      location: "Patio",
      plannedStart: "2026-07-01T08:00:00.000Z",
      plannedEnd: "2026-07-01T09:00:00.000Z",
      ast: {},
    }, "user-1", ["ws-2"])

    await expect(signPermit({
      permitId: request.id,
      role: "prevencionista",
      signature: "Juan Perez, 11.111.111-1",
    }, "user-1", ["ws-1"])).rejects.toThrow(/sin acceso/i)
  })

  it("rejects approving twice (idempotent status transition)", async () => {
    const { createPermitTemplate, createPermitRequest, approvePermitRequest } = await import("@/lib/services/prevention-permits")

    const template = await createPermitTemplate({
      code: "AST-EXCAVACION-01",
      title: "AST excavación",
      riskType: "excavacion",
      astFields: {},
      requiresSignoff: {},
    })
    const request = await createPermitRequest({
      templateId: template.id,
      worksiteId: "ws-1",
      task: "Zanja",
      location: "Sector C",
      plannedStart: "2026-07-01T08:00:00.000Z",
      plannedEnd: "2026-07-01T09:00:00.000Z",
      ast: {},
    }, "user-1", ["ws-1"])

    await approvePermitRequest(request.id, "user-1", ["ws-1"])
    await expect(approvePermitRequest(request.id, "user-1", ["ws-1"])).rejects.toThrow(/ya fue procesado/i)
  })
})
