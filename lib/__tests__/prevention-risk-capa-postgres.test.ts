import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { eq } from "drizzle-orm"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { migratePGlite } from "@/lib/testing/pglite-migrate"
import * as schema from "@/db/schema"

const pg = new PGlite()
const inMemoryDb = drizzle(pg, { schema })
const testGlobal = globalThis as typeof globalThis & { __db?: typeof inMemoryDb }
// @ts-expect-error PGlite es compatible en runtime con el cliente postgres-js que usa el singleton.
testGlobal.__db = inMemoryDb

const WORKSITE = "ws-capa-test"

beforeAll(async () => {
  await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))
  const now = new Date().toISOString()
  await inMemoryDb.insert(schema.users).values([
    { id: "capa-test-author", email: "capa-author@chome.cl", name: "Autor CAPA", hashedPassword: "x", createdAt: now, updatedAt: now, isActive: true },
    { id: "capa-test-responsible-active", email: "capa-responsible@chome.cl", name: "Responsable Activo", hashedPassword: "x", createdAt: now, updatedAt: now, isActive: true },
    { id: "capa-test-responsible-inactive", email: "capa-inactive@chome.cl", name: "Responsable Inactivo", hashedPassword: "x", createdAt: now, updatedAt: now, isActive: false },
  ])
  await inMemoryDb.insert(schema.worksites).values({ id: WORKSITE, name: "Faena CAPA Test", code: "CAPA-TEST", createdAt: now, updatedAt: now })
  await inMemoryDb.insert(schema.preventionRiskMethodologies).values({
    id: "capa-test-methodology", code: "CAPA-TEST", name: "Metodología de prueba", versionLabel: "v1",
    kind: "primary", authoritySource: "Prueba", configuration: {}, isActive: true, createdByUserId: "capa-test-author", createdAt: now,
  })
  await inMemoryDb.insert(schema.preventionRiskMatrices).values({
    id: "capa-test-matrix", worksiteId: WORKSITE, matrixVersion: 1, title: "MIPER CAPA Test",
    status: "draft", methodologyId: "capa-test-methodology", methodologySnapshot: {},
    revisionReason: "Prueba de generación de CAPA desde riesgos MIPER.",
    participationSummary: "No aplica: prueba automatizada.", consultationEvidenceReference: "acta-capa-test",
    createdByUserId: "capa-test-author", version: 1, createdAt: now, updatedAt: now,
  })
  await inMemoryDb.insert(schema.preventionRiskProcesses).values({ id: "capa-test-process", worksiteId: WORKSITE, code: "PROC", name: "Proceso", isActive: true, createdAt: now, updatedAt: now })
  await inMemoryDb.insert(schema.preventionRiskTasks).values({ id: "capa-test-task", processId: "capa-test-process", code: "TASK", name: "Tarea", isRoutine: true, isActive: true, createdAt: now, updatedAt: now })
  await inMemoryDb.insert(schema.preventionRiskPositions).values({ id: "capa-test-position", taskId: "capa-test-task", code: "POS", name: "Puesto", isActive: true, createdAt: now, updatedAt: now })

  const entryBase = {
    matrixId: "capa-test-matrix", processId: "capa-test-process", taskId: "capa-test-task", positionId: "capa-test-position",
    riskFactor: "Factor de prueba", expectedEventOrDamage: "Daño de prueba", exposedPeopleDescription: "Personal de prueba",
    genderConsiderations: "Sin diferencias.", sensitiveWorkerConsiderations: "Sin personas sensibles.",
    probability: 2 as const, consequence: 4 as const, riskMagnitude: 8, riskClassification: "importante" as const,
    residualDimensions: { probability: 2, consequence: 4 }, residualLevel: "high" as const, residualScore: 8,
    version: 1, createdAt: now, updatedAt: now,
  }
  await inMemoryDb.insert(schema.preventionRiskEntries).values([
    { ...entryBase, id: "capa-test-entry-1", hazardCode: "CAPA-01", hazard: "Peligro 1", risk: "Riesgo 1", responsibleSnapshot: "R1", responsibleUserId: "capa-test-responsible-active" },
    { ...entryBase, id: "capa-test-entry-2", hazardCode: "CAPA-02", hazard: "Peligro 2", risk: "Riesgo 2", responsibleSnapshot: "R2", responsibleUserId: "capa-test-responsible-active" },
    { ...entryBase, id: "capa-test-entry-inactive", hazardCode: "CAPA-03", hazard: "Peligro 3", risk: "Riesgo 3", responsibleSnapshot: "R3", responsibleUserId: "capa-test-responsible-inactive" },
    { ...entryBase, id: "capa-test-entry-cascade", hazardCode: "CAPA-04", hazard: "Peligro a borrar", risk: "Riesgo a borrar", responsibleSnapshot: "R4", responsibleUserId: null },
  ])
  await inMemoryDb.insert(schema.preventionRiskControls).values([
    { id: "capa-test-control-1", riskEntryId: "capa-test-entry-1", description: "Control administrativo del riesgo 1", hierarchy: "administrative", isExisting: true, isCritical: false, responsibleSnapshot: "R1", status: "proposed", effectivenessStatus: "not_assessed", version: 1, createdAt: now, updatedAt: now },
    { id: "capa-test-control-2", riskEntryId: "capa-test-entry-2", description: "Control de ingeniería del riesgo 2", hierarchy: "engineering", isExisting: true, isCritical: false, responsibleSnapshot: "R2", status: "proposed", effectivenessStatus: "not_assessed", version: 1, createdAt: now, updatedAt: now },
  ])
})

