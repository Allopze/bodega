import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { beforeAll, describe, expect, it } from "vitest"
import * as schema from "@/db/schema"
import { migratePGlite } from "@/lib/testing/pglite-migrate"

const pg = new PGlite()
const db = drizzle(pg, { schema })
;(globalThis as { __db?: unknown }).__db = db

beforeAll(async () => {
  await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))
  await db.insert(schema.users).values({
    id: "u1",
    name: "U1",
    email: "u1@e2e.cl",
    hashedPassword: "x",
    isActive: true,
  })
  await db.insert(schema.pdtpPrograms).values({
    id: "p1",
    year: 2026,
    version: 1,
    status: "draft",
    title: "P",
    elaboratedByName: "A",
    elaboratedByTitle: "B",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  })
  await db.insert(schema.pdtpProgramTemplates).values({
    id: "t1",
    code: "BASE",
    name: "Base",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  })
  await db.insert(schema.pdtpProgramTemplateVersions).values({
    id: "tv1",
    templateId: "t1",
    version: 1,
    sourceContentVersion: 1,
    contentDigest: "a".repeat(64),
    snapshotJson: {},
    publishedAt: new Date().toISOString(),
    createdAt: new Date().toISOString(),
  })
})

/**
 * Helper: vitest's `.toThrow(regex)` no inspecciona `cause`, así que hacemos
 * match manual sobre el mensaje del error y el de su `cause` (patrón de
 * `db/__tests__/pdtp-check-constraints.test.ts`).
 */
async function expectRejectionMatching(promise: Promise<unknown>, pattern: RegExp): Promise<void> {
  let thrown: unknown = null
  try {
    await promise
  } catch (e) {
    thrown = e
  }
  expect(thrown).toBeTruthy()
  const cause = (thrown as { cause?: { message?: string } }).cause
  const msg = `${(thrown as Error).message}\n${cause?.message ?? ""}`
  expect(msg).toMatch(pattern)
}

const row = (over: Partial<schema.NewPdtpRevisionDiffDecision> = {}): schema.NewPdtpRevisionDiffDecision => ({
  id: `d-${Math.random()}`,
  programId: "p1",
  baseTemplateVersionId: "tv1",
  activityIdentity: "PDT-001",
  decision: "kept",
  decidedByUserId: "u1",
  decidedAt: new Date().toISOString(),
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  ...over,
})

describe("pdtp_revision_diff_decisions", () => {
  it("una decisión es única por (programa, versión base, identidad)", async () => {
    await db.insert(schema.pdtpRevisionDiffDecisions).values(row())
    // Match contra el nombre exacto del índice único (db/migrations/0300_nifty_namorita.sql),
    // no un patrón genérico como /unique/i: ese patrón también lo satisface
    // cualquier otra violación de unicidad de la fila, sin probar que se trató
    // justo de la clave (programa, versión base, identidad).
    await expectRejectionMatching(
      db.insert(schema.pdtpRevisionDiffDecisions).values(row({ decision: "applied" })),
      /pdtp_revision_diff_decisions_program_base_identity_unique/,
    )
  })

  it("rechaza una decisión fuera de applied/kept", async () => {
    // Match contra el nombre exacto del CHECK (mismo archivo de migración), no
    // un patrón genérico como /check|constraint|violates/i: ese patrón lo
    // satisface casi cualquier violación (FK, NOT NULL...), así que el test
    // podría pasar sin haber llegado nunca al CHECK de `decision`.
    await expectRejectionMatching(
      db.insert(schema.pdtpRevisionDiffDecisions).values(row({ activityIdentity: "PDT-002", decision: "maybe" as never })),
      /pdtp_revision_diff_decisions_decision_check/,
    )
  })
})
