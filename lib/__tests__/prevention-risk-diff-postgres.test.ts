import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { migratePGlite } from "@/lib/testing/pglite-migrate"
import * as schema from "@/db/schema"

const pg = new PGlite()
const inMemoryDb = drizzle(pg, { schema })
const testGlobal = globalThis as typeof globalThis & { __db?: typeof inMemoryDb }
// @ts-expect-error PGlite es compatible en runtime con el cliente postgres-js que usa el singleton.
testGlobal.__db = inMemoryDb

const WORKSITE = "ws-diff-test"
const WORKSITE_OTHER = "ws-diff-other"

beforeAll(async () => {
  await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))
  const now = new Date().toISOString()
  await inMemoryDb.insert(schema.users).values({ id: "diff-author", email: "diff-author@chome.cl", name: "Autor", hashedPassword: "x", createdAt: now, updatedAt: now, isActive: true })
  await inMemoryDb.insert(schema.worksites).values([
    { id: WORKSITE, name: "Faena Diff", code: "DIFF-TEST", createdAt: now, updatedAt: now },
    { id: WORKSITE_OTHER, name: "Faena Diff Otra", code: "DIFF-OTHER", createdAt: now, updatedAt: now },
  ])
  await inMemoryDb.insert(schema.preventionRiskMethodologies).values({
    id: "diff-methodology", code: "DIFF-TEST", name: "Metodología de prueba", versionLabel: "v1",
    kind: "primary", authoritySource: "Prueba", configuration: {}, isActive: true, createdByUserId: "diff-author", createdAt: now,
  })
  await inMemoryDb.insert(schema.preventionRiskProcesses).values({ id: "diff-process", worksiteId: WORKSITE, code: "PROC", name: "Proceso", isActive: true, createdAt: now, updatedAt: now })
  await inMemoryDb.insert(schema.preventionRiskTasks).values({ id: "diff-task", processId: "diff-process", code: "TASK", name: "Tarea", isRoutine: true, isActive: true, createdAt: now, updatedAt: now })
  await inMemoryDb.insert(schema.preventionRiskPositions).values({ id: "diff-position", taskId: "diff-task", code: "POS", name: "Puesto", isActive: true, createdAt: now, updatedAt: now })
})

afterAll(async () => {
  delete testGlobal.__db
  await pg.close()
})

const now = () => new Date().toISOString()
let nextMatrixVersion = 1

async function insertMatrix(id: string, worksiteId = WORKSITE) {
  const ts = now()
  const [matrix] = await inMemoryDb.insert(schema.preventionRiskMatrices).values({
    id, worksiteId, matrixVersion: nextMatrixVersion++, title: `MIPER ${id}`,
    status: "draft", methodologyId: "diff-methodology", methodologySnapshot: {},
    revisionReason: "Prueba de comparación entre revisiones.", participationSummary: "No aplica.", consultationEvidenceReference: `acta-${id}`,
    createdByUserId: "diff-author", version: 1, createdAt: ts, updatedAt: ts,
  }).returning()
  return matrix!
}

const entryBase = {
  matrixId: "", processId: "diff-process", taskId: "diff-task", positionId: "diff-position",
  riskFactor: "Factor", expectedEventOrDamage: "Daño", exposedPeopleDescription: "Personal",
  genderConsiderations: "Sin diferencias.", sensitiveWorkerConsiderations: "Sin personas sensibles.",
  version: 1,
}

async function insertEntry(matrixId: string, args: { hazardCode: string; hazard: string; probability: number; consequence: number; responsibleSnapshot: string; controlDescription?: string }) {
  const ts = now()
  const riskMagnitude = args.probability * args.consequence
  const riskClassification = riskMagnitude <= 2 ? "tolerable" : riskMagnitude === 4 ? "moderado" : riskMagnitude === 8 ? "importante" : "intolerable"
  const [entry] = await inMemoryDb.insert(schema.preventionRiskEntries).values({
    ...entryBase, id: `diffentry-${matrixId}-${args.hazardCode}`, matrixId, hazardCode: args.hazardCode, hazard: args.hazard, risk: args.hazard,
    probability: args.probability, consequence: args.consequence, riskMagnitude, riskClassification,
    residualDimensions: {}, residualLevel: "medium", residualScore: riskMagnitude,
    responsibleSnapshot: args.responsibleSnapshot,
    createdAt: ts, updatedAt: ts,
  }).returning()
  if (args.controlDescription) {
    await inMemoryDb.insert(schema.preventionRiskControls).values({
      id: `diffcontrol-${entry!.id}`, riskEntryId: entry!.id, description: args.controlDescription, hierarchy: "engineering",
      isExisting: true, isCritical: false, responsibleSnapshot: args.responsibleSnapshot, status: "proposed", effectivenessStatus: "not_assessed",
      version: 1, createdAt: ts, updatedAt: ts,
    })
  }
  return entry!
}

