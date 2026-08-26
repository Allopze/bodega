import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { and, eq } from "drizzle-orm"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { migratePGlite } from "@/lib/testing/pglite-migrate"
import { MIPER_SHEETS } from "@/lib/prevention/miper-template"
import * as schema from "@/db/schema"

const pg = new PGlite()
const inMemoryDb = drizzle(pg, { schema })
const testGlobal = globalThis as typeof globalThis & { __db?: typeof inMemoryDb }
// @ts-expect-error PGlite es compatible en runtime con el cliente postgres-js que usa el singleton.
testGlobal.__db = inMemoryDb

let methodologyId = ""

beforeAll(async () => {
  await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))
  const now = new Date().toISOString()
  await inMemoryDb.insert(schema.users).values([
    { id: "roundtrip-user", email: "roundtrip@chome.cl", name: "Round Trip Autor", hashedPassword: "x", createdAt: now, updatedAt: now },
    { id: "roundtrip-reviewer", email: "roundtrip-reviewer@chome.cl", name: "Round Trip Revisor", hashedPassword: "x", createdAt: now, updatedAt: now },
    { id: "roundtrip-approver", email: "roundtrip-approver@chome.cl", name: "Round Trip Aprobador", hashedPassword: "x", createdAt: now, updatedAt: now },
    { id: "roundtrip-approver-operations", email: "roundtrip-approver-operations@chome.cl", name: "Round Trip Aprobador Operaciones", hashedPassword: "x", createdAt: now, updatedAt: now },
    { id: "roundtrip-import-approver", email: "roundtrip-import-approver@chome.cl", name: "Round Trip Aprobador Import", hashedPassword: "x", createdAt: now, updatedAt: now },
  ])
  await inMemoryDb.insert(schema.worksites).values([
    { id: "ws-roundtrip-origin", name: "Faena Origen", code: "RT-ORIGIN", createdAt: now, updatedAt: now },
    { id: "ws-roundtrip-target", name: "Faena Destino", code: "RT-TARGET", createdAt: now, updatedAt: now },
  ])
})

afterAll(async () => {
  delete testGlobal.__db
  await pg.close()
})

function access(worksiteId: string, userId = "roundtrip-user") {
  return { userId, scope: { mode: "some" as const, ids: [worksiteId] }, permissions: [
    "prevention:risk:view", "prevention:risk:edit", "prevention:risk:review", "prevention:risk:approve",
    "prevention:risk:approve_prevention", "prevention:risk:approve_operations", "prevention:risk:publish",
  ] }
}

/**
 * Publica una matriz con 2 riesgos reales (identidad y evaluación P×C
 * distintas) en `ws-roundtrip-origin`, siguiendo el ciclo completo de
 * segregación con un único actor con todos los permisos — la segregación
 * autor≠revisor≠aprobador no es lo que este test verifica.
 */
async function publishSourceMatrix() {
  const legal = await import("@/lib/services/prevention-risk-legal")
  const acc = access("ws-roundtrip-origin")
  const methodology = await legal.ensureIspRiskMethodology(acc)
  methodologyId = methodology.id
  const draft = await legal.createRiskMatrixDraft({
    worksiteId: "ws-roundtrip-origin", title: "MIPER round-trip origen", methodologyId,
    revisionReason: "Prueba de ciclo exportar/importar sin pérdida de información.",
    participationSummary: "Consulta simulada para la prueba de round-trip.",
    consultationEvidenceReference: "acta-roundtrip-001",
  }, acc)
  await legal.addRiskEntry({
    matrixId: draft.id,
    process: { code: "PROC-RT", name: "Operación de planta" }, task: { code: "TASK-RT", name: "Cargar camión", isRoutine: true },
    position: { code: "POS-RT", name: "Operador de carga" }, hazardCode: "RT-01", hazard: "Carga suspendida sin señalización",
    risk: "Caída de carga", riskFactor: "Mecánico", expectedEventOrDamage: "Lesión grave por aplastamiento",
    exposedPeopleDescription: "Operadores de carga", exposedPeopleCount: 2, probability: 2, consequence: 4,
    genderConsiderations: "Sin diferencias relevantes de exposición.", sensitiveWorkerConsiderations: "Sin personas sensibles identificadas.",
    responsibleSnapshot: "Jefatura de operaciones", controls: [],
  }, acc)
  await legal.addRiskEntry({
    matrixId: draft.id,
    process: { code: "PROC-RT", name: "Operación de planta" }, task: { code: "TASK-RT", name: "Cargar camión", isRoutine: true },
    position: { code: "POS-RT", name: "Operador de carga" }, hazardCode: "RT-02", hazard: "Ruido de maquinaria sobre el límite",
    risk: "Hipoacusia", riskFactor: "Físico", expectedEventOrDamage: "Daño auditivo progresivo",
    exposedPeopleDescription: "Operadores de carga", exposedPeopleCount: 2, probability: 1, consequence: 2,
    genderConsiderations: "Sin diferencias relevantes de exposición.", sensitiveWorkerConsiderations: "Sin personas sensibles identificadas.",
    responsibleSnapshot: "Jefatura de operaciones", controls: [],
  }, acc)
  const reviewerAccess = access("ws-roundtrip-origin", "roundtrip-reviewer")
  const approverAccess = access("ws-roundtrip-origin", "roundtrip-approver")
  const approverOperationsAccess = access("ws-roundtrip-origin", "roundtrip-approver-operations")
  const submitted = await legal.transitionRiskMatrix({ matrixId: draft.id, expectedVersion: draft.version, toStatus: "in_review", reason: "Envío a revisión para la prueba de round-trip." }, acc)
  const reviewed = await legal.transitionRiskMatrix({ matrixId: draft.id, expectedVersion: submitted.version, toStatus: "reviewed", reason: "Revisión técnica de la prueba de round-trip." }, reviewerAccess)
  // Doble aprobación (§48-51): dos usuarios distintos, uno por dominio.
  await legal.decideRiskMatrixApproval({ matrixId: draft.id, expectedVersion: reviewed.version, domain: "prevention", decision: "approved", reason: "Aprobación de Prevención de la prueba de round-trip." }, approverAccess)
  const approved = await legal.decideRiskMatrixApproval({ matrixId: draft.id, expectedVersion: reviewed.version, domain: "operations", decision: "approved", reason: "Aprobación de Operaciones de la prueba de round-trip." }, approverOperationsAccess)
  return legal.transitionRiskMatrix({ matrixId: draft.id, expectedVersion: approved.matrix.version, toStatus: "published", reason: "Publicación de la prueba de round-trip." }, approverOperationsAccess)
}

