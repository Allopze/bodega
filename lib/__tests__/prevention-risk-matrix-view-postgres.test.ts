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

const WORKSITE = "ws-matrix-view-test"
const MATRIX = "matrix-view-test"

beforeAll(async () => {
  await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))
  const now = new Date().toISOString()
  await inMemoryDb.insert(schema.users).values([
    { id: "mv-author", email: "mv-author@chome.cl", name: "Autor", hashedPassword: "x", createdAt: now, updatedAt: now, isActive: true },
    { id: "mv-responsible", email: "mv-responsible@chome.cl", name: "Responsable", hashedPassword: "x", createdAt: now, updatedAt: now, isActive: true },
  ])
  await inMemoryDb.insert(schema.worksites).values({ id: WORKSITE, name: "Faena Vista Matriz", code: "MV-TEST", createdAt: now, updatedAt: now })
  await inMemoryDb.insert(schema.preventionRiskMethodologies).values({
    id: "mv-methodology", code: "MV-TEST", name: "Metodología de prueba", versionLabel: "v1",
    kind: "primary", authoritySource: "Prueba", configuration: {}, isActive: true, createdByUserId: "mv-author", createdAt: now,
  })
  await inMemoryDb.insert(schema.preventionRiskMatrices).values({
    id: MATRIX, worksiteId: WORKSITE, matrixVersion: 1, title: "MIPER Vista Matriz Test",
    status: "draft", methodologyId: "mv-methodology", methodologySnapshot: {},
    revisionReason: "Prueba de la vista matriz y operaciones masivas.",
    participationSummary: "No aplica.", consultationEvidenceReference: "acta-mv-test",
    createdByUserId: "mv-author", version: 1, createdAt: now, updatedAt: now,
  })
  await inMemoryDb.insert(schema.preventionRiskProcesses).values({ id: "mv-process", worksiteId: WORKSITE, code: "PROC", name: "Proceso", isActive: true, createdAt: now, updatedAt: now })
  await inMemoryDb.insert(schema.preventionRiskTasks).values({ id: "mv-task", processId: "mv-process", code: "TASK", name: "Tarea", isRoutine: true, isActive: true, createdAt: now, updatedAt: now })
  await inMemoryDb.insert(schema.preventionRiskPositions).values({ id: "mv-position", taskId: "mv-task", code: "POS", name: "Puesto", isActive: true, createdAt: now, updatedAt: now })

  const base = {
    matrixId: MATRIX, processId: "mv-process", taskId: "mv-task", positionId: "mv-position",
    riskFactor: "Factor", expectedEventOrDamage: "Daño", exposedPeopleDescription: "Personal",
    genderConsiderations: "Sin diferencias.", sensitiveWorkerConsiderations: "Sin personas sensibles.",
    version: 1, createdAt: now, updatedAt: now,
  }
  await inMemoryDb.insert(schema.preventionRiskEntries).values([
    { ...base, id: "mv-entry-intolerable", hazardCode: "MV-01", hazard: "Peligro intolerable", risk: "Riesgo grave", probability: 4, consequence: 4, riskMagnitude: 16, riskClassification: "intolerable", residualDimensions: {}, residualLevel: "critical", residualScore: 16, responsibleUserId: "mv-responsible", responsibleSnapshot: "Responsable" },
    { ...base, id: "mv-entry-tolerable", hazardCode: "MV-02", hazard: "Peligro tolerable", risk: "Riesgo menor", probability: 1, consequence: 1, riskMagnitude: 1, riskClassification: "tolerable", residualDimensions: {}, residualLevel: "low", residualScore: 1, responsibleUserId: null, responsibleSnapshot: "Sin asignar" },
    { ...base, id: "mv-entry-no-control", hazardCode: "MV-03", hazard: "Peligro sin control", risk: "Riesgo sin control", probability: 2, consequence: 2, riskMagnitude: 4, riskClassification: "moderado", residualDimensions: {}, residualLevel: "medium", residualScore: 4, responsibleUserId: "mv-responsible", responsibleSnapshot: "Responsable" },
  ])
  await inMemoryDb.insert(schema.preventionRiskControls).values({
    id: "mv-control-1", riskEntryId: "mv-entry-intolerable", description: "Control del riesgo intolerable", hierarchy: "engineering",
    isExisting: true, isCritical: true, performanceStandard: "Estándar de prueba con más de 5 caracteres", verificationFrequency: "Mensual",
    responsibleSnapshot: "Responsable", status: "proposed", effectivenessStatus: "not_assessed", version: 1, createdAt: now, updatedAt: now,
  })
})

