import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { and, eq } from "drizzle-orm"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { migratePGlite } from "@/lib/testing/pglite-migrate"
import * as schema from "@/db/schema"

const pg = new PGlite()
const inMemoryDb = drizzle(pg, { schema })
const testGlobal = globalThis as typeof globalThis & { __db?: typeof inMemoryDb }
// @ts-expect-error PGlite es compatible en runtime con el cliente postgres-js que usa el singleton.
testGlobal.__db = inMemoryDb

const WORKSITE = "ws-approvals-test"

beforeAll(async () => {
  await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))
  const now = new Date().toISOString()
  await inMemoryDb.insert(schema.users).values([
    { id: "appr-author", email: "appr-author@chome.cl", name: "Autor", hashedPassword: "x", createdAt: now, updatedAt: now, isActive: true },
    { id: "appr-reviewer", email: "appr-reviewer@chome.cl", name: "Revisor", hashedPassword: "x", createdAt: now, updatedAt: now, isActive: true },
    { id: "appr-prevention", email: "appr-prevention@chome.cl", name: "Aprobador Prevención", hashedPassword: "x", createdAt: now, updatedAt: now, isActive: true },
    { id: "appr-operations", email: "appr-operations@chome.cl", name: "Aprobador Operaciones", hashedPassword: "x", createdAt: now, updatedAt: now, isActive: true },
    { id: "appr-dual", email: "appr-dual@chome.cl", name: "Aprobador con ambos permisos", hashedPassword: "x", createdAt: now, updatedAt: now, isActive: true },
    { id: "appr-legacy", email: "appr-legacy@chome.cl", name: "Aprobador legado (única firma)", hashedPassword: "x", createdAt: now, updatedAt: now, isActive: true },
  ])
  await inMemoryDb.insert(schema.worksites).values({ id: WORKSITE, name: "Faena Aprobaciones", code: "APPR-TEST", createdAt: now, updatedAt: now })
  await inMemoryDb.insert(schema.preventionRiskMethodologies).values({
    id: "appr-methodology", code: "APPR-TEST", name: "Metodología de prueba", versionLabel: "v1",
    kind: "primary", authoritySource: "Prueba", configuration: {}, isActive: true, createdByUserId: "appr-author", createdAt: now,
  })
})

afterAll(async () => {
  delete testGlobal.__db
  await pg.close()
})

const now = () => new Date().toISOString()

let nextMatrixVersion = 1

/** Inserta una matriz directo en el estado que interesa a cada prueba — el
 * ciclo draft→in_review→reviewed ya está probado en otras suites. Cada
 * matriz de la faena necesita su propio `matrixVersion` (unique por faena). */
async function insertMatrix(id: string, overrides: Partial<typeof schema.preventionRiskMatrices.$inferInsert> = {}) {
  const ts = now()
  const [matrix] = await inMemoryDb.insert(schema.preventionRiskMatrices).values({
    id, worksiteId: WORKSITE, matrixVersion: nextMatrixVersion++, title: `MIPER ${id}`,
    status: "reviewed", methodologyId: "appr-methodology", methodologySnapshot: {},
    revisionReason: "Prueba de doble aprobación.", participationSummary: "No aplica.", consultationEvidenceReference: `acta-${id}`,
    createdByUserId: "appr-author", reviewedByUserId: "appr-reviewer", reviewedAt: ts,
    version: 1, createdAt: ts, updatedAt: ts,
    ...overrides,
  }).returning()
  return matrix!
}

function access(userId: string, permissions: string[]) {
  return { userId, scope: { mode: "some" as const, ids: [WORKSITE] }, permissions }
}

const prevention = access("appr-prevention", ["prevention:risk:approve_prevention"])
const operations = access("appr-operations", ["prevention:risk:approve_operations"])

