import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { eq } from "drizzle-orm"
import { migratePGlite } from "@/lib/testing/pglite-migrate"
import { describe, it, expect, beforeAll, vi } from "vitest"
import path from "node:path"
import * as schema from "@/db/schema"
import { nanoid } from "@/lib/id"

// ── In-memory PostgreSQL database & migrations ────────────────────────────
const pg = new PGlite()
const inMemoryDb = drizzle(pg, { schema })
const testGlobal = globalThis as typeof globalThis & { __db?: typeof inMemoryDb }
// @ts-expect-error — PGlite es estructuralmente compatible en runtime; postgres-js difiere sólo en el tipo HKT del resultado.
testGlobal.__db = inMemoryDb

vi.mock("@/db", () => ({
  get db() {
    return testGlobal.__db
  },
}))

await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))

const { reviewTaeSubmission, isOutsideOperatingSchedule } = await import("@/lib/services/fuel-tae")
const { syncAnomalyRuleCatalog, getAnomalyCases, updateAnomalyCaseStatus, assignAnomalyCase, addAnomalyComment } = await import("@/lib/combustibles/anomaly-cases")

/** Rol global: estas pruebas verifican la detección, no el alcance por faena. */
const TEST_SESSION = { user: { id: "test-user", isGlobal: true, worksiteIds: [] } } as unknown as import("next-auth").Session
const scopedSession = (userId: string, worksiteIds: string[]) => ({
  user: { id: userId, email: "reviewer@example.com", isGlobal: false, worksiteIds, roles: [], permissions: [], primaryWorksiteId: worksiteIds[0] ?? null, avatarColor: null, isActive: true },
}) as unknown as import("next-auth").Session
const { runAllBatchRules } = await import("@/lib/combustibles/anomaly-detector")
const { fuelAnomalyRules, fuelAnomalyCases, fuelAnomalyComments, fuelTaeSubmissions, fuelTaeEvidence } = schema

/**
 * Prueba de integración PostgreSQL del motor de detección de anomalías
 * (sección 11). Ejercita el camino real (`reviewTaeSubmission` → detección
 * inline dentro de la transacción, y `runAllBatchRules` para las reglas
 * batch) contra Postgres, no contra mocks — incluyendo el fix de esta
 * sesión de que una regla desactivada no debe seguir disparando, y que
 * `createAnomalyCase` no debe duplicar un caso ya resuelto.
 */
