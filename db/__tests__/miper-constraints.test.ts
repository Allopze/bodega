import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { eq, sql } from "drizzle-orm"
import { beforeAll, describe, expect, it } from "vitest"
import * as schema from "@/db/schema"
import { migratePGlite } from "@/lib/testing/pglite-migrate"

const pg = new PGlite()
const db = drizzle(pg, { schema })

beforeAll(async () => {
  await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))
  await db.insert(schema.worksites).values({ id: "ws-c", name: "Faena C", code: "C-1", commune: "Cabrero" })
  await db.insert(schema.users).values({ id: "u-c", name: "Autora", email: "a@c.cl", hashedPassword: "x", isActive: true })
  await db.insert(schema.preventionRiskMethodologies).values({ id: "m-c", code: "RE-04-CHOME", name: "RE-04", versionLabel: "REV-2026", kind: "primary", authoritySource: "RE-04", createdByUserId: "u-c" })
  await db.insert(schema.preventionRiskMatrices).values({
    id: "mx-c", worksiteId: "ws-c", matrixVersion: 1, title: "MIPER C 2026", period: 2026, methodologyId: "m-c", methodologySnapshot: {},
    revisionReason: "Elaboración inicial del período.", participationSummary: "", consultationEvidenceReference: "", createdByUserId: "u-c",
  })
}, 60_000)

async function insertEntry(id: string, probability: number | null, consequence: number | null) {
  await db.insert(schema.preventionRiskEntries).values({ id, matrixId: "mx-c", rowNumber: 1, hazardCode: `R-${id}`, probability, consequence })
}

/** Drizzle envuelve el error de Postgres; el mensaje del trigger viaja en `cause`. */
async function expectImmutable(operation: Promise<unknown>) {
  const error = await operation.then(() => null, (err: unknown) => err as Error & { cause?: Error })
  expect(error, "la operación debía rechazarse").not.toBeNull()
  expect(`${error!.message} ${error!.cause?.message ?? ""}`).toMatch(/inmutables/)
}

describe("restricciones MIPER F1", () => {
  it("MR y clasificación son columnas generadas y se recalculan", async () => {
    await insertEntry("e-gen", 2, 4)
    let [row] = await db.select().from(schema.preventionRiskEntries).where(eq(schema.preventionRiskEntries.id, "e-gen"))
    expect(row).toMatchObject({ magnitude: 8, classification: "important" })
    await db.update(schema.preventionRiskEntries).set({ consequence: 1 }).where(eq(schema.preventionRiskEntries.id, "e-gen"))
    ;[row] = await db.select().from(schema.preventionRiskEntries).where(eq(schema.preventionRiskEntries.id, "e-gen"))
    expect(row).toMatchObject({ magnitude: 2, classification: "tolerable" })
    await insertEntry("e-null", null, 4)
    ;[row] = await db.select().from(schema.preventionRiskEntries).where(eq(schema.preventionRiskEntries.id, "e-null"))
    expect(row).toMatchObject({ magnitude: null, classification: null })
  })

  it("P y C sólo admiten 1, 2 o 4", async () => {
    await expect(insertEntry("e-bad", 3, 2)).rejects.toThrow()
  })

  it("siembra el catálogo de factores de riesgo del RE-04", async () => {
    const rows = await db.select().from(schema.preventionRiskFactors)
    expect(rows.map((r) => r.code)).toEqual(expect.arrayContaining(["locativo", "mecanico", "fisico", "quimico", "biologico", "electrico", "ergonomico", "psicosocial"]))
  })

  it("encabezado: fecha de actualización y dotación coherentes", async () => {
    await expect(db.update(schema.preventionRiskMatrices).set({ elaboratedOn: "2026-05-01", updatedOn: "2026-04-01" }).where(eq(schema.preventionRiskMatrices.id, "mx-c"))).rejects.toThrow()
    await expect(db.update(schema.preventionRiskMatrices).set({ headcountTotal: 16, headcountMale: 10, headcountFemale: 2, headcountOther: 0 }).where(eq(schema.preventionRiskMatrices.id, "mx-c"))).rejects.toThrow()
    await db.update(schema.preventionRiskMatrices).set({ headcountTotal: 16, headcountMale: 14, headcountFemale: 2, headcountOther: 0 }).where(eq(schema.preventionRiskMatrices.id, "mx-c"))
  })

  it("estados: sólo draft, published o superseded; review_state válido", async () => {
    await expect(db.update(schema.preventionRiskMatrices).set({ status: "reviewed" }).where(eq(schema.preventionRiskMatrices.id, "mx-c"))).rejects.toThrow()
    await expect(db.update(schema.preventionRiskMatrices).set({ reviewState: "approved" }).where(eq(schema.preventionRiskMatrices.id, "mx-c"))).rejects.toThrow()
  })

  it("un solo MIPER abierto por faena y período", async () => {
    await expect(db.insert(schema.preventionRiskMatrices).values({
      id: "mx-dup", worksiteId: "ws-c", matrixVersion: 2, title: "Duplicado", period: 2026, methodologyId: "m-c", methodologySnapshot: {},
      revisionReason: "Duplicado del período.", participationSummary: "", consultationEvidenceReference: "", createdByUserId: "u-c",
    })).rejects.toThrow()
  })

  it("una sola ronda abierta y las versiones selladas son inmutables", async () => {
    await db.insert(schema.preventionRiskReviewRounds).values({ id: "r1", matrixId: "mx-c", roundNumber: 1, stage: "technical", snapshot: {}, snapshotSha256: "a".repeat(64), submittedByUserId: "u-c" })
    await expect(db.insert(schema.preventionRiskReviewRounds).values({ id: "r2", matrixId: "mx-c", roundNumber: 2, stage: "technical", snapshot: {}, snapshotSha256: "b".repeat(64), submittedByUserId: "u-c" })).rejects.toThrow()
    await db.insert(schema.preventionRiskMatrixVersions).values({
      id: "v1", matrixId: "mx-c", versionNumber: 1, period: 2026, roundId: "r1", snapshot: {}, snapshotSha256: "a".repeat(64), changeSummary: "Emisión inicial del documento.",
      elaboratedByUserId: "u-c", technicalReviewerUserId: "u-c", approverUserId: "u-c", elaboratedByName: "A", technicalReviewerName: "A", approverName: "A",
    })
    await expectImmutable(db.update(schema.preventionRiskMatrixVersions).set({ changeSummary: "reescrito" }).where(eq(schema.preventionRiskMatrixVersions.id, "v1")))
    await expectImmutable(db.execute(sql`DELETE FROM prevention_risk_matrix_versions WHERE id = 'v1'`))
  })
})