describe("round-trip Plataforma → Excel → Plataforma (§76 de la ficha)", () => {
  it("exportar una matriz e importarla de vuelta produce los mismos riesgos", async () => {
    const published = await publishSourceMatrix()
    const exporter = await import("@/lib/services/prevention-risk-export")
    const { workbook } = await exporter.buildMiperWorkbook(published.id, access("ws-roundtrip-origin"))
    const buffer = Buffer.from(await workbook.xlsx.writeBuffer())

    const importer = await import("@/lib/services/prevention-risk-import")
    const targetAccess = access("ws-roundtrip-target")
    const staged = await importer.stageRiskImport({ worksiteId: "ws-roundtrip-target", fileName: "roundtrip.xlsx", buffer, access: targetAccess })
    const rows = await inMemoryDb.select().from(schema.preventionRiskImportRows).where(eq(schema.preventionRiskImportRows.batchId, staged.batch.id))
    // Round-trip exacto: ninguna fila queda observada — lo que el exportador
    // escribió, el importador lo reconoce sin fricción.
    expect(rows.every((row) => row.status === "ready")).toBe(true)
    expect(rows).toHaveLength(2)

    await importer.approveRiskImportBatch(staged.batch.id, { ...targetAccess, userId: "roundtrip-approver" })
    const activated = await importer.activateRiskImportBatch({
      batchId: staged.batch.id, title: "MIPER round-trip destino", methodologyId,
      revisionReason: "Importación de la matriz exportada en la prueba de round-trip.",
      participationSummary: "No aplica: prueba automatizada.", consultationEvidenceReference: "acta-roundtrip-import-001",
    }, targetAccess)
    expect(activated).toMatchObject({ completed: true, remaining: 0 })

    const importedEntries = await inMemoryDb.select().from(schema.preventionRiskEntries).where(eq(schema.preventionRiskEntries.matrixId, activated.matrix.id))
    expect(importedEntries).toHaveLength(2)
    // El código de peligro se deriva por slug del texto de PELIGRO (la
    // plantilla real no tiene columna de código) — el original "RT-01"/"RT-02"
    // no sobrevive el ciclo, y no tiene por qué: la identidad estable que
    // importa es proceso+tarea+puesto+slug(peligro), no el código en sí.
    const byHazard = new Map(importedEntries.map((entry) => [entry.hazard, entry]))
    expect(byHazard.get("Carga suspendida sin señalización")).toMatchObject({ risk: "Caída de carga", probability: 2, consequence: 4, riskMagnitude: 8, riskClassification: "importante" })
    expect(byHazard.get("Ruido de maquinaria sobre el límite")).toMatchObject({ risk: "Hipoacusia", probability: 1, consequence: 2, riskMagnitude: 2, riskClassification: "tolerable" })
  })

  /* La ruta de exportación sólo exige `prevention:risk:view`, pero la hoja
   * "Programa de Trabajo" son acciones CAPA. `cphs` y `jefe_terreno` tienen
   * el primero sin el segundo: sin este resguardo, el Excel entregaba lo que
   * la UI les niega. */
  it("no filtra el Programa de Trabajo a quien tiene risk:view pero no capa:view", async () => {
    const exporter = await import("@/lib/services/prevention-risk-export")
    const [published] = await inMemoryDb.select().from(schema.preventionRiskMatrices)
      .where(and(eq(schema.preventionRiskMatrices.worksiteId, "ws-roundtrip-origin"), eq(schema.preventionRiskMatrices.status, "published")))
    const [entry] = await inMemoryDb.select().from(schema.preventionRiskEntries).where(eq(schema.preventionRiskEntries.matrixId, published!.id))
    const ts = new Date().toISOString()
    await inMemoryDb.insert(schema.preventionCapaActions).values({
      id: "capa-roundtrip-leak", code: "CAPA-RT-LEAK", sourceType: "risk", sourceId: entry!.id,
      worksiteId: "ws-roundtrip-origin", finding: entry!.hazard,
      actionDescription: "Acción del Programa de Trabajo que no debe filtrarse.",
      priority: "high", targetDate: "2026-12-31", status: "pending", evidenceRequired: false,
      createdByUserId: "roundtrip-user", createdAt: ts, updatedAt: ts,
    })

    const programSheetRows = async (permissions: string[]) => {
      const { workbook } = await exporter.buildMiperWorkbook(published!.id, { ...access("ws-roundtrip-origin"), permissions })
      // -1 por la fila de encabezado, que ExcelJS cuenta en `rowCount`.
      return workbook.getWorksheet(MIPER_SHEETS.program)!.rowCount - 1
    }

    expect(await programSheetRows(["prevention:risk:view", "prevention:capa:view"])).toBeGreaterThan(0)
    expect(await programSheetRows(["prevention:risk:view"])).toBe(0)
  })
})
