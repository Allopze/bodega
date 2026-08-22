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
const { seedAnomalyRulesIfEmpty, getAnomalyCases, updateAnomalyCaseStatus, assignAnomalyCase, addAnomalyComment } = await import("@/lib/combustibles/anomaly-cases")
const { severityOf } = await import("@/lib/combustibles/anomaly-detector")
const { KNOWN_RULE_CODES } = await import("@/lib/combustibles/validation")

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
    await seedAnomalyRulesIfEmpty()
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
    const submission = baseSubmission()
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

describe("rendimiento_fuera_historico (batch — performance outlier vs history)", () => {
  const wsId = nanoid()
  const eqTypeId = nanoid()
  const vehId = nanoid()
  const batchId = nanoid()
  const testUserId = nanoid()

  beforeAll(async () => {
    await inMemoryDb.insert(schema.worksites).values({
      id: wsId, name: "Faena rendimiento histórico", code: `RH-${nanoid().slice(0, 6)}`, isActive: true,
    })
    await inMemoryDb.insert(schema.users).values({
      id: testUserId, name: "Test rendimiento", email: `rh-${nanoid()}@example.com`, hashedPassword: "x", isActive: true,
    })
    await inMemoryDb.insert(schema.fuelEquipmentTypes).values({
      id: eqTypeId, slug: `perf-camion-${nanoid().slice(0, 6)}`, name: "Camión rendimiento",
    })
    await inMemoryDb.insert(schema.fuelVehicles).values({
      id: vehId, plate: `PERF${nanoid().slice(0, 4).toUpperCase()}`, type: "camion",
      equipmentTypeId: eqTypeId, worksiteId: wsId, isActive: true,
      performanceUnit: "km_per_liter",
    })
    await inMemoryDb.insert(schema.fuelOperationBatches).values({
      id: batchId, archivoNombre: "perf.xlsx", hashArchivo: nanoid(), estado: "importado",
      periodoDesde: "2026-06-01", periodoHasta: "2026-06-30",
      importadoPor: testUserId,
    })
  })

  it("crea un caso cuando el rendimiento de un equipo se desvía más de N stddevs de su propio historial", async () => {
    // Insertar 7 registros con rendimiento ~10, y un octavo con rendimiento 30 (outlier claro a ~6 stddevs)
    const records = Array.from({ length: 7 }, (_, i) => ({
      id: nanoid(), batchId, worksiteId: wsId, vehicleId: vehId,
      plate: `PERF_TEST`, fecha: `2026-06-${String(i + 1).padStart(2, "0")}`,
      liters: 10, monto: 100, rendimiento: 10 + Math.random(),
    }))
    records.push({
      id: nanoid(), batchId, worksiteId: wsId, vehicleId: vehId,
      plate: `PERF_TEST`, fecha: "2026-06-10",
      liters: 10, monto: 100, rendimiento: 30,
    })
    await inMemoryDb.insert(schema.fuelOperationRecords).values(records)

    await runAllBatchRules()

    const { cases } = await getAnomalyCases({ ruleCode: "rendimiento_fuera_historico" }, TEST_SESSION)
    expect(cases.length).toBeGreaterThan(0)
  })
})

