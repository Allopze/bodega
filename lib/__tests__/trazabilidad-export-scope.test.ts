import Database from "better-sqlite3"
import { drizzle } from "drizzle-orm/better-sqlite3"
import { migrate } from "drizzle-orm/better-sqlite3/migrator"
import path from "node:path"
import { afterAll, describe, expect, it, vi } from "vitest"
import * as schema from "@/db/schema"

const sqlite = new Database(":memory:")
sqlite.pragma("foreign_keys = ON")
const inMemoryDb = drizzle(sqlite, { schema })
const testGlobal = globalThis as typeof globalThis & { __db?: typeof inMemoryDb }

testGlobal.__db = inMemoryDb

vi.mock("@/lib/auth/auth", () => ({ auth: vi.fn() }))

vi.mock("@/db", () => ({
  get db() {
    return testGlobal.__db
  },
}))

migrate(inMemoryDb, { migrationsFolder: path.resolve(process.cwd(), "db/migrations") })

import { buildTrazabilidadRows } from "@/lib/services/trazabilidad-export"

describe("trazabilidad export scoping", () => {
  afterAll(() => {
    sqlite.close()
  })

  it("returns only rows for worksites visible to a scoped session", async () => {
    const now = new Date().toISOString()
    const userId = "user-scoped"

    await inMemoryDb.insert(schema.users).values({
      id: userId,
      name: "Usuario Faena",
      email: "faena@chome.cl",
      hashedPassword: "hashed_password_placeholder",
      isActive: true,
      createdAt: now,
      updatedAt: now,
    }).run()

    await inMemoryDb.insert(schema.worksites).values([
      {
        id: "ws-visible",
        name: "Faena Visible",
        code: "F-VISIBLE",
        isActive: true,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: "ws-hidden",
        name: "Faena Oculta",
        code: "F-OCULTA",
        isActive: true,
        createdAt: now,
        updatedAt: now,
      },
    ]).run()

    await inMemoryDb.insert(schema.purchaseRequests).values([
      {
        id: "req-visible",
        code: "SOL-2026-VISIBLE",
        worksiteId: "ws-visible",
        requesterId: userId,
        status: "submitted",
        createdAt: now,
        updatedAt: now,
      },
      {
        id: "req-hidden",
        code: "SOL-2026-OCULTA",
        worksiteId: "ws-hidden",
        requesterId: userId,
        status: "submitted",
        createdAt: now,
        updatedAt: now,
      },
    ]).run()

    await inMemoryDb.insert(schema.purchaseRequestItems).values([
      {
        id: "item-visible",
        requestId: "req-visible",
        productNameFree: "Guantes visibles",
        quantity: 3,
        unitOfMeasure: "par",
        status: "approved",
        createdAt: now,
        updatedAt: now,
      },
      {
        id: "item-hidden",
        requestId: "req-hidden",
        productNameFree: "Guantes ocultos",
        quantity: 7,
        unitOfMeasure: "par",
        status: "approved",
        createdAt: now,
        updatedAt: now,
      },
    ]).run()

    const rows = await buildTrazabilidadRows(scopedSession(["ws-visible"]))

    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      productName: "Guantes visibles",
      worksiteName: "Faena Visible",
      requestCode: "SOL-2026-VISIBLE",
      requested: 3,
    })
  })
})

function scopedSession(worksiteIds: string[]): Parameters<typeof buildTrazabilidadRows>[0] {
  return {
    expires: new Date(Date.now() + 60_000).toISOString(),
    user: {
      id: "user-scoped",
      name: "Usuario Faena",
      email: "faena@chome.cl",
      roles: ["solicitante_faena"],
      permissions: ["reports:view"],
      worksiteIds,
      primaryWorksiteId: worksiteIds[0] ?? null,
      avatarColor: null,
      isActive: true,
    },
  }
}
