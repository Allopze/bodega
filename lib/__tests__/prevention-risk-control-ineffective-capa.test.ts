/**
 * E2E-005 (auditoría 2026-09-14) — Un control crítico verificado como ineficaz
 * no abría acción correctiva.
 *
 * El enum de orígenes de CAPA admite diecisiete valores y quince módulos los
 * escriben; `risk` no tenía **ningún** escritor. Cuando se verificaba un
 * control de la MIPER y el resultado era ineficaz, el sistema sólo creaba un
 * disparador de revisión de riesgo a 30 días, que vive en el tablero de MIPER y
 * no llega a ninguna cola transversal (MIP-001). Un hallazgo de inspección de
 * criticidad alta sí abría CAPA; el control con que la organización declara
 * "este riesgo está controlado", al fallar, no.
 */
import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { eq } from "drizzle-orm"
import { beforeAll, describe, expect, it, vi } from "vitest"
import * as schema from "@/db/schema"
import type { DB } from "@/db"
import type { WorksiteScope } from "@/lib/auth/scope"
import { migratePGlite } from "@/lib/testing/pglite-migrate"

const pg = new PGlite()
const testDb = drizzle(pg, { schema }) as unknown as DB
const testGlobal = globalThis as typeof globalThis & { __db?: DB }
testGlobal.__db = testDb
vi.mock("@/db", () => ({ get db() { return testGlobal.__db } }))

const { verifyRiskControl } = await import("@/lib/services/prevention-risk-legal")

const WS = "ws-e2e005"
const AUTOR = "e2e005-autor"
const VERIFICADOR = "e2e005-verificador"
const RESPONSABLE = "e2e005-responsable"
const SCOPE = { mode: "some", ids: [WS] } as WorksiteScope
const VERIFICA = { userId: VERIFICADOR, scope: SCOPE, permissions: ["prevention:risk:view", "prevention:risk:edit"] }

let matrixId = ""

beforeAll(async () => {
  await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))
  await testDb.insert(schema.worksites).values({ id: WS, name: "Faena MIPER", code: "E2E005", isActive: true })
  await testDb.insert(schema.users).values([
    { id: AUTOR, name: "Autora MIPER", email: "autora@e2e005.cl", hashedPassword: "x", isActive: true },
    { id: VERIFICADOR, name: "Verificador", email: "verif@e2e005.cl", hashedPassword: "x", isActive: true },
    { id: RESPONSABLE, name: "Responsable del control", email: "resp@e2e005.cl", hashedPassword: "x", isActive: true },
  ])
  await testDb.insert(schema.preventionRiskMethodologies).values({
    id: "meth-e2e005", code: "ISP", name: "Matriz ISP", versionLabel: "v1", kind: "primary",
    authoritySource: "ISP", createdByUserId: AUTOR,
  })
  matrixId = "matrix-e2e005"
  await testDb.insert(schema.preventionRiskMatrices).values({
    id: matrixId, worksiteId: WS, matrixVersion: 1, title: "MIPER Faena MIPER", status: "published",
    methodologyId: "meth-e2e005", methodologySnapshot: {},
    revisionReason: "Versión inicial de la matriz para la prueba.",
    participationSummary: "Participación documentada del comité paritario.",
    consultationEvidenceReference: "acta-consulta-e2e005",
    effectiveFrom: "2026-09-01", reviewDueAt: "2027-09-01",
    createdByUserId: AUTOR, reviewedByUserId: VERIFICADOR, approvedByUserId: AUTOR,
    publishedByUserId: AUTOR, publishedAt: "2026-09-01T12:00:00.000Z",
    publishedHashSha256: "b".repeat(64),
  })
  await testDb.insert(schema.preventionRiskProcesses).values({ id: "proc-e2e005", worksiteId: WS, code: "P1", name: "Mantención" })
  await testDb.insert(schema.preventionRiskTasks).values({ id: "task-e2e005", processId: "proc-e2e005", code: "T1", name: "Cambio de cinta" })
  await testDb.insert(schema.preventionRiskPositions).values({ id: "pos-e2e005", taskId: "task-e2e005", code: "C1", name: "Mantenedor" })
})

/** Un peligro con un control, del nivel residual y criticidad que pida la prueba. */
async function seedControl(over: { isCritical: boolean; residualLevel: string; hazardCode: string }) {
  const entryId = `entry-${over.hazardCode}`
  await testDb.insert(schema.preventionRiskEntries).values({
    id: entryId, matrixId, processId: "proc-e2e005", taskId: "task-e2e005", positionId: "pos-e2e005",
    hazardCode: over.hazardCode, hazard: "Atrapamiento en cinta transportadora",
    riskFactor: "Partes móviles sin resguardo", expectedEventOrDamage: "Amputación",
    exposedPeopleDescription: "Mantenedores del turno", exposedPeopleCount: 4,
    genderConsiderations: "Sin diferencias declaradas.", sensitiveWorkerConsiderations: "Sin trabajadores sensibles asignados.",
    inherentDimensions: {}, inherentLevel: "critical",
    residualDimensions: {}, residualLevel: over.residualLevel,
    isCritical: true, responsibleUserId: RESPONSABLE, responsibleSnapshot: "Responsable del control",
  })
  const controlId = `ctrl-${over.hazardCode}`
  await testDb.insert(schema.preventionRiskControls).values({
    id: controlId, riskEntryId: entryId, description: "Enclavamiento que detiene la cinta al abrir el resguardo",
    hierarchy: "engineering", isExisting: true, isCritical: over.isCritical,
    performanceStandard: "Detención en menos de 2 segundos.", verificationFrequency: "mensual",
    responsibleUserId: RESPONSABLE, responsibleSnapshot: "Responsable del control",
    status: "implemented", effectivenessStatus: "not_assessed", version: 1,
  })
  return { entryId, controlId }
}