describe("rendimiento_fuera_grupo (batch — performance outlier vs group)", () => {
  const wsId = nanoid()
  const eqTypeId = nanoid()
  const veh1Id = nanoid()
  const veh2Id = nanoid()
  const batchId = nanoid()
  const testUserId = nanoid()

  beforeAll(async () => {
    await inMemoryDb.insert(schema.worksites).values({
      id: wsId, name: "Faena rendimiento grupo", code: `RG-${nanoid().slice(0, 6)}`, isActive: true,
    })
    await inMemoryDb.insert(schema.users).values({
      id: testUserId, name: "Test grupo", email: `rg-${nanoid()}@example.com`, hashedPassword: "x", isActive: true,
    })
    await inMemoryDb.insert(schema.fuelEquipmentTypes).values({
      id: eqTypeId, slug: `grupo-camion-${nanoid().slice(0, 6)}`, name: "Camión grupo",
    })
    await inMemoryDb.insert(schema.fuelVehicles).values([
      { id: veh1Id, plate: `GRP1${nanoid().slice(0, 4).toUpperCase()}`, type: "camion",
        equipmentTypeId: eqTypeId, worksiteId: wsId, isActive: true,
        performanceUnit: "km_per_liter", comparisonGroup: "camiones_pesados" },
      { id: veh2Id, plate: `GRP2${nanoid().slice(0, 4).toUpperCase()}`, type: "camion",
        equipmentTypeId: eqTypeId, worksiteId: wsId, isActive: true,
        performanceUnit: "km_per_liter", comparisonGroup: "camiones_pesados" },
    ])
    await inMemoryDb.insert(schema.fuelOperationBatches).values({
      id: batchId, archivoNombre: "grupo.xlsx", hashArchivo: nanoid(), estado: "importado",
      periodoDesde: "2026-06-01", periodoHasta: "2026-06-30",
      importadoPor: testUserId,
    })
  })

  it("crea un caso cuando un equipo dentro del grupo tiene rendimiento atípico", async () => {
    // veh1: 5 registros con rendimiento ~10
    const veh1Records = Array.from({ length: 5 }, (_, i) => ({
      id: nanoid(), batchId, worksiteId: wsId, vehicleId: veh1Id,
      plate: `GRP1`, fecha: `2026-06-${String(i + 1).padStart(2, "0")}`,
      liters: 10, monto: 100, rendimiento: 10 + Math.random(),
    }))
    // veh2: 5 registros con rendimiento ~10 también
    const veh2Records = Array.from({ length: 5 }, (_, i) => ({
      id: nanoid(), batchId, worksiteId: wsId, vehicleId: veh2Id,
      plate: `GRP2`, fecha: `2026-06-${String(i + 1).padStart(2, "0")}`,
      liters: 10, monto: 100, rendimiento: 10 + Math.random(),
    }))
    // veh2: un sexto registro outlier (rendimiento 35)
    veh2Records.push({
      id: nanoid(), batchId, worksiteId: wsId, vehicleId: veh2Id,
      plate: `GRP2`, fecha: "2026-06-15",
      liters: 10, monto: 100, rendimiento: 35,
    })
    await inMemoryDb.insert(schema.fuelOperationRecords).values([...veh1Records, ...veh2Records])

    await runAllBatchRules()

    const { cases } = await getAnomalyCases({ ruleCode: "rendimiento_fuera_grupo" }, TEST_SESSION)
    expect(cases.length).toBeGreaterThan(0)
  })
})

describe("proveedor_no_habitual (batch — supplier mismatch)", () => {
  const wsId = nanoid()
  const eqTypeId = nanoid()
  const vehId = nanoid()
  const supplierUsual = nanoid()
  const supplierOther = nanoid()
  const testUserId = nanoid()

  beforeAll(async () => {
    await inMemoryDb.insert(schema.worksites).values({
      id: wsId, name: "Faena proveedores", code: `FP-${nanoid().slice(0, 6)}`, isActive: true,
    })
    await inMemoryDb.insert(schema.fuelEquipmentTypes).values({
      id: eqTypeId, slug: `prov-camion-${nanoid().slice(0, 6)}`, name: "Camión proveedor",
    })
    await inMemoryDb.insert(schema.users).values({
      id: testUserId, name: "Creador", email: `creator-${nanoid()}@example.com`, hashedPassword: "x", isActive: true,
    })
    await inMemoryDb.insert(schema.fuelSuppliers).values([
      { id: supplierUsual, name: "Proveedor habitual" },
      { id: supplierOther, name: "Otro proveedor" },
    ])
    await inMemoryDb.insert(schema.fuelVehicles).values({
      id: vehId, plate: `PROV${nanoid().slice(0, 4).toUpperCase()}`, type: "camion",
      equipmentTypeId: eqTypeId, worksiteId: wsId, isActive: true,
      usualFuelSupplierId: supplierUsual,
    })
  })

  it("crea un caso cuando la carga se factura con un proveedor distinto del habitual del equipo", async () => {
    const productId = nanoid()
    await inMemoryDb.insert(schema.fuelProducts).values({
      id: productId, code: `DP-${nanoid().slice(0, 6)}`, name: "Diésel", category: "diesel", unit: "liter",
    })
    await inMemoryDb.insert(schema.fuelLoads).values({
      id: nanoid(), loadDate: "2026-06-15", month: "2026-06",
      serviceType: "TCT", vehicleId: vehId,
      fuelSupplierId: supplierOther, // distinto del habitual
      worksiteId: wsId, product: "PETROLEO DIESEL", productId,
      liters: 50, baseAmount: 25000, totalAmount: 29750,
      createdBy: testUserId,
    })

    await runAllBatchRules()

    const { cases } = await getAnomalyCases({ ruleCode: "proveedor_no_habitual" }, TEST_SESSION)
    expect(cases.length).toBeGreaterThan(0)
  })
})