afterAll(async () => {
  delete testGlobal.__db
  await pg.close()
})

function access() {
  return { userId: "capa-test-author", scope: { mode: "some" as const, ids: [WORKSITE] }, permissions: ["prevention:capa:manage", "prevention:risk:edit"] }
}

describe("Programa de Trabajo MIPER — generación de CAPA desde riesgos (Fase 4, PGlite)", () => {
  it("genera una CAPA por riesgo, con la primera medida de control como descripción", async () => {
    const capaService = await import("@/lib/services/prevention-risk-capa")
    const result = await capaService.generateCapaActionsFromRiskEntries({
      riskEntryIds: ["capa-test-entry-1", "capa-test-entry-2"],
      defaults: { targetDate: "2026-09-01" },
    }, access())
    expect(result.created).toHaveLength(2)
    expect(result.skipped).toHaveLength(0)

    const created = await inMemoryDb.select().from(schema.preventionCapaActions).where(eq(schema.preventionCapaActions.worksiteId, WORKSITE))
    const byEntry = new Map(created.map((row) => [row.sourceId, row]))
    expect(byEntry.get("capa-test-entry-1")).toMatchObject({ sourceType: "risk", actionDescription: "Control administrativo del riesgo 1", priority: "high", responsibleUserId: "capa-test-responsible-active", reconciliationStatus: "reconciled" })
    expect(byEntry.get("capa-test-entry-2")).toMatchObject({ sourceType: "risk", actionDescription: "Control de ingeniería del riesgo 2", priority: "high" })
  })

  it("no duplica por doble clic: la misma descripción para el mismo riesgo se omite", async () => {
    const capaService = await import("@/lib/services/prevention-risk-capa")
    const result = await capaService.generateCapaActionsFromRiskEntries({
      riskEntryIds: ["capa-test-entry-1"],
      defaults: { targetDate: "2026-09-01" },
    }, access())
    expect(result.created).toHaveLength(0)
    expect(result.skipped).toEqual([{ riskEntryId: "capa-test-entry-1", reason: "Ya existe una acción con esta descripción para este riesgo." }])
  })

  it("degrada a responsable nulo + needs_assignment cuando el responsable está inactivo, sin fallar el resto del lote", async () => {
    const capaService = await import("@/lib/services/prevention-risk-capa")
    const result = await capaService.generateCapaActionsFromRiskEntries({
      riskEntryIds: ["capa-test-entry-inactive"],
      defaults: { targetDate: "2026-09-01", actionDescription: "Acción para riesgo con responsable inactivo" },
    }, access())
    expect(result.created).toHaveLength(1)
    const [capa] = await inMemoryDb.select().from(schema.preventionCapaActions).where(eq(schema.preventionCapaActions.id, result.created[0]!.capaActionId))
    expect(capa).toMatchObject({ responsibleUserId: null, reconciliationStatus: "needs_assignment" })
  })

  it("agrupa varios riesgos en una sola CAPA vía la tabla puente cuando se pide explícitamente", async () => {
    const capaService = await import("@/lib/services/prevention-risk-capa")
    const result = await capaService.generateCapaActionsFromRiskEntries({
      riskEntryIds: ["capa-test-entry-1", "capa-test-entry-2"],
      defaults: { targetDate: "2026-09-15", groupIntoSingleAction: true, actionDescription: "Acción agrupada para dos riesgos" },
    }, access())
    expect(result.created).toHaveLength(1)
    const capaActionId = result.created[0]!.capaActionId
    const links = await inMemoryDb.select().from(schema.preventionCapaRiskLinks).where(eq(schema.preventionCapaRiskLinks.capaActionId, capaActionId))
    expect(links.map((link) => link.riskEntryId).sort()).toEqual(["capa-test-entry-1", "capa-test-entry-2"])

    // listCapaForRiskEntry une el camino directo con el de la tabla puente sin duplicar.
    const forEntry1 = await capaService.listCapaForRiskEntry({ riskEntryId: "capa-test-entry-1" })
    const ids = forEntry1.map((item) => item.id)
    expect(new Set(ids).size).toBe(ids.length) // sin duplicados
    expect(ids).toContain(capaActionId) // el agrupado aparece
    expect(forEntry1.length).toBeGreaterThanOrEqual(2) // el directo (test 1) + el agrupado
  })

  it("borrar la entrada de riesgo elimina el vínculo de la tabla puente por CASCADE, no la CAPA", async () => {
    const capaService = await import("@/lib/services/prevention-risk-capa")
    const result = await capaService.generateCapaActionsFromRiskEntries({
      riskEntryIds: ["capa-test-entry-cascade"],
      defaults: { targetDate: "2026-09-01", groupIntoSingleAction: true, actionDescription: "Acción agrupada de un solo riesgo, para probar el CASCADE" },
    }, access())
    const capaActionId = result.created[0]!.capaActionId
    await inMemoryDb.delete(schema.preventionRiskEntries).where(eq(schema.preventionRiskEntries.id, "capa-test-entry-cascade"))
    const remainingLinks = await inMemoryDb.select().from(schema.preventionCapaRiskLinks).where(eq(schema.preventionCapaRiskLinks.riskEntryId, "capa-test-entry-cascade"))
    expect(remainingLinks).toHaveLength(0)
    const [capa] = await inMemoryDb.select().from(schema.preventionCapaActions).where(eq(schema.preventionCapaActions.id, capaActionId))
    expect(capa).toBeDefined()
  })

  it("rechaza agrupar riesgos de faenas distintas en una sola acción", async () => {
    const capaService = await import("@/lib/services/prevention-risk-capa")
    const now = new Date().toISOString()
    await inMemoryDb.insert(schema.worksites).values({ id: "ws-capa-test-other", name: "Otra faena", code: "CAPA-TEST-2", createdAt: now, updatedAt: now })
    await inMemoryDb.insert(schema.preventionRiskMatrices).values({
      id: "capa-test-matrix-2", worksiteId: "ws-capa-test-other", matrixVersion: 1, title: "MIPER otra faena",
      status: "draft", methodologyId: "capa-test-methodology", methodologySnapshot: {},
      revisionReason: "Prueba de segregación por faena.", participationSummary: "No aplica.", consultationEvidenceReference: "acta-otra-faena",
      createdByUserId: "capa-test-author", version: 1, createdAt: now, updatedAt: now,
    })
    await inMemoryDb.insert(schema.preventionRiskProcesses).values({ id: "capa-test-process-2", worksiteId: "ws-capa-test-other", code: "PROC2", name: "Proceso 2", isActive: true, createdAt: now, updatedAt: now })
    await inMemoryDb.insert(schema.preventionRiskTasks).values({ id: "capa-test-task-2", processId: "capa-test-process-2", code: "TASK2", name: "Tarea 2", isRoutine: true, isActive: true, createdAt: now, updatedAt: now })
    await inMemoryDb.insert(schema.preventionRiskPositions).values({ id: "capa-test-position-2", taskId: "capa-test-task-2", code: "POS2", name: "Puesto 2", isActive: true, createdAt: now, updatedAt: now })
    await inMemoryDb.insert(schema.preventionRiskEntries).values({
      id: "capa-test-entry-other-worksite", matrixId: "capa-test-matrix-2", processId: "capa-test-process-2", taskId: "capa-test-task-2", positionId: "capa-test-position-2",
      hazardCode: "OTHER-01", hazard: "Peligro de otra faena", risk: "Riesgo de otra faena",
      riskFactor: "Factor", expectedEventOrDamage: "Daño", exposedPeopleDescription: "Personal",
      genderConsiderations: "Sin diferencias.", sensitiveWorkerConsiderations: "Sin personas sensibles.",
      probability: 1, consequence: 1, riskMagnitude: 1, riskClassification: "tolerable",
      residualDimensions: { probability: 1, consequence: 1 }, residualLevel: "low", residualScore: 1,
      responsibleSnapshot: "R5", version: 1, createdAt: now, updatedAt: now,
    })
    const globalAccess = { userId: "capa-test-author", scope: { mode: "all" as const, ids: [] as [] }, permissions: ["prevention:capa:manage", "prevention:risk:edit"] }
    await expect(capaService.generateCapaActionsFromRiskEntries({
      riskEntryIds: ["capa-test-entry-inactive", "capa-test-entry-other-worksite"],
      defaults: { targetDate: "2026-09-01", groupIntoSingleAction: true, actionDescription: "No debería crearse" },
    }, globalAccess)).rejects.toThrow(/faenas distintas/i)
  })
})
