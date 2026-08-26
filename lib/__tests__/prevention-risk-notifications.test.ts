/**
 * Notificaciones agrupadas de transiciones/aprobaciones MIPER (§Fase 7).
 *
 * Un `createNotifications` por operación, nunca uno por destinatario — la
 * red que atrapa una regresión a "una notificación por fila" es contar
 * llamadas al mock, no filas insertadas.
 */
import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { migratePGlite } from "@/lib/testing/pglite-migrate"
import * as schema from "@/db/schema"

const pg = new PGlite()
const inMemoryDb = drizzle(pg, { schema })
const testGlobal = globalThis as typeof globalThis & { __db?: typeof inMemoryDb }
// @ts-expect-error PGlite es compatible en runtime con el cliente postgres-js que usa el singleton.
testGlobal.__db = inMemoryDb

const createNotifications = vi.hoisted(() => vi.fn(async (_userIds: string[], _input: { title: string; body?: string; dedupeKey?: string; [key: string]: unknown }) => {}))
const getUserIdsWithPermissionForWorksite = vi.hoisted(() => vi.fn(async (permission: string) => {
  const audiences: Record<string, string[]> = {
    "prevention:risk:review": ["notif-reviewer-1", "notif-reviewer-2"],
    "prevention:risk:approve_prevention": ["notif-prevention-1"],
    "prevention:risk:approve_operations": ["notif-operations-1", "notif-operations-2"],
  }
  return audiences[permission] ?? []
}))

vi.mock("@/lib/services/notification-create", () => ({
  createNotifications,
  // Síncrono en el test: sin esto habría que esperar el microtask que
  // difiere `notifyAfterCommit` en producción (S-05).
  notifyAfterCommit: (thunk: () => unknown) => { void thunk() },
}))
vi.mock("@/lib/services/notification-targeting", () => ({ getUserIdsWithPermissionForWorksite }))

const WORKSITE = "ws-notif-test"

beforeAll(async () => {
  await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))
  const now = new Date().toISOString()
  await inMemoryDb.insert(schema.users).values([
    { id: "notif-author", email: "notif-author@chome.cl", name: "Autor", hashedPassword: "x", createdAt: now, updatedAt: now, isActive: true },
    { id: "notif-reviewer-1", email: "notif-reviewer-1@chome.cl", name: "Revisor 1", hashedPassword: "x", createdAt: now, updatedAt: now, isActive: true },
    { id: "notif-prevention-1", email: "notif-prevention-1@chome.cl", name: "Aprobador Prevención", hashedPassword: "x", createdAt: now, updatedAt: now, isActive: true },
    { id: "notif-operations-1", email: "notif-operations-1@chome.cl", name: "Aprobador Operaciones", hashedPassword: "x", createdAt: now, updatedAt: now, isActive: true },
  ])
  await inMemoryDb.insert(schema.worksites).values({ id: WORKSITE, name: "Faena Notificaciones", code: "NOTIF-TEST", createdAt: now, updatedAt: now })
  await inMemoryDb.insert(schema.preventionRiskMethodologies).values({
    id: "notif-methodology", code: "NOTIF-TEST", name: "Metodología de prueba", versionLabel: "v1",
    kind: "primary", authoritySource: "Prueba", configuration: {}, isActive: true, createdByUserId: "notif-author", createdAt: now,
  })
  await inMemoryDb.insert(schema.preventionRiskProcesses).values({ id: "notif-process", worksiteId: WORKSITE, code: "PROC", name: "Proceso", isActive: true, createdAt: now, updatedAt: now })
  await inMemoryDb.insert(schema.preventionRiskTasks).values({ id: "notif-task", processId: "notif-process", code: "TASK", name: "Tarea", isRoutine: true, isActive: true, createdAt: now, updatedAt: now })
  await inMemoryDb.insert(schema.preventionRiskPositions).values({ id: "notif-position", taskId: "notif-task", code: "POS", name: "Puesto", isActive: true, createdAt: now, updatedAt: now })
})

afterAll(async () => {
  delete testGlobal.__db
  await pg.close()
})

beforeEach(() => {
  createNotifications.mockClear()
  getUserIdsWithPermissionForWorksite.mockClear()
})

const now = () => new Date().toISOString()
let nextMatrixVersion = 1

async function insertDraftMatrixWithEntry(id: string) {
  const ts = now()
  const [matrix] = await inMemoryDb.insert(schema.preventionRiskMatrices).values({
    id, worksiteId: WORKSITE, matrixVersion: nextMatrixVersion++, title: `MIPER ${id}`,
    status: "draft", methodologyId: "notif-methodology", methodologySnapshot: {},
    revisionReason: "Prueba de notificaciones.", participationSummary: "No aplica.", consultationEvidenceReference: `acta-${id}`,
    createdByUserId: "notif-author", version: 1, createdAt: ts, updatedAt: ts,
  }).returning()
  await inMemoryDb.insert(schema.preventionRiskEntries).values({
    id: `notifentry-${id}`, matrixId: id, processId: "notif-process", taskId: "notif-task", positionId: "notif-position",
    hazardCode: "N-01", hazard: "Peligro de prueba", risk: "Riesgo de prueba", riskFactor: "Factor", expectedEventOrDamage: "Daño",
    exposedPeopleDescription: "Personal", genderConsiderations: "Sin diferencias.", sensitiveWorkerConsiderations: "Sin personas sensibles.",
    probability: 1, consequence: 1, riskMagnitude: 1, riskClassification: "tolerable", residualDimensions: {}, residualLevel: "low", residualScore: 1,
    responsibleSnapshot: "R", version: 1, createdAt: ts, updatedAt: ts,
  })
  return matrix!
}