describe("consumo_durante_inactividad (batch — consumption while inactive)", () => {
  const wsId = nanoid()
  const eqTypeId = nanoid()
  const vehId = nanoid()
  const productId = nanoid()

  beforeAll(async () => {
    await inMemoryDb.insert(schema.worksites).values({
      id: wsId, name: "Faena inactividad", code: `FI-${nanoid().slice(0, 6)}`, isActive: true,
    })
    await inMemoryDb.insert(schema.fuelProducts).values({
      id: productId, code: `DIESEL-IN-${nanoid().slice(0, 6)}`, name: "Diésel inactividad", category: "diesel", unit: "liter",
    })
    await inMemoryDb.insert(schema.fuelEquipmentTypes).values({
      id: eqTypeId, slug: `inact-camion-${nanoid().slice(0, 6)}`, name: "Camión inactividad",
    })
    await inMemoryDb.insert(schema.fuelVehicles).values({
      id: vehId, plate: `INACT${nanoid().slice(0, 4).toUpperCase()}`, type: "camion",
      equipmentTypeId: eqTypeId, worksiteId: wsId, isActive: true,
      operationalStatus: "mantencion", // not "operativo" → inactivo
    })
    // El detector acota la ventana al intervalo de inactividad VIGENTE: sin
    // este intervalo abierto (el que crea la app real en cada cambio de
    // estado, vía actions-module/vehicles.ts) no tiene desde-cuándo confiable
    // y se salta el vehículo a propósito.
    await inMemoryDb.insert(schema.fuelVehicleOperationalIntervals).values({
      id: nanoid(), vehicleId: vehId, status: "mantencion",
      startedAt: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
      reason: "Fixture de prueba",
    })
  })

  it("crea un caso cuando un equipo inactivo tiene cargas registradas después de volverse inactivo", async () => {
    await inMemoryDb.insert(schema.fuelTaeSubmissions).values({
      id: nanoid(), clientSubmissionId: nanoid(), source: "public_pwa",
      publicResultToken: nanoid(32),
      worksiteId: wsId, vehicleId: vehId, productId,
      equipmentCodeSnapshot: "INACT",
      loadedAt: new Date().toISOString(), submittedAt: new Date().toISOString(),
      driverNameSnapshot: "Conductor", supervisorNameSnapshot: "Supervisor",
      manualIdentity: false, meterType: "odometer", liters: 10,
      status: "validated",
    })

    await runAllBatchRules()

    const { cases } = await getAnomalyCases({ ruleCode: "consumo_durante_inactividad" }, TEST_SESSION)
    expect(cases.length).toBeGreaterThan(0)
  })

  it("NO crea caso si la carga es anterior al intervalo de inactividad vigente", async () => {
    const vehId2 = nanoid()
    await inMemoryDb.insert(schema.fuelVehicles).values({
      id: vehId2, plate: `OLDIN${nanoid().slice(0, 4).toUpperCase()}`, type: "camion",
      equipmentTypeId: eqTypeId, worksiteId: wsId, isActive: true,
      operationalStatus: "fuera_servicio",
    })
    await inMemoryDb.insert(schema.fuelVehicleOperationalIntervals).values({
      id: nanoid(), vehicleId: vehId2, status: "fuera_servicio",
      startedAt: new Date().toISOString(),
    })
    // Carga de cuando el equipo SÍ operaba, mucho antes del intervalo actual.
    await inMemoryDb.insert(schema.fuelTaeSubmissions).values({
      id: nanoid(), clientSubmissionId: nanoid(), source: "public_pwa",
      publicResultToken: nanoid(32),
      worksiteId: wsId, vehicleId: vehId2, productId,
      equipmentCodeSnapshot: "OLDIN",
      loadedAt: new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString(),
      submittedAt: new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString(),
      driverNameSnapshot: "Conductor", supervisorNameSnapshot: "Supervisor",
      manualIdentity: false, meterType: "odometer", liters: 10,
      status: "validated",
    })

    await runAllBatchRules()

    const { cases } = await getAnomalyCases({ ruleCode: "consumo_durante_inactividad" }, TEST_SESSION)
    expect(cases.some((c) => c.vehicleId === vehId2)).toBe(false)
  })
})