describe("compareRiskMatrices — diff entre dos revisiones MIPER (§Fase 7, PGlite)", () => {
  it("clasifica agregado, eliminado, modificado (P/C) y sin cambios en una sola comparación", async () => {
    const service = await import("@/lib/services/prevention-risk-diff")
    const base = await insertMatrix("diff-matrix-base-1")
    const target = await insertMatrix("diff-matrix-target-1")

    await insertEntry(base.id, { hazardCode: "REMOVED-01", hazard: "Peligro que desaparece", probability: 1, consequence: 1, responsibleSnapshot: "R1" })
    await insertEntry(base.id, { hazardCode: "SAME-01", hazard: "Peligro sin cambios", probability: 2, consequence: 2, responsibleSnapshot: "R2" })
    await insertEntry(base.id, { hazardCode: "CHANGED-01", hazard: "Peligro que sube de probabilidad", probability: 1, consequence: 2, responsibleSnapshot: "R3" })

    await insertEntry(target.id, { hazardCode: "SAME-01", hazard: "Peligro sin cambios", probability: 2, consequence: 2, responsibleSnapshot: "R2" })
    await insertEntry(target.id, { hazardCode: "CHANGED-01", hazard: "Peligro que sube de probabilidad", probability: 4, consequence: 2, responsibleSnapshot: "R3" })
    await insertEntry(target.id, { hazardCode: "ADDED-01", hazard: "Peligro nuevo", probability: 1, consequence: 1, responsibleSnapshot: "R4" })

    const result = await service.compareRiskMatrices({ baseMatrixId: base.id, targetMatrixId: target.id, scope: { mode: "all", ids: [] }, permissions: ["prevention:risk:view"] })

    expect(result.summary).toEqual({ added: 1, removed: 1, modified: 1, unchanged: 1 })
    const byCode = new Map(result.entries.map((row) => [row.hazardCode, row]))
    expect(byCode.get("ADDED-01")).toMatchObject({ status: "added", base: null })
    expect(byCode.get("REMOVED-01")).toMatchObject({ status: "removed", target: null })
    expect(byCode.get("SAME-01")).toMatchObject({ status: "unchanged", fieldDiffs: [] })
    const changed = byCode.get("CHANGED-01")!
    expect(changed.status).toBe("modified")
    const fieldsChanged = changed.fieldDiffs.map((diff) => diff.field).sort()
    // Al subir P de 1 a 4, también cambian MR y la clasificación derivada.
    expect(fieldsChanged).toEqual(["probability", "riskClassification", "riskMagnitude"])
    expect(changed.fieldDiffs.find((diff) => diff.field === "probability")).toMatchObject({ before: 1, after: 4 })
  })

  it("detecta un cambio de medida de control aunque P y C no cambien", async () => {
    const service = await import("@/lib/services/prevention-risk-diff")
    const base = await insertMatrix("diff-matrix-base-2")
    const target = await insertMatrix("diff-matrix-target-2")
    await insertEntry(base.id, { hazardCode: "CTRL-01", hazard: "Peligro con control que cambia", probability: 2, consequence: 2, responsibleSnapshot: "R1", controlDescription: "Control antiguo" })
    await insertEntry(target.id, { hazardCode: "CTRL-01", hazard: "Peligro con control que cambia", probability: 2, consequence: 2, responsibleSnapshot: "R1", controlDescription: "Control nuevo, más estricto" })

    const result = await service.compareRiskMatrices({ baseMatrixId: base.id, targetMatrixId: target.id, scope: { mode: "all", ids: [] }, permissions: ["prevention:risk:view"] })
    expect(result.summary).toMatchObject({ modified: 1, added: 0, removed: 0 })
    expect(result.entries[0]!.fieldDiffs).toEqual([{ field: "controls", before: "Control antiguo", after: "Control nuevo, más estricto" }])
  })

  it("rechaza comparar dos versiones de faenas distintas", async () => {
    const service = await import("@/lib/services/prevention-risk-diff")
    const base = await insertMatrix("diff-matrix-base-3", WORKSITE)
    const target = await insertMatrix("diff-matrix-target-3", WORKSITE_OTHER)
    await expect(service.compareRiskMatrices({ baseMatrixId: base.id, targetMatrixId: target.id, scope: { mode: "all", ids: [] }, permissions: ["prevention:risk:view"] }))
      .rejects.toThrow(/misma faena/i)
  })

  it("rechaza comparar una versión consigo misma", async () => {
    const service = await import("@/lib/services/prevention-risk-diff")
    const matrix = await insertMatrix("diff-matrix-self")
    await expect(service.compareRiskMatrices({ baseMatrixId: matrix.id, targetMatrixId: matrix.id, scope: { mode: "all", ids: [] }, permissions: ["prevention:risk:view"] }))
      .rejects.toThrow(/dos versiones distintas/i)
  })
})