describe("Doble aprobación MIPER — Prevención + Operaciones (§48-51, PGlite)", () => {
  it("cuando ambos dominios firman 'approved', la matriz pasa a 'approved' en la transacción que cierra el par", async () => {
    const service = await import("@/lib/services/prevention-risk-legal")
    const matrix = await insertMatrix("appr-matrix-both")

    const first = await service.decideRiskMatrixApproval({ matrixId: matrix.id, expectedVersion: 1, domain: "prevention", decision: "approved", reason: "Prevención aprueba esta versión." }, prevention)
    // La firma de un solo dominio no toca la matriz: ninguna fila de
    // prevention_risk_matrices cambió todavía.
    expect(first.complete).toBe(false)
    expect(first.matrix.status).toBe("reviewed")
    expect(first.matrix.version).toBe(1)

    const second = await service.decideRiskMatrixApproval({ matrixId: matrix.id, expectedVersion: 1, domain: "operations", decision: "approved", reason: "Operaciones aprueba esta versión." }, operations)
    expect(second.complete).toBe(true)
    expect(second.matrix).toMatchObject({ status: "approved", version: 2 })

    const rows = await inMemoryDb.select().from(schema.preventionRiskMatrixApprovals).where(eq(schema.preventionRiskMatrixApprovals.matrixId, matrix.id))
    expect(rows).toHaveLength(2)
    expect(rows.map((row) => row.domain).sort()).toEqual(["operations", "prevention"])
    expect(rows.every((row) => row.decision === "approved" && !row.migratedFromLegacy)).toBe(true)
  })

  it("un 'rejected' de cualquiera de los dos borra ambas firmas y devuelve la matriz a 'draft'", async () => {
    const service = await import("@/lib/services/prevention-risk-legal")
    const matrix = await insertMatrix("appr-matrix-reject")

    await service.decideRiskMatrixApproval({ matrixId: matrix.id, expectedVersion: 1, domain: "prevention", decision: "approved", reason: "Prevención aprueba esta versión." }, prevention)
    const rejected = await service.decideRiskMatrixApproval({ matrixId: matrix.id, expectedVersion: 1, domain: "operations", decision: "rejected", reason: "Operaciones detecta un control sin responsable." }, operations)

    expect(rejected.complete).toBe(false)
    expect(rejected.matrix).toMatchObject({ status: "draft" })
    expect(rejected.matrix.reviewedByUserId).toBeNull()

    const rows = await inMemoryDb.select().from(schema.preventionRiskMatrixApprovals).where(eq(schema.preventionRiskMatrixApprovals.matrixId, matrix.id))
    expect(rows).toHaveLength(0)
  })

  it("el índice único (matrix_id, domain) impide una segunda fila para el mismo dominio", async () => {
    const matrix = await insertMatrix("appr-matrix-unique")
    const ts = now()
    await inMemoryDb.insert(schema.preventionRiskMatrixApprovals).values({ id: "miperapproval-unique-1", matrixId: matrix.id, domain: "prevention", decision: "approved", userId: "appr-prevention", reason: "Primera firma.", decidedAt: ts })
    await expect(inMemoryDb.insert(schema.preventionRiskMatrixApprovals).values({ id: "miperapproval-unique-2", matrixId: matrix.id, domain: "prevention", decision: "approved", userId: "appr-prevention", reason: "Segunda firma del mismo dominio.", decidedAt: ts }))
      .rejects.toThrow()
  })

  it("la capa de servicio rechaza una segunda decisión sobre un dominio que ya se pronunció", async () => {
    const service = await import("@/lib/services/prevention-risk-legal")
    const matrix = await insertMatrix("appr-matrix-double-domain")
    await service.decideRiskMatrixApproval({ matrixId: matrix.id, expectedVersion: 1, domain: "prevention", decision: "approved", reason: "Primera firma de Prevención." }, prevention)
    await expect(service.decideRiskMatrixApproval({ matrixId: matrix.id, expectedVersion: 1, domain: "prevention", decision: "approved", reason: "Intento de firmar de nuevo el mismo dominio." }, prevention))
      .rejects.toThrow(/ya se pronunció/i)
  })

  it("el mismo usuario no puede firmar los dos dominios sin la excepción de segregación", async () => {
    const service = await import("@/lib/services/prevention-risk-legal")
    const matrix = await insertMatrix("appr-matrix-dual-user")
    const dual = access("appr-dual", ["prevention:risk:approve_prevention", "prevention:risk:approve_operations"])
    await service.decideRiskMatrixApproval({ matrixId: matrix.id, expectedVersion: 1, domain: "prevention", decision: "approved", reason: "Firma de Prevención." }, dual)

    await expect(service.decideRiskMatrixApproval({ matrixId: matrix.id, expectedVersion: 1, domain: "operations", decision: "approved", reason: "Firma de Operaciones del mismo usuario." }, dual))
      .rejects.toThrow(/segregada/i)

    const dualWithOverride = access("appr-dual", ["prevention:risk:approve_prevention", "prevention:risk:approve_operations", "prevention:risk:override_segregation"])
    const completed = await service.decideRiskMatrixApproval({
      matrixId: matrix.id, expectedVersion: 1, domain: "operations", decision: "approved",
      reason: "Firma de Operaciones del mismo usuario.", segregationExceptionReason: "Excepción autorizada: faena remota sin segundo firmante disponible.",
    }, dualWithOverride)
    expect(completed.complete).toBe(true)
    expect(completed.matrix.status).toBe("approved")
  })

  it("una matriz 'published' rechaza nuevas decisiones de aprobación", async () => {
    const service = await import("@/lib/services/prevention-risk-legal")
    const matrix = await insertMatrix("appr-matrix-published", { status: "published", approvedByUserId: "appr-legacy", approvedAt: now(), publishedByUserId: "appr-legacy", publishedAt: now(), effectiveFrom: "2026-01-01" })
    await expect(service.decideRiskMatrixApproval({ matrixId: matrix.id, expectedVersion: 1, domain: "prevention", decision: "approved", reason: "Intento tardío de firmar." }, prevention))
      .rejects.toThrow(/revisada/i)
  })

  it("borrar la matriz elimina en cascada sus filas de aprobación", async () => {
    const service = await import("@/lib/services/prevention-risk-legal")
    const matrix = await insertMatrix("appr-matrix-cascade")
    await service.decideRiskMatrixApproval({ matrixId: matrix.id, expectedVersion: 1, domain: "prevention", decision: "approved", reason: "Firma de Prevención." }, prevention)
    const before = await inMemoryDb.select().from(schema.preventionRiskMatrixApprovals).where(eq(schema.preventionRiskMatrixApprovals.matrixId, matrix.id))
    expect(before).toHaveLength(1)

    await inMemoryDb.delete(schema.preventionRiskMatrices).where(eq(schema.preventionRiskMatrices.id, matrix.id))
    const after = await inMemoryDb.select().from(schema.preventionRiskMatrixApprovals).where(eq(schema.preventionRiskMatrixApprovals.matrixId, matrix.id))
    expect(after).toHaveLength(0)
  })

  it("backfillRiskMatrixApprovals deriva 2 firmas 'migratedFromLegacy' para una matriz aprobada antes de esta tabla, y es idempotente", async () => {
    const service = await import("@/lib/services/prevention-risk-legal")
    const legacyApprovedAt = "2026-05-01T12:00:00.000Z"
    // Nota: `preventionRiskMatrices` ya exige por CHECK que toda fila
    // approved/published/superseded tenga `approvedByUserId` — el caso
    // "matriz sin approvedByUserId" que `skippedNoApprover` contempla no es
    // reproducible con datos reales, sólo defiende contra el tipo nullable.
    // 'superseded', no 'published': sólo puede haber una matriz 'published' por
    // faena a la vez y ese cupo ya lo ocupa appr-matrix-published.
    const matrix = await insertMatrix("appr-matrix-legacy", { status: "superseded", approvedByUserId: "appr-legacy", approvedAt: legacyApprovedAt })

    const result = await service.backfillRiskMatrixApprovals()
    expect(result.insertedRows).toBeGreaterThanOrEqual(2)

    const rows = await inMemoryDb.select().from(schema.preventionRiskMatrixApprovals).where(eq(schema.preventionRiskMatrixApprovals.matrixId, matrix.id))
    expect(rows).toHaveLength(2)
    for (const row of rows) {
      expect(row).toMatchObject({ decision: "approved", userId: "appr-legacy", migratedFromLegacy: true })
      // Postgres reformatea el timestamptz al devolverlo (offset de zona en
      // vez de "Z") — se compara el instante, no el string exacto.
      expect(new Date(row.decidedAt).getTime()).toBe(new Date(legacyApprovedAt).getTime())
    }

    // Idempotente: re-ejecutar no duplica filas para una matriz ya backfilleada.
    const second = await service.backfillRiskMatrixApprovals()
    expect(second.alreadyPresent).toContain(matrix.id)
    const rowsAfterRerun = await inMemoryDb.select().from(schema.preventionRiskMatrixApprovals).where(eq(schema.preventionRiskMatrixApprovals.matrixId, matrix.id))
    expect(rowsAfterRerun).toHaveLength(2)
  })

  it("invariante: toda matriz approved/published/superseded con approvedByUserId termina con exactamente 2 filas de aprobación tras el backfill", async () => {
    const service = await import("@/lib/services/prevention-risk-legal")
    await service.backfillRiskMatrixApprovals()
    const matrices = await inMemoryDb.select().from(schema.preventionRiskMatrices).where(and(
      eq(schema.preventionRiskMatrices.worksiteId, WORKSITE),
    ))
    for (const matrix of matrices) {
      if (!["approved", "published", "superseded"].includes(matrix.status) || !matrix.approvedByUserId) continue
      const rows = await inMemoryDb.select().from(schema.preventionRiskMatrixApprovals).where(eq(schema.preventionRiskMatrixApprovals.matrixId, matrix.id))
      expect(rows.length, `matriz ${matrix.id} (${matrix.status})`).toBe(2)
    }
  })
})