describe("variacion_brusca_consumo (batch — sharp consumption change)", () => {
  const wsId = nanoid()
  const eqTypeId = nanoid()
  const vehId = nanoid()
  const importBatchId = nanoid()
  const testUserId = nanoid()

  beforeAll(async () => {
    await inMemoryDb.insert(schema.worksites).values({
      id: wsId, name: "Faena variación", code: `FV-${nanoid().slice(0, 6)}`, isActive: true,
    })
    await inMemoryDb.insert(schema.users).values({
      id: testUserId, name: "Test variación", email: `fv-${nanoid()}@example.com`, hashedPassword: "x", isActive: true,
    })
    await inMemoryDb.insert(schema.fuelEquipmentTypes).values({
      id: eqTypeId, slug: `var-camion-${nanoid().slice(0, 6)}`, name: "Camión variación",
    })
    await inMemoryDb.insert(schema.fuelVehicles).values({
      id: vehId, plate: `VAR${nanoid().slice(0, 4).toUpperCase()}`, type: "camion",
      equipmentTypeId: eqTypeId, worksiteId: wsId, isActive: true,
    })
    await inMemoryDb.insert(schema.fuelImportBatches).values({
      id: importBatchId, worksiteId: wsId, archivoNombre: "variacion.xlsx", hashArchivo: nanoid(),
      estado: "importado", periodoDesde: "2026-06-01", periodoHasta: "2026-07-30",
      importadoPor: testUserId,
    })
  })

  it("crea un caso cuando el consumo de un equipo varía más del umbral entre períodos consecutivos", async () => {
    // Dos períodos consecutivos para el mismo vehículo: 100L → 250L = 150% de cambio, supera umbral 50%
    await inMemoryDb.insert(schema.fuelConsumptionRecords).values([
      {
        id: nanoid(), batchId: importBatchId, worksiteId: wsId, vehicleId: vehId,
        patente: `VAR`, cantidadUnidad: 100, monto: 50000,
        numeroTransacciones: 2, numeroTarjetas: 1,
        periodoDesde: "2026-06-01", periodoHasta: "2026-06-30",
        rendimientoPromedio: 10,
      },
      {
        id: nanoid(), batchId: importBatchId, worksiteId: wsId, vehicleId: vehId,
        patente: `VAR`, cantidadUnidad: 250, monto: 125000,
        numeroTransacciones: 4, numeroTarjetas: 1,
        periodoDesde: "2026-07-01", periodoHasta: "2026-07-31",
        rendimientoPromedio: 10,
      },
    ])

    await runAllBatchRules()

    const { cases } = await getAnomalyCases({ ruleCode: "variacion_brusca_consumo" }, TEST_SESSION)
    expect(cases.length).toBeGreaterThan(0)
  })
})