const capasDe = async (controlId: string) =>
  testDb.select().from(schema.preventionCapaActions).where(eq(schema.preventionCapaActions.sourceId, controlId))

describe("E2E-005 — un control crítico ineficaz abre acción correctiva", () => {
  it("crea la CAPA de origen `risk` además del disparador de revisión", async () => {
    const { entryId, controlId } = await seedControl({ isCritical: true, residualLevel: "critical", hazardCode: "CRIT-01" })

    const verificado = await verifyRiskControl({
      controlId, expectedVersion: 1, effectivenessStatus: "ineffective",
      evidenceReference: "acta-verificacion-e2e005-001",
      verificationNote: "El enclavamiento no detuvo la cinta dentro del estándar de 2 segundos.",
    }, VERIFICA)
    expect(verificado).toMatchObject({ status: "ineffective", effectivenessStatus: "ineffective" })

    // Antes de E2E-005 esto era una lista vacía: la falla del control producía
    // sólo un recordatorio para revisar la matriz.
    const [capa] = await capasDe(controlId)
    expect(capa).toBeDefined()
    expect(capa).toMatchObject({
      sourceType: "risk",
      worksiteId: WS,
      status: "pending",
      // Sin responsable asignado: quién responde por la falla de un control es
      // decisión de la organización, y la CAPA nace en la cola de asignación
      // pendiente en vez de inventarle un dueño.
      responsibleUserId: null,
      reconciliationStatus: "needs_assignment",
      // Prioridad y plazo derivados del riesgo residual del peligro con la
      // misma tabla que usa el resto de la plataforma: residual `critical` →
      // prioridad `critical`.
      priority: "critical",
    })
    expect(capa!.finding).toContain("verificado como ineficaz")
    expect(capa!.sourceRef).toMatchObject({ riskEntryId: entryId, matrixId })

    // El disparador de revisión de la MIPER se conserva: la CAPA se suma, no lo
    // reemplaza. Son dos cosas distintas (revisar la matriz vs. reponer el
    // control).
    const [trigger] = await testDb.select().from(schema.preventionRiskReviewTriggers)
      .where(eq(schema.preventionRiskReviewTriggers.sourceId, controlId))
    expect(trigger).toMatchObject({ triggerType: "critical_control_failure", status: "pending" })
  })

  it("un control crítico eficaz no abre nada", async () => {
    const { controlId } = await seedControl({ isCritical: true, residualLevel: "high", hazardCode: "CRIT-02" })
    await verifyRiskControl({
      controlId, expectedVersion: 1, effectivenessStatus: "effective",
      evidenceReference: "acta-verificacion-e2e005-002",
      verificationNote: "El enclavamiento detuvo la cinta dentro del estándar medido en terreno.",
    }, VERIFICA)
    expect(await capasDe(controlId)).toEqual([])
  })

  it("un control NO crítico ineficaz sigue produciendo sólo el disparador de revisión", async () => {
    // Límite deliberado: el hallazgo sanciona la CAPA automática para el control
    // *crítico*. Extenderla a cualquier control es una decisión de producto que
    // la plataforma no declara en ninguna parte.
    const { controlId } = await seedControl({ isCritical: false, residualLevel: "medium", hazardCode: "NOCRIT-01" })
    await verifyRiskControl({
      controlId, expectedVersion: 1, effectivenessStatus: "ineffective",
      evidenceReference: "acta-verificacion-e2e005-003",
      verificationNote: "La señalética del sector está descolorida y no se lee a distancia.",
    }, VERIFICA)
    expect(await capasDe(controlId)).toEqual([])
    const [trigger] = await testDb.select().from(schema.preventionRiskReviewTriggers)
      .where(eq(schema.preventionRiskReviewTriggers.sourceId, controlId))
    expect(trigger).toBeDefined()
  })

  it("una nueva verificación ineficaz del mismo control abre su propia acción, sin duplicar la anterior", async () => {
    const { controlId } = await seedControl({ isCritical: true, residualLevel: "high", hazardCode: "CRIT-03" })
    const primera = await verifyRiskControl({
      controlId, expectedVersion: 1, effectivenessStatus: "ineffective",
      evidenceReference: "acta-verificacion-e2e005-004",
      verificationNote: "Primera verificación: el enclavamiento no responde.",
    }, VERIFICA)
    await verifyRiskControl({
      controlId, expectedVersion: primera.version, effectivenessStatus: "ineffective",
      evidenceReference: "acta-verificacion-e2e005-005",
      verificationNote: "Segunda verificación tras la intervención: sigue sin responder.",
    }, VERIFICA)

    const capas = await capasDe(controlId)
    expect(capas).toHaveLength(2)
    expect(new Set(capas.map((item) => item.sourceItemId))).toHaveLength(2)
    expect(capas.every((item) => item.priority === "high")).toBe(true)
  })
})