afterAll(async () => {
  delete testGlobal.__db
  await pg.close()
})

function access() {
  return { userId: "mv-author", scope: { mode: "some" as const, ids: [WORKSITE] }, permissions: ["prevention:risk:view", "prevention:risk:edit"] }
}

describe("Vista matriz MIPER — listado paginado y operaciones masivas (Fase 5, PGlite)", () => {
  it("lista todas las entradas de la matriz sin filtro", async () => {
    const service = await import("@/lib/services/prevention-risk-legal")
    const page = await service.listRiskEntriesPage({ matrixId: MATRIX, ...access(), limit: 50, offset: 0 })
    expect(page.total).toBe(3)
    expect(page.rows).toHaveLength(3)
  })

  it("filtra por clasificación", async () => {
    const service = await import("@/lib/services/prevention-risk-legal")
    const page = await service.listRiskEntriesPage({ matrixId: MATRIX, ...access(), filters: { classification: "intolerable" }, limit: 50, offset: 0 })
    expect(page.total).toBe(1)
    expect(page.rows[0]!.entry.id).toBe("mv-entry-intolerable")
  })

  it("filtro rápido 'sin_responsable' encuentra sólo la entrada sin responsable", async () => {
    const service = await import("@/lib/services/prevention-risk-legal")
    const page = await service.listRiskEntriesPage({ matrixId: MATRIX, ...access(), filters: { quickFilter: "sin_responsable" }, limit: 50, offset: 0 })
    expect(page.rows.map((row) => row.entry.id)).toEqual(["mv-entry-tolerable"])
  })

  it("filtro rápido 'sin_control' encuentra las entradas sin ninguna medida de control", async () => {
    const service = await import("@/lib/services/prevention-risk-legal")
    const page = await service.listRiskEntriesPage({ matrixId: MATRIX, ...access(), filters: { quickFilter: "sin_control" }, limit: 50, offset: 0 })
    expect(page.rows.map((row) => row.entry.id).sort()).toEqual(["mv-entry-no-control", "mv-entry-tolerable"])
  })

  /* §23-24: el servidor no acepta evaluación del cliente. MR y clasificación
   * se recalculan siempre desde P×C, y `evaluationDivergence` —evidencia
   * derivada de comparar un Excel importado contra el cálculo del sistema—
   * sólo la escribe el importador: recibirla del creador guiado permitía
   * plantar una discrepancia inventada en un documento DS 44. */
  it("ignora la evaluación y la divergencia que mande el cliente, y recalcula desde P×C", async () => {
    const service = await import("@/lib/services/prevention-risk-legal")
    const { entry } = await service.addRiskEntry({
      matrixId: MATRIX,
      process: { code: "PROC", name: "Proceso" }, task: { code: "TASK", name: "Tarea", isRoutine: true },
      position: { code: "POS", name: "Puesto" },
      hazardCode: "MV-FORGED", hazard: "Peligro con evaluación forjada", risk: "Riesgo forjado",
      riskFactor: "Factor", expectedEventOrDamage: "Daño", exposedPeopleDescription: "Personal",
      genderConsiderations: "Sin diferencias.", sensitiveWorkerConsiderations: "Sin personas sensibles.",
      probability: 1, consequence: 1, responsibleSnapshot: "Responsable", controls: [],
      // Todo lo de abajo es lo que un cliente hostil intentaría fijar.
      riskMagnitude: 16, riskClassification: "intolerable", residualLevel: "critical", residualScore: 16,
      evaluationDivergence: { excelClassification: "INTOLERABLE", systemClassification: "tolerable" },
    }, access())

    expect(entry).toMatchObject({
      probability: 1, consequence: 1,
      riskMagnitude: 1, riskClassification: "tolerable", residualLevel: "low",
      evaluationDivergence: null,
    })
  })

  it("busca por texto libre en peligro, riesgo y código de peligro", async () => {
    const service = await import("@/lib/services/prevention-risk-legal")
    const byHazard = await service.listRiskEntriesPage({ matrixId: MATRIX, ...access(), filters: { search: "intolerable" }, limit: 50, offset: 0 })
    expect(byHazard.rows.map((row) => row.entry.id)).toEqual(["mv-entry-intolerable"])
    // El texto de RIESGO también entra en la búsqueda, no sólo el de PELIGRO.
    const byRisk = await service.listRiskEntriesPage({ matrixId: MATRIX, ...access(), filters: { search: "riesgo menor" }, limit: 50, offset: 0 })
    expect(byRisk.rows.map((row) => row.entry.id)).toEqual(["mv-entry-tolerable"])
    const byCode = await service.listRiskEntriesPage({ matrixId: MATRIX, ...access(), filters: { search: "MV-03" }, limit: 50, offset: 0 })
    expect(byCode.rows.map((row) => row.entry.id)).toEqual(["mv-entry-no-control"])
    const noMatch = await service.listRiskEntriesPage({ matrixId: MATRIX, ...access(), filters: { search: "no existe este texto" }, limit: 50, offset: 0 })
    expect(noMatch.total).toBe(0)
  })

  it("cada fila trae sus controles ya unidos, sin N+1 desde el llamador", async () => {
    const service = await import("@/lib/services/prevention-risk-legal")
    const page = await service.listRiskEntriesPage({ matrixId: MATRIX, ...access(), filters: { classification: "intolerable" }, limit: 50, offset: 0 })
    expect(page.rows[0]!.controls).toHaveLength(1)
    expect(page.rows[0]!.controls[0]!.description).toBe("Control del riesgo intolerable")
  })

  it("bulkUpdateRiskControlsWithClient reasigna responsable y plazo en una sola operación auditada, no una por fila", async () => {
    const service = await import("@/lib/services/prevention-risk-legal")
    const result = await service.bulkUpdateRiskControls({
      riskEntryIds: ["mv-entry-intolerable", "mv-entry-tolerable"],
      responsibleUserId: "mv-responsible",
      controlDeadlineText: "Trimestral",
    }, access())
    expect(result.updated).toBe(2)
    const updated = await inMemoryDb.select().from(schema.preventionRiskEntries).where(eq(schema.preventionRiskEntries.matrixId, MATRIX))
    for (const id of ["mv-entry-intolerable", "mv-entry-tolerable"]) {
      const entry = updated.find((row) => row.id === id)!
      expect(entry.responsibleUserId).toBe("mv-responsible")
      expect(entry.controlDeadlineText).toBe("Trimestral")
      expect(entry.version).toBe(2)
    }
    const history = await inMemoryDb.select().from(schema.preventionRiskLegalHistory).where(eq(schema.preventionRiskLegalHistory.changeType, "bulk_update"))
    expect(history).toHaveLength(1) // una sola entrada de auditoría, no dos
  })

  it("rechaza la operación masiva sobre una matriz publicada", async () => {
    const service = await import("@/lib/services/prevention-risk-legal")
    const now = new Date().toISOString()
    await inMemoryDb.insert(schema.preventionRiskMatrices).values({
      id: "mv-matrix-published", worksiteId: WORKSITE, matrixVersion: 2, title: "MIPER publicada",
      status: "published", methodologyId: "mv-methodology", methodologySnapshot: {},
      revisionReason: "Prueba de inmutabilidad.", participationSummary: "No aplica.", consultationEvidenceReference: "acta-mv-pub",
      createdByUserId: "mv-author", reviewedByUserId: "mv-author", approvedByUserId: "mv-author",
      version: 1, createdAt: now, updatedAt: now,
    })
    await inMemoryDb.insert(schema.preventionRiskEntries).values({
      matrixId: "mv-matrix-published", processId: "mv-process", taskId: "mv-task", positionId: "mv-position",
      id: "mv-entry-published", hazardCode: "MV-04", hazard: "Peligro publicado", risk: "Riesgo publicado",
      riskFactor: "Factor", expectedEventOrDamage: "Daño", exposedPeopleDescription: "Personal",
      genderConsiderations: "Sin diferencias.", sensitiveWorkerConsiderations: "Sin personas sensibles.",
      probability: 1, consequence: 1, riskMagnitude: 1, riskClassification: "tolerable",
      residualDimensions: {}, residualLevel: "low", residualScore: 1, responsibleSnapshot: "R",
      version: 1, createdAt: now, updatedAt: now,
    })
    await expect(service.bulkUpdateRiskControls({ riskEntryIds: ["mv-entry-published"], responsibleUserId: "mv-responsible" }, access()))
      .rejects.toThrow(/borrador admite cambios masivos/i)
  })
})