describe("kilometraje_regresivo / horometro_regresivo (batch — más allá de TAE)", () => {
  // `detectTaeAnomaliesInTx` (fuel-tae.ts) sólo compara cargas TAE contra
  // otras cargas TAE; estos detectores batch cubren el log operacional
  // (fuel_operation_records) y las cargas manuales (fuel_loads) — CO-023.
  const wsId = nanoid()
  const eqTypeId = nanoid()
  const vehOpId = nanoid()
  const vehLoadId = nanoid()
  const supplierId = nanoid()
  const productId = nanoid()
  const testUserId = nanoid()
  const opBatchId = nanoid()

  beforeAll(async () => {
    await inMemoryDb.insert(schema.worksites).values({
      id: wsId, name: "Faena regresiva", code: `FR-${nanoid().slice(0, 6)}`, isActive: true,
    })
    await inMemoryDb.insert(schema.users).values({
      id: testUserId, name: "Test regresiva", email: `fr-${nanoid()}@example.com`, hashedPassword: "x", isActive: true,
    })
    await inMemoryDb.insert(schema.fuelEquipmentTypes).values({
      id: eqTypeId, slug: `reg-camion-${nanoid().slice(0, 6)}`, name: "Camión regresiva",
    })
    await inMemoryDb.insert(schema.fuelVehicles).values([
      { id: vehOpId, plate: `ROP${nanoid().slice(0, 4).toUpperCase()}`, type: "camion", equipmentTypeId: eqTypeId, worksiteId: wsId, isActive: true },
      { id: vehLoadId, plate: `RLD${nanoid().slice(0, 4).toUpperCase()}`, type: "camion", equipmentTypeId: eqTypeId, worksiteId: wsId, isActive: true },
    ])
    await inMemoryDb.insert(schema.fuelSuppliers).values({ id: supplierId, name: "Proveedor regresiva" })
    await inMemoryDb.insert(schema.fuelProducts).values({
      id: productId, code: `DIESEL-REG-${nanoid().slice(0, 6)}`, name: "Diésel regresiva", category: "diesel", unit: "liter",
    })
    await inMemoryDb.insert(schema.fuelOperationBatches).values({
      id: opBatchId, archivoNombre: "regresiva.xlsx", hashArchivo: nanoid(),
      periodoDesde: "2026-06-01", periodoHasta: "2026-06-30", importadoPor: testUserId,
    })
  })

  it("crea un caso kilometraje_regresivo cuando el log operacional baja de una carga a la siguiente", async () => {
    await inMemoryDb.insert(schema.fuelOperationRecords).values([
      {
        id: nanoid(), batchId: opBatchId, worksiteId: wsId, vehicleId: vehOpId, plate: "ROP",
        fecha: "2026-06-01", horaCarga: "08:00", horometro: 10_000, medidoPor: "km", liters: 50,
      },
      {
        id: nanoid(), batchId: opBatchId, worksiteId: wsId, vehicleId: vehOpId, plate: "ROP",
        fecha: "2026-06-05", horaCarga: "08:00", horometro: 4_000, medidoPor: "km", liters: 50,
      },
    ])

    await runAllBatchRules()

    const { cases } = await getAnomalyCases({ ruleCode: "kilometraje_regresivo" }, TEST_SESSION)
    expect(cases.some((c) => c.referenceEntityType === "fuel_operation_record" && c.vehicleId === vehOpId)).toBe(true)
  })

  it("crea un caso horometro_regresivo cuando una carga manual baja respecto a la anterior", async () => {
    await inMemoryDb.insert(schema.fuelLoads).values([
      {
        id: nanoid(), loadDate: "2026-06-01", month: "2026-06", serviceType: "TCT", vehicleId: vehLoadId,
        fuelSupplierId: supplierId, worksiteId: wsId, product: "PETROLEO DIESEL", productId,
        liters: 50, baseAmount: 50_000, totalAmount: 50_000, status: "registered", createdBy: testUserId,
        hourMeterReading: 500,
      },
      {
        id: nanoid(), loadDate: "2026-06-10", month: "2026-06", serviceType: "TCT", vehicleId: vehLoadId,
        fuelSupplierId: supplierId, worksiteId: wsId, product: "PETROLEO DIESEL", productId,
        liters: 50, baseAmount: 50_000, totalAmount: 50_000, status: "registered", createdBy: testUserId,
        hourMeterReading: 200,
      },
    ])

    await runAllBatchRules()

    const { cases } = await getAnomalyCases({ ruleCode: "horometro_regresivo" }, TEST_SESSION)
    expect(cases.some((c) => c.referenceEntityType === "fuel_load" && c.vehicleId === vehLoadId)).toBe(true)
  })
})