async function insertReviewedMatrix(id: string) {
  const ts = now()
  const [matrix] = await inMemoryDb.insert(schema.preventionRiskMatrices).values({
    id, worksiteId: WORKSITE, matrixVersion: nextMatrixVersion++, title: `MIPER ${id}`,
    status: "reviewed", methodologyId: "notif-methodology", methodologySnapshot: {},
    revisionReason: "Prueba de notificaciones.", participationSummary: "No aplica.", consultationEvidenceReference: `acta-${id}`,
    createdByUserId: "notif-author", reviewedByUserId: "notif-reviewer-1", reviewedAt: ts,
    version: 1, createdAt: ts, updatedAt: ts,
  }).returning()
  return matrix!
}

function access(userId: string, permissions: string[]) {
  return { userId, scope: { mode: "some" as const, ids: [WORKSITE] }, permissions }
}

describe("Notificaciones agrupadas de MIPER (§Fase 7, PGlite)", () => {
  it("enviar a revisión notifica a los revisores en UNA sola llamada, no una por destinatario", async () => {
    const service = await import("@/lib/services/prevention-risk-legal")
    const matrix = await insertDraftMatrixWithEntry("notif-matrix-review")
    await service.transitionRiskMatrix({ matrixId: matrix.id, expectedVersion: 1, toStatus: "in_review", reason: "Contenido completo." }, access("notif-author", ["prevention:risk:edit"]))

    expect(createNotifications).toHaveBeenCalledTimes(1)
    const [recipients, payload] = createNotifications.mock.calls[0]!
    expect(recipients.sort()).toEqual(["notif-reviewer-1", "notif-reviewer-2"])
    expect(payload).toMatchObject({ dedupeKey: `risk-matrix:${matrix.id}:v2:in_review` })
  })

  it("la firma de un solo dominio notifica UNA vez al otro dominio, no una vez por firmante", async () => {
    const service = await import("@/lib/services/prevention-risk-legal")
    const matrix = await insertReviewedMatrix("notif-matrix-pending")
    await service.decideRiskMatrixApproval({ matrixId: matrix.id, expectedVersion: 1, domain: "prevention", decision: "approved", reason: "Prevención aprueba." }, access("notif-prevention-1", ["prevention:risk:approve_prevention"]))

    expect(createNotifications).toHaveBeenCalledTimes(1)
    const [recipients, payload] = createNotifications.mock.calls[0]!
    expect(recipients.sort()).toEqual(["notif-operations-1", "notif-operations-2"])
    expect(payload).toMatchObject({ dedupeKey: `risk-matrix:${matrix.id}:v1:pending:operations` })
  })

  it("completar las dos firmas notifica UNA vez al autor, no una por dominio que firmó", async () => {
    const service = await import("@/lib/services/prevention-risk-legal")
    const matrix = await insertReviewedMatrix("notif-matrix-complete")
    await service.decideRiskMatrixApproval({ matrixId: matrix.id, expectedVersion: 1, domain: "prevention", decision: "approved", reason: "Prevención aprueba." }, access("notif-prevention-1", ["prevention:risk:approve_prevention"]))
    createNotifications.mockClear()

    await service.decideRiskMatrixApproval({ matrixId: matrix.id, expectedVersion: 1, domain: "operations", decision: "approved", reason: "Operaciones aprueba." }, access("notif-operations-1", ["prevention:risk:approve_operations"]))

    expect(createNotifications).toHaveBeenCalledTimes(1)
    const [recipients, payload] = createNotifications.mock.calls[0]!
    expect(recipients).toEqual(["notif-author"])
    expect(payload).toMatchObject({ dedupeKey: `risk-matrix:${matrix.id}:v2:approved` })
  })

  it("un rechazo notifica UNA vez al autor con el motivo", async () => {
    const service = await import("@/lib/services/prevention-risk-legal")
    const matrix = await insertReviewedMatrix("notif-matrix-rejected")
    await service.decideRiskMatrixApproval({ matrixId: matrix.id, expectedVersion: 1, domain: "operations", decision: "rejected", reason: "Falta responsable en un control crítico." }, access("notif-operations-1", ["prevention:risk:approve_operations"]))

    expect(createNotifications).toHaveBeenCalledTimes(1)
    const [recipients, payload] = createNotifications.mock.calls[0]!
    expect(recipients).toEqual(["notif-author"])
    expect(payload).toMatchObject({ dedupeKey: `risk-matrix:${matrix.id}:v2:rejected:operations` })
    expect(payload.body).toContain("Falta responsable en un control crítico.")
  })
})