describe("anomaly detection engine (PostgreSQL integration)", () => {
  const worksiteHome = nanoid()
  const worksiteOther = nanoid()
  const equipmentTypeId = nanoid()
  const vehicleId = nanoid()
  const productId = nanoid()
  const userId = nanoid()

  beforeAll(async () => {
    await inMemoryDb.insert(schema.worksites).values([
      { id: worksiteHome, name: "Faena asignada", code: `FH-${nanoid().slice(0, 8)}`, isActive: true },
      { id: worksiteOther, name: "Otra faena", code: `FO-${nanoid().slice(0, 8)}`, isActive: true },
    ])
    await inMemoryDb.insert(schema.users).values({ id: userId, name: "Revisor", email: `rev-${nanoid()}@example.com`, hashedPassword: "x", isActive: true })
    await inMemoryDb.insert(schema.fuelProducts).values({ id: productId, code: `DIESEL-${nanoid().slice(0, 6)}`, name: "Diésel", category: "diesel", unit: "liter" })
    await inMemoryDb.insert(schema.fuelEquipmentTypes).values({ id: equipmentTypeId, slug: `camion-${nanoid().slice(0, 6)}`, name: "Camión" })
    await inMemoryDb.insert(schema.fuelVehicles).values({
      id: vehicleId, plate: `BB${nanoid().slice(0, 4).toUpperCase()}`, type: "camion", equipmentTypeId,
      worksiteId: worksiteHome, isActive: true, tankCapacityLiters: 200,
    })
    await syncAnomalyRuleCatalog()
  })

  function baseSubmission(overrides: Partial<typeof fuelTaeSubmissions.$inferInsert> = {}) {
    const id = nanoid()
    return {
      id,
      clientSubmissionId: nanoid(),
      source: "public_pwa" as const,
      publicResultToken: nanoid(32),
      worksiteId: worksiteHome,
      vehicleId,
      productId,
      equipmentCodeSnapshot: "BB-1",
      loadedAt: "2026-06-10T12:00:00.000Z",
      submittedAt: "2026-06-10T12:00:00.000Z",
      driverNameSnapshot: "Conductor",
      supervisorNameSnapshot: "Supervisor",
      manualIdentity: false,
      meterType: "odometer" as const,
      liters: 50,
      status: "submitted" as const,
      ...overrides,
    }
  }

  it("crea un caso identidad_incompleta cuando manualIdentity es verdadero", async () => {
    const submission = baseSubmission({ manualIdentity: true })
    await inMemoryDb.insert(fuelTaeSubmissions).values(submission)

    await reviewTaeSubmission({ id: submission.id, expectedStatus: "submitted", status: "validated", reviewNote: "ok", userId })

    const { cases } = await getAnomalyCases({ referenceEntityType: "fuel_tae_submission", referenceEntityId: submission.id }, TEST_SESSION)
    expect(cases.some((c) => c.ruleCode === "identidad_incompleta")).toBe(true)
  })

  it("crea un caso carga_faena_distinta cuando la faena de la carga no es la asignada al equipo", async () => {
    const submission = baseSubmission({ worksiteId: worksiteOther })
    await inMemoryDb.insert(fuelTaeSubmissions).values(submission)

    await reviewTaeSubmission({ id: submission.id, expectedStatus: "submitted", status: "validated", reviewNote: "ok", userId })

    const { cases } = await getAnomalyCases({ referenceEntityType: "fuel_tae_submission", referenceEntityId: submission.id }, TEST_SESSION)
    expect(cases.some((c) => c.ruleCode === "carga_faena_distinta")).toBe(true)
  })

  it("crea un caso sello_inicial_faltante y sello_final_faltante cuando faltan ambos sellos", async () => {
    const submission = baseSubmission({ removedSealNumber: null, installedSealNumber: null, noSealReason: "Sin sello disponible en terreno" })
    await inMemoryDb.insert(fuelTaeSubmissions).values(submission)

    await reviewTaeSubmission({ id: submission.id, expectedStatus: "submitted", status: "validated", reviewNote: "ok", userId })

    const { cases } = await getAnomalyCases({ referenceEntityType: "fuel_tae_submission", referenceEntityId: submission.id }, TEST_SESSION)
    expect(cases.map((c) => c.ruleCode)).toEqual(expect.arrayContaining(["sello_inicial_faltante", "sello_final_faltante"]))
  })

  it("NO crea un caso cuando la regla está desactivada (fix de esta sesión: las reglas inline ahora respetan isActive)", async () => {
    await inMemoryDb.update(fuelAnomalyRules).set({ isActive: false }).where(eq(fuelAnomalyRules.code, "identidad_incompleta"))

    const submission = baseSubmission({ manualIdentity: true })
    await inMemoryDb.insert(fuelTaeSubmissions).values(submission)
    await reviewTaeSubmission({ id: submission.id, expectedStatus: "submitted", status: "validated", reviewNote: "ok", userId })

    const { cases } = await getAnomalyCases({ referenceEntityType: "fuel_tae_submission", referenceEntityId: submission.id }, TEST_SESSION)
    expect(cases.some((c) => c.ruleCode === "identidad_incompleta")).toBe(false)

    // Reactivar para no afectar otras pruebas del archivo.
    await inMemoryDb.update(fuelAnomalyRules).set({ isActive: true }).where(eq(fuelAnomalyRules.code, "identidad_incompleta"))
  })

  it("resolver o descartar un caso sin motivo se rechaza (sección 15: exigir motivo para correcciones sensibles)", async () => {
    const submission = baseSubmission({ manualIdentity: true })
    await inMemoryDb.insert(fuelTaeSubmissions).values(submission)
    await reviewTaeSubmission({ id: submission.id, expectedStatus: "submitted", status: "validated", reviewNote: "ok", userId })
    const { cases } = await getAnomalyCases({ referenceEntityType: "fuel_tae_submission", referenceEntityId: submission.id }, TEST_SESSION)
    const created = cases.find((c) => c.ruleCode === "identidad_incompleta")!

    const session = scopedSession(userId, [worksiteHome])
    await expect(updateAnomalyCaseStatus(session, created.id, "open", "dismissed")).rejects.toThrow(/motivo/i)
    await expect(updateAnomalyCaseStatus(session, created.id, "open", "dismissed", "   ")).rejects.toThrow(/motivo/i)

    const resolved = await updateAnomalyCaseStatus(session, created.id, "open", "dismissed", "Confirmado con el conductor en terreno")
    expect(resolved.status).toBe("dismissed")
    expect(resolved.resolution).toBe("Confirmado con el conductor en terreno")
  })

  it("impide cambiar, asignar o comentar un caso de otra faena", async () => {
    const rule = await inMemoryDb.query.fuelAnomalyRules.findFirst()
    const foreignCaseId = nanoid()
    await inMemoryDb.insert(fuelAnomalyCases).values({
      id: foreignCaseId,
      ruleId: rule!.id,
      ruleCode: "scope_test",
      severity: "high",
      worksiteId: worksiteOther,
      description: "Caso fuera de alcance",
      status: "open",
    })
    const session = scopedSession(userId, [worksiteHome])

    await expect(updateAnomalyCaseStatus(session, foreignCaseId, "open", "in_review")).rejects.toThrow(/no encontrado/i)
    await expect(assignAnomalyCase(session, foreignCaseId, null, userId)).rejects.toThrow(/no encontrado/i)
    await expect(addAnomalyComment(session, foreignCaseId, "No debería persistir")).rejects.toThrow(/no encontrado/i)

    const persisted = await inMemoryDb.query.fuelAnomalyCases.findFirst({ where: eq(fuelAnomalyCases.id, foreignCaseId) })
    expect(persisted?.status).toBe("open")
    expect(persisted?.assigneeId).toBeNull()
    const comments = await inMemoryDb.query.fuelAnomalyComments.findMany({ where: eq(fuelAnomalyComments.caseId, foreignCaseId) })
    expect(comments).toHaveLength(0)
  })

  it("rechaza transiciones inválidas y actualizaciones sobre un estado obsoleto", async () => {
    const rule = await inMemoryDb.query.fuelAnomalyRules.findFirst()
    const caseId = nanoid()
    await inMemoryDb.insert(fuelAnomalyCases).values({
      id: caseId,
      ruleId: rule!.id,
      ruleCode: "transition_test",
      severity: "medium",
      worksiteId: worksiteHome,
      description: "Caso para transición",
      status: "open",
    })
    const session = scopedSession(userId, [worksiteHome])

    await expect(updateAnomalyCaseStatus(session, caseId, "open", "reopened")).rejects.toThrow(/no se puede cambiar/i)
    await updateAnomalyCaseStatus(session, caseId, "open", "in_review")
    await expect(updateAnomalyCaseStatus(session, caseId, "open", "dismissed", "obsoleto")).rejects.toThrow(/cambió de estado/i)
  })

  it("impide sobrescribir una asignación que cambió desde que se cargó la pantalla", async () => {
    const rule = await inMemoryDb.query.fuelAnomalyRules.findFirst()
    const caseId = nanoid()
    await inMemoryDb.insert(fuelAnomalyCases).values({
      id: caseId,
      ruleId: rule!.id,
      ruleCode: "assignment_race_test",
      severity: "medium",
      worksiteId: worksiteHome,
      description: "Caso para concurrencia de asignación",
      status: "open",
      assigneeId: userId,
    })
    const session = scopedSession(userId, [worksiteHome])

    await expect(assignAnomalyCase(session, caseId, null, null)).rejects.toThrow(/asignación cambió/i)
    const persisted = await inMemoryDb.query.fuelAnomalyCases.findFirst({ where: eq(fuelAnomalyCases.id, caseId) })
    expect(persisted?.assigneeId).toBe(userId)
  })

  it("evidencia_faltante cuenta evidencias reales, no un valor fijo", async () => {
    // Con los dos números de sello la carga debía adjuntar las cuatro fotos; sin
    // sello solo se exigen dos (D-9), así que el mínimo sigue lo que esa carga debía traer.
    const submission = { ...baseSubmission(), removedSealNumber: "R-1", installedSealNumber: "I-1" }
    await inMemoryDb.insert(fuelTaeSubmissions).values(submission)
    await inMemoryDb.insert(fuelTaeEvidence).values([
      { id: nanoid(), submissionId: submission.id, kind: "odometer", fileName: "a.jpg", filePath: "a.jpg", mimeType: "image/jpeg" },
      { id: nanoid(), submissionId: submission.id, kind: "liter_meter", fileName: "b.jpg", filePath: "b.jpg", mimeType: "image/jpeg" },
    ])

    await reviewTaeSubmission({ id: submission.id, expectedStatus: "submitted", status: "validated", reviewNote: "ok", userId })

    const { cases } = await getAnomalyCases({ referenceEntityType: "fuel_tae_submission", referenceEntityId: submission.id }, TEST_SESSION)
    const evidenceCase = cases.find((c) => c.ruleCode === "evidencia_faltante")
    expect(evidenceCase?.observedValue).toBe("2")
    expect(evidenceCase?.expectedValue).toBe("4")
  })

  it("litros_supera_capacidad (regla batch) crea un caso vía runAllBatchRules, no dentro del request", async () => {
    const submission = baseSubmission({ liters: 500 }) // supera tankCapacityLiters=200 con margen
    await inMemoryDb.insert(fuelTaeSubmissions).values(submission)
    await reviewTaeSubmission({ id: submission.id, expectedStatus: "submitted", status: "validated", reviewNote: "ok", userId })

    // Al validar no debe crearse (es batch, no inline).
    let { cases } = await getAnomalyCases({ referenceEntityType: "fuel_tae_submission", referenceEntityId: submission.id }, TEST_SESSION)
    expect(cases.some((c) => c.ruleCode === "litros_supera_capacidad")).toBe(false)

    await runAllBatchRules()

    ;({ cases } = await getAnomalyCases({ referenceEntityType: "fuel_tae_submission", referenceEntityId: submission.id }, TEST_SESSION))
    expect(cases.some((c) => c.ruleCode === "litros_supera_capacidad")).toBe(true)
  })

  it("no duplica un caso ya resuelto en una segunda corrida del batch (fix de esta sesión)", async () => {
    const submission = baseSubmission({ liters: 600 })
    await inMemoryDb.insert(fuelTaeSubmissions).values(submission)
    await reviewTaeSubmission({ id: submission.id, expectedStatus: "submitted", status: "validated", reviewNote: "ok", userId })
    await runAllBatchRules()

    const before = await getAnomalyCases({ referenceEntityType: "fuel_tae_submission", referenceEntityId: submission.id }, TEST_SESSION)
    const created = before.cases.find((c) => c.ruleCode === "litros_supera_capacidad")
    expect(created).toBeDefined()

    // Un revisor descarta el caso — la condición que lo generó sigue ahí (la carga no cambia).
    await inMemoryDb.update(fuelAnomalyCases).set({ status: "dismissed" }).where(eq(fuelAnomalyCases.id, created!.id))

    // Segunda corrida del cron: no debe crear un caso nuevo para la misma carga.
    await runAllBatchRules()

    const after = await getAnomalyCases({ referenceEntityType: "fuel_tae_submission", referenceEntityId: submission.id, status: ["open", "in_review", "reopened"] }, TEST_SESSION)
    expect(after.cases.some((c) => c.ruleCode === "litros_supera_capacidad")).toBe(false)
  })

  // CO-029/CO-039: antes una regla activa SIN detector batch (las inline de
  // TAE, ej. sello_repetido) volvía `{created:0, skipped:0}` — indistinguible
  // de una regla que sí corrió y no encontró nada. El cron respondía 200 aunque
  // reglas reales hubieran reventado, porque el fallo también caía en {0,0}.
  it("distingue una regla sin detector batch de una que corrió y no encontró nada", async () => {
    const results = await runAllBatchRules()

    const withoutDetector = results.find((r) => r.ruleCode === "sello_repetido")
    expect(withoutDetector?.status).toBe("no_detector")

    const withDetector = results.find((r) => r.ruleCode === "litros_supera_capacidad")
    expect(withDetector?.status).toBe("completed")

    expect(results.every((r) => r.status === "completed" || r.status === "no_detector" || r.status === "failed")).toBe(true)
  })
})