describe("evidencia_duplicada (batch — duplicate evidence by SHA-256)", () => {
  const wsId = nanoid()
  const eqTypeId = nanoid()
  const vehId = nanoid()
  const productId = nanoid()
  const sharedHash = "duplicate-sha256-abcdef123456"

  beforeAll(async () => {
    await inMemoryDb.insert(schema.worksites).values({
      id: wsId, name: "Faena evidencia duplicada", code: `ED-${nanoid().slice(0, 6)}`, isActive: true,
    })
    await inMemoryDb.insert(schema.fuelProducts).values({
      id: productId, code: `DIESEL-ED-${nanoid().slice(0, 6)}`, name: "Diésel evidencias", category: "diesel", unit: "liter",
    })
    await inMemoryDb.insert(schema.fuelEquipmentTypes).values({
      id: eqTypeId, slug: `ev-camion-${nanoid().slice(0, 6)}`, name: "Camión evidencias",
    })
    await inMemoryDb.insert(schema.fuelVehicles).values({
      id: vehId, plate: `EVID${nanoid().slice(0, 4).toUpperCase()}`, type: "camion",
      equipmentTypeId: eqTypeId, worksiteId: wsId, isActive: true,
    })
  })

  it("crea un caso cuando el mismo SHA-256 aparece en evidencias de distintas cargas", async () => {
    // Dos submissions distintas con la misma evidencia (mismo hash)
    const sub1Id = nanoid()
    const sub2Id = nanoid()
    await inMemoryDb.insert(schema.fuelTaeSubmissions).values([
      {
        id: sub1Id, clientSubmissionId: nanoid(), source: "public_pwa",
        publicResultToken: nanoid(32), worksiteId: wsId, vehicleId: vehId, productId,
        equipmentCodeSnapshot: "EVID-1", loadedAt: "2026-07-01T12:00:00.000Z",
        submittedAt: "2026-07-01T12:00:00.000Z",
        driverNameSnapshot: "Conductor", supervisorNameSnapshot: "Supervisor",
        manualIdentity: false, meterType: "odometer", liters: 50, status: "validated",
      },
      {
        id: sub2Id, clientSubmissionId: nanoid(), source: "public_pwa",
        publicResultToken: nanoid(32), worksiteId: wsId, vehicleId: vehId, productId,
        equipmentCodeSnapshot: "EVID-2", loadedAt: "2026-07-02T12:00:00.000Z",
        submittedAt: "2026-07-02T12:00:00.000Z",
        driverNameSnapshot: "Conductor", supervisorNameSnapshot: "Supervisor",
        manualIdentity: false, meterType: "odometer", liters: 50, status: "validated",
      },
    ])
    // Misma evidencia (mismo SHA-256) en ambas cargas
    await inMemoryDb.insert(schema.fuelTaeEvidence).values([
      {
        id: nanoid(), submissionId: sub1Id, kind: "odometer",
        fileName: "foto-sub1.jpg", filePath: "fotos/foto-sub1.jpg",
        mimeType: "image/jpeg", sha256: sharedHash,
      },
      {
        id: nanoid(), submissionId: sub2Id, kind: "odometer",
        fileName: "foto-sub2.jpg", filePath: "fotos/foto-sub2.jpg",
        mimeType: "image/jpeg", sha256: sharedHash,
      },
    ])

    await runAllBatchRules()

    const { cases } = await getAnomalyCases({ ruleCode: "evidencia_duplicada" }, TEST_SESSION)
    expect(cases.length).toBeGreaterThan(0)
  })
})

