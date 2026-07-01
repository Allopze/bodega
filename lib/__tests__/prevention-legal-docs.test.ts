import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { eq } from "drizzle-orm"
import { drizzle } from "drizzle-orm/pglite"
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest"
import { migratePGlite } from "@/lib/testing/pglite-migrate"
import * as schema from "@/db/schema"

const pg = new PGlite()
const inMemoryDb = drizzle(pg, { schema })
const testGlobal = globalThis as typeof globalThis & { __db?: typeof inMemoryDb }
// @ts-expect-error PGlite is compatible at runtime
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
  await inMemoryDb.delete(schema.documentSignatures)
  await inMemoryDb.delete(schema.documentDeliveries)
  await inMemoryDb.delete(schema.legalDocumentVersions)
  await inMemoryDb.delete(schema.legalDocuments)
  await inMemoryDb.delete(schema.users)

  await inMemoryDb.insert(schema.users).values({
    id: "user-1",
    name: "Legal",
    email: "legal@example.test",
    hashedPassword: "x",
  })
  await inMemoryDb.insert(schema.users).values({
    id: "user-2",
    name: "Legal 2",
    email: "legal2@example.test",
    hashedPassword: "x",
  })
})

describe("prevention legal docs", () => {
  it("addDocumentVersion: assigns consecutive versions on sequential inserts", async () => {
    const { createLegalDocument, addDocumentVersion } = await import("@/lib/services/prevention-legal-docs")
    const doc = await createLegalDocument({
      type: "RIOH",
      code: "RIOH-001",
      title: "Reglamento interno",
    })
    expect(doc).toBeTruthy()

    const v1 = await addDocumentVersion({
      documentId: doc!.id,
      effectiveFrom: "2026-01-01",
      changelog: "Versión inicial",
    }, "user-1")
    const v2 = await addDocumentVersion({
      documentId: doc!.id,
      effectiveFrom: "2026-06-01",
      changelog: "Actualización semestral",
    }, "user-1")
    const v3 = await addDocumentVersion({
      documentId: doc!.id,
      effectiveFrom: "2026-09-01",
      changelog: "Cambio menor",
    }, "user-1")

    expect(v1!.version).toBe(1)
    expect(v2!.version).toBe(2)
    expect(v3!.version).toBe(3)
  })

  it("addDocumentVersion: concurrent inserts produce unique consecutive versions (no race)", async () => {
    const { createLegalDocument, addDocumentVersion } = await import("@/lib/services/prevention-legal-docs")
    const doc = await createLegalDocument({
      type: "ODI",
      code: "ODI-001",
      title: "Obligación de informar",
    })

    // Two inserts in parallel — both should succeed and produce version 1 and 2
    // (deterministic ordering is not guaranteed; the unique index forces a retry
    // path which the atomic INSERT...SELECT avoids by serializing in the DB).
    const results = await Promise.all([
      addDocumentVersion({
        documentId: doc!.id,
        effectiveFrom: "2026-01-01",
      }, "user-1"),
      addDocumentVersion({
        documentId: doc!.id,
        effectiveFrom: "2026-01-01",
      }, "user-2"),
    ])

    const versions = results.map((r) => r!.version).sort((a, b) => a - b)
    expect(versions).toEqual([1, 2])

    // Database has exactly two rows for this doc.
    const rows = await inMemoryDb
      .select()
      .from(schema.legalDocumentVersions)
      .where(eq(schema.legalDocumentVersions.documentId, doc!.id))
    expect(rows).toHaveLength(2)
    expect(new Set(rows.map((r) => r.version))).toEqual(new Set([1, 2]))
  })
})