describe("getAnomalyDistribution (sección 5 — gráfico de distribución)", () => {
  const distWorksiteId = nanoid()
  const distVehicleId = nanoid()
  const distEquipmentTypeId = nanoid()

  beforeAll(async () => {
    await inMemoryDb.insert(schema.worksites).values([
      { id: distWorksiteId, name: "Faena para distribución", code: `FD-${nanoid().slice(0, 8)}`, isActive: true },
    ])
    await inMemoryDb.insert(schema.fuelEquipmentTypes).values({
      id: distEquipmentTypeId, slug: `dist-camion-${nanoid().slice(0, 6)}`, name: "Camión",
    })
    await inMemoryDb.insert(schema.fuelVehicles).values({
      id: distVehicleId, plate: `DIST${nanoid().slice(0, 4).toUpperCase()}`, type: "camion", equipmentTypeId: distEquipmentTypeId,
      worksiteId: distWorksiteId, isActive: true, tankCapacityLiters: 100,
    })
  })

  it("devuelve agregación por estado, severidad y código de regla", async () => {
    const { getAnomalyDistribution } = await import("@/lib/combustibles/anomaly-cases")

    const rule = await inMemoryDb.query.fuelAnomalyRules.findFirst()
    expect(rule).toBeDefined()

    await inMemoryDb.insert(fuelAnomalyCases).values([
      {
        id: nanoid(), ruleId: rule!.id, ruleCode: "sello_repetido", severity: "high",
        description: "Sello repetido", status: "open", detectedAt: new Date().toISOString(),
        worksiteId: distWorksiteId, vehicleId: distVehicleId,
      },
      {
        id: nanoid(), ruleId: rule!.id, ruleCode: "evidencia_faltante", severity: "medium",
        description: "Evidencia faltante", status: "open", detectedAt: new Date().toISOString(),
        worksiteId: distWorksiteId, vehicleId: distVehicleId,
      },
      {
        id: nanoid(), ruleId: rule!.id, ruleCode: "evidencia_faltante", severity: "medium",
        description: "Evidencia faltante resuelta", status: "resolved", detectedAt: new Date().toISOString(),
        worksiteId: distWorksiteId, vehicleId: distVehicleId,
      },
    ])

    const dist = await getAnomalyDistribution({}, TEST_SESSION)

    expect(dist.total).toBeGreaterThanOrEqual(3)
    expect(dist.byStatus.some((s) => s.status === "open" && s.count >= 2)).toBe(true)
    expect(dist.byStatus.some((s) => s.status === "resolved" && s.count >= 1)).toBe(true)
    expect(dist.bySeverity.some((s) => s.severity === "high" && s.count >= 1)).toBe(true)
    expect(dist.bySeverity.some((s) => s.severity === "medium" && s.count >= 2)).toBe(true)
    expect(dist.byRuleCode.filter((r) => r.count > 0).length).toBeGreaterThanOrEqual(2)
  })

  it("filtra por worksiteId correctamente", async () => {
    const { getAnomalyDistribution } = await import("@/lib/combustibles/anomaly-cases")

    // Insertar worksite primero para respetar FK
    const anotherWorksite = nanoid()
    await inMemoryDb.insert(schema.worksites).values({
      id: anotherWorksite, name: "Otra faena para distribución", code: `OD-${nanoid().slice(0, 8)}`, isActive: true,
    })

    const rule = await inMemoryDb.query.fuelAnomalyRules.findFirst()
    await inMemoryDb.insert(fuelAnomalyCases).values({
      id: nanoid(), ruleId: rule!.id, ruleCode: "sello_repetido", severity: "low",
      description: "Caso en otra faena", status: "open", detectedAt: new Date().toISOString(),
      worksiteId: anotherWorksite, vehicleId: distVehicleId,
    })

    // Filtrar por faena principal: debe encontrar los casos creados antes
    const filtered = await getAnomalyDistribution({ worksiteId: distWorksiteId }, TEST_SESSION)
    expect(filtered.total).toBeGreaterThan(0)

    // Filtrar por otraWorksite: debe encontrar el caso nuevo
    const filteredOther = await getAnomalyDistribution({ worksiteId: anotherWorksite }, TEST_SESSION)
    expect(filteredOther.total).toBe(1)
  })
})

describe("isOutsideOperatingSchedule", () => {
  it("está exportada y es determinística (regresión de humo, la cobertura completa está en fuel-tae-schedule.test.ts)", () => {
    expect(isOutsideOperatingSchedule("2026-01-05T10:00:00-03:00", { timezone: "America/Santiago", days: [1, 2, 3, 4, 5], start: "08:00", end: "18:00" })).toBe(false)
  })
})
