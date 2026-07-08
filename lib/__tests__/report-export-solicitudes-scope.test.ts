import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import path from "node:path"
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest"
import type { Session } from "next-auth"
import * as schema from "@/db/schema"
import { migratePGlite } from "@/lib/testing/pglite-migrate"

const pg = new PGlite()
const inMemoryDb = drizzle(pg, { schema })
const testGlobal = globalThis as typeof globalThis & { __db?: typeof inMemoryDb }
// @ts-expect-error — PGlite is structurally compatible at runtime
testGlobal.__db = inMemoryDb

vi.mock("@/db", () => ({
  get db() {
    return testGlobal.__db
  },
}))

await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))

import { solicitudesList } from "@/lib/reports/export-module/solicitudes"

function makeSession(user: Partial<Session["user"]>): Session {
  return {
    expires: "9999-12-31",
    user: {
      id: "u-self",
      name: "Solicitante",
      email: "sol@chome.cl",
      roles: [],
      permissions: [],
      worksiteIds: [],
      primaryWorksiteId: null,
      avatarColor: null,
      isActive: true,
      isGlobal: false,
      ...user,
    },
  }
}

describe("solicitudesList export scoping (H-3)", () => {
  beforeEach(async () => {
    await inMemoryDb.delete(schema.purchaseRequestItems)
    await inMemoryDb.delete(schema.purchaseRequests)
    await inMemoryDb.delete(schema.worksites)
    await inMemoryDb.delete(schema.users)

    await inMemoryDb.insert(schema.users).values([
      { id: "u-self", name: "Yo", email: "yo@chome.cl", hashedPassword: "x", isActive: true },
      { id: "u-other", name: "Otro", email: "otro@chome.cl", hashedPassword: "x", isActive: true },
    ])
    await inMemoryDb.insert(schema.worksites).values({ id: "ws-1", name: "Faena Uno", isActive: true })
    await inMemoryDb.insert(schema.purchaseRequests).values([
      { id: "req-self", code: "SOL-SELF", worksiteId: "ws-1", requesterId: "u-self", requestType: "epp", status: "submitted" },
      { id: "req-other", code: "SOL-OTHER", worksiteId: "ws-1", requesterId: "u-other", requestType: "epp", status: "submitted" },
    ])
  })

  afterAll(async () => {
    await pg.close()
  })

  it("view_own solo exporta las solicitudes propias, no las de compañeros de la misma faena", async () => {
    const session = makeSession({ permissions: ["requests:view_own"], worksiteIds: ["ws-1"] })
    const report = await solicitudesList(session, {}, 100)
    const codes = report.rows.map((r) => r[0])
    expect(codes).toContain("SOL-SELF")
    expect(codes).not.toContain("SOL-OTHER")
  })

  it("view_all exporta todas las solicitudes en alcance", async () => {
    const session = makeSession({
      permissions: ["requests:view_all"],
      isGlobal: true,
    })
    const report = await solicitudesList(session, {}, 100)
    const codes = report.rows.map((r) => r[0])
    expect(codes).toContain("SOL-SELF")
    expect(codes).toContain("SOL-OTHER")
  })
})