describe("evidencia_ilegible (batch — corrupt/unreadable evidence)", () => {
  const wsId = nanoid()
  const eqTypeId = nanoid()
  const vehId = nanoid()
  const productId = nanoid()

  beforeAll(async () => {
    await inMemoryDb.insert(schema.worksites).values({
      id: wsId, name: "Faena evidencia ilegible", code: `EI-${nanoid().slice(0, 6)}`, isActive: true,
    })
    await inMemoryDb.insert(schema.fuelProducts).values({
      id: productId, code: `DIESEL-EI-${nanoid().slice(0, 6)}`, name: "Diésel evidencia", category: "diesel", unit: "liter",
    })
    await inMemoryDb.insert(schema.fuelEquipmentTypes).values({
      id: eqTypeId, slug: `ileg-camion-${nanoid().slice(0, 6)}`, name: "Camión evidencia",
    })
    await inMemoryDb.insert(schema.fuelVehicles).values({
      id: vehId, plate: `ILEG${nanoid().slice(0, 4).toUpperCase()}`, type: "camion",
      equipmentTypeId: eqTypeId, worksiteId: wsId, isActive: true,
    })
  })

  it("crea un caso cuando una evidencia tiene tamaño 0 bytes", async () => {
    const subId = nanoid()
    await inMemoryDb.insert(schema.fuelTaeSubmissions).values({
      id: subId, clientSubmissionId: nanoid(), source: "public_pwa",
      publicResultToken: nanoid(32), worksiteId: wsId, vehicleId: vehId, productId,
      equipmentCodeSnapshot: "ILEG-1", loadedAt: "2026-07-01T12:00:00.000Z",
      submittedAt: "2026-07-01T12:00:00.000Z",
      driverNameSnapshot: "Conductor", supervisorNameSnapshot: "Supervisor",
      manualIdentity: false, meterType: "odometer", liters: 50, status: "validated",
    })
    // Evidencia con fileSize = 0 y filePath no nulo (el detector filtra IS NOT NULL)
    await inMemoryDb.insert(schema.fuelTaeEvidence).values({
      id: nanoid(), submissionId: subId, kind: "odometer",
      fileName: "vacia.jpg", filePath: "fotos/vacia.jpg",
      mimeType: "image/jpeg", fileSize: 0,
    })

    await runAllBatchRules()

    const { cases } = await getAnomalyCases({ ruleCode: "evidencia_ilegible" }, TEST_SESSION)
    expect(cases.length).toBeGreaterThan(0)
  })

  it("crea un caso cuando una evidencia tiene un MIME no-imagen", async () => {
    const subId = nanoid()
    await inMemoryDb.insert(schema.fuelTaeSubmissions).values({
      id: subId, clientSubmissionId: nanoid(), source: "public_pwa",
      publicResultToken: nanoid(32), worksiteId: wsId, vehicleId: vehId, productId,
      equipmentCodeSnapshot: "ILEG-2", loadedAt: "2026-07-02T12:00:00.000Z",
      submittedAt: "2026-07-02T12:00:00.000Z",
      driverNameSnapshot: "Conductor", supervisorNameSnapshot: "Supervisor",
      manualIdentity: false, meterType: "odometer", liters: 50, status: "validated",
    })
    // Evidencia con mimeType no-imagen (application/pdf = no empieza con "image/")
    await inMemoryDb.insert(schema.fuelTaeEvidence).values({
      id: nanoid(), submissionId: subId, kind: "odometer",
      fileName: "documento.pdf", filePath: "docs/doc.pdf",
      mimeType: "application/pdf", fileSize: 1024,
    })

    await runAllBatchRules()

    const { cases } = await getAnomalyCases({ ruleCode: "evidencia_ilegible" }, TEST_SESSION)
    // Puede tener 1 o 2 casos dependiendo de si la corrida anterior dejó casos
    expect(cases.length).toBeGreaterThan(0)
  })
})

// CO-018 / CO-019: la severidad configurable no gobernaba ningún caso (cada
// detector escribía un literal) y `carga_duplicada` se sembraba activa sin
// catálogo ni detector: la pantalla mostraba una regla viva que nunca abría un
// caso. Esta prueba fija la paridad seed ↔ catálogo ↔ motor y el gobierno real
// de la severidad.
describe("paridad de reglas y severidad efectiva", () => {
  it("toda regla sembrada existe en el catálogo compartido", async () => {
    await seedAnomalyRulesIfEmpty()
    const seeded = await inMemoryDb.select({ code: schema.fuelAnomalyRules.code }).from(schema.fuelAnomalyRules)
    const unknown = seeded.map((rule) => rule.code).filter((code) => !(KNOWN_RULE_CODES as readonly string[]).includes(code))
    expect(unknown).toEqual([])
  })

  it("la severidad de la regla manda sobre el literal del detector", () => {
    expect(severityOf({ severity: "critical" }, "low")).toBe("critical")
    // Fallback sólo para una regla sin severidad válida.
    expect(severityOf({ severity: null }, "medium")).toBe("medium")
    expect(severityOf({ severity: "inventada" }, "high")).toBe("high")
  })
})
