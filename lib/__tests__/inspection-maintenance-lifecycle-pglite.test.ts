import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { eq } from "drizzle-orm"
import { drizzle } from "drizzle-orm/pglite"
import type { Session } from "next-auth"
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest"
import * as schema from "@/db/schema"
import type { WorksiteScope } from "@/lib/auth/scope"
import { migratePGlite } from "@/lib/testing/pglite-migrate"

const pg = new PGlite()
const testDb = drizzle(pg, { schema })
const testGlobal = globalThis as typeof globalThis & { __db?: typeof testDb }
// @ts-expect-error PGlite is compatible with the application's Drizzle client at runtime.
testGlobal.__db = testDb

vi.mock("@/db", () => ({
  get db() {
    return testGlobal.__db
  },
}))

vi.mock("@/lib/services/notification-targeting", () => ({
  getUserIdsWithPermission: vi.fn(async () => []),
  getUserIdsWithPermissionForWorksite: vi.fn(async () => []),
}))

vi.mock("@/lib/services/notifications", () => ({ createNotifications: vi.fn() }))
vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))

const USER_ID = "inspection-maintenance-user"
const WORKSITE_ID = "inspection-maintenance-worksite"
const VEHICLE_ID = "inspection-maintenance-vehicle"
const RUN_ID = "inspection-maintenance-run"
const FINDING_ID = "inspection-maintenance-finding"

const inspectionAccess = {
  userId: USER_ID,
  scope: { mode: "some", ids: [WORKSITE_ID] } as WorksiteScope,
  permissions: ["prevention:inspections:view", "prevention:inspections:execute"],
}

const maintenanceSession = {
  user: {
    id: USER_ID,
    isGlobal: false,
    worksiteIds: [WORKSITE_ID],
    roles: [],
    permissions: ["mantenciones:edit"],
  },
} as unknown as Session

async function seedFinding() {
  const now = "2026-08-31T12:00:00.000Z"
  await testDb.insert(schema.users).values({
    id: USER_ID,
    name: "Responsable Mantención",
    email: "inspection-maintenance@example.test",
    hashedPassword: "hash",
    createdAt: now,
    updatedAt: now,
  })
  await testDb.insert(schema.worksites).values({
    id: WORKSITE_ID,
    code: "IMT",
    name: "Faena ciclo inspección mantención",
  })
  await testDb.insert(schema.fuelEquipmentTypes).values({
    id: "inspection-maintenance-equipment-type",
    slug: "inspection_maintenance_truck",
    name: "Camión prueba inspección",
    category: "truck",
    defaultMeterType: "odometer",
  })
  await testDb.insert(schema.fuelVehicles).values({
    id: VEHICLE_ID,
    plate: "IMTT01",
    code: "IMT-01",
    type: "camion",
    equipmentTypeId: "inspection-maintenance-equipment-type",
    meterType: "odometer",
    worksiteId: WORKSITE_ID,
  })
  await testDb.insert(schema.preventionInspectionTemplates).values({
    id: "inspection-maintenance-template",
    code: "inspection_maintenance_template",
    versionLabel: "01",
    name: "Inspección de camión",
    kind: "inspection",
    definitionSnapshot: { sections: [] },
    contentHash: "a".repeat(64),
    status: "approved",
    authorUserId: USER_ID,
    approvedByUserId: USER_ID,
    approvedAt: now,
  })
  await testDb.insert(schema.preventionInspectionRuns).values({
    id: RUN_ID,
    code: "INS-IMT-001",
    templateId: "inspection-maintenance-template",
    worksiteId: WORKSITE_ID,
    subjectVehicleId: VEHICLE_ID,
    subjectLabel: "IMT-01 · IMTT01",
    status: "completed",
    executedByUserId: USER_ID,
    executedAt: now,
    createdByUserId: USER_ID,
  })
  await testDb.insert(schema.preventionInspectionFindings).values({
    id: FINDING_ID,
    runId: RUN_ID,
    description: "El camión presenta falla en el sistema de frenos",
    danoPotencial: "fatal",
    criticality: "critical",
    status: "open",
  })
}

async function deriveFinding() {
  const { createFindingCapa } = await import("@/lib/services/prevention-inspections")
  return createFindingCapa({
    findingId: FINDING_ID,
    actionDescription: "Reparar y probar el sistema completo de frenos.",
    responsibleUserId: USER_ID,
  }, inspectionAccess)
}

beforeEach(async () => {
  await pg.exec("TRUNCATE TABLE users, worksites, fuel_equipment_types RESTART IDENTITY CASCADE")
  await seedFinding()
})

afterAll(async () => {
  delete testGlobal.__db
  await pg.close()
})

describe("ciclo hallazgo de inspección y mantención correctiva", () => {
  it("crea siempre una OT correctiva al derivar el hallazgo de un vehículo", async () => {
    const result = await deriveFinding()

    expect(result.maintenanceId).toBeTruthy()
    const [record] = await testDb.select().from(schema.maintenanceRecords)
      .where(eq(schema.maintenanceRecords.inspectionFindingId, FINDING_ID))
    expect(record).toMatchObject({
      id: result.maintenanceId,
      vehicleId: VEHICLE_ID,
      maintenanceType: "correctiva",
      status: "scheduled",
    })
  })

  it("cierra el hallazgo y envía la CAPA a verificación al completar la OT", async () => {
    const { transitionMaintenanceRecord } = await import("@/lib/services/maintenance")
    const derived = await deriveFinding()

    await transitionMaintenanceRecord(maintenanceSession, {
      id: derived.maintenanceId!,
      expectedStatus: "scheduled",
      transition: "complete",
      reason: "Frenos reparados y probados en ruta",
    })

    const [finding] = await testDb.select().from(schema.preventionInspectionFindings)
      .where(eq(schema.preventionInspectionFindings.id, FINDING_ID))
    expect(finding).toMatchObject({ status: "closed", closedByUserId: USER_ID })
    expect(finding!.closedAt).toBeTruthy()

    const [capa] = await testDb.select().from(schema.preventionCapaActions)
      .where(eq(schema.preventionCapaActions.id, derived.capaId))
    expect(capa).toMatchObject({ status: "pending_verification", completedByUserId: USER_ID })
    expect(capa!.completedAt).toBeTruthy()
    const transitions = await testDb.select().from(schema.preventionCapaTransitions)
      .where(eq(schema.preventionCapaTransitions.actionId, derived.capaId))
    expect(transitions.map((transition) => [transition.fromStatus, transition.toStatus])).toEqual(expect.arrayContaining([
      ["pending", "in_progress"],
      ["in_progress", "pending_verification"],
    ]))
  })

  it("reabre el hallazgo y la CAPA cuando la OT vuelve a trabajo", async () => {
    const { transitionMaintenanceRecord } = await import("@/lib/services/maintenance")
    const derived = await deriveFinding()
    await transitionMaintenanceRecord(maintenanceSession, {
      id: derived.maintenanceId!,
      expectedStatus: "scheduled",
      transition: "complete",
      reason: "Frenos reparados y probados en ruta",
    })

    await transitionMaintenanceRecord(maintenanceSession, {
      id: derived.maintenanceId!,
      expectedStatus: "completed",
      transition: "reopen",
      reason: "La falla reapareció durante la prueba operacional",
    })

    const [finding] = await testDb.select().from(schema.preventionInspectionFindings)
      .where(eq(schema.preventionInspectionFindings.id, FINDING_ID))
    expect(finding).toMatchObject({ status: "capa_linked", closedByUserId: null, closedAt: null })

    const [capa] = await testDb.select().from(schema.preventionCapaActions)
      .where(eq(schema.preventionCapaActions.id, derived.capaId))
    expect(capa).toMatchObject({ status: "reopened" })
  })

  it("permite retomar la misma OT si fue cancelada antes de ejecutar", async () => {
    const { transitionMaintenanceRecord } = await import("@/lib/services/maintenance")
    const derived = await deriveFinding()
    await transitionMaintenanceRecord(maintenanceSession, {
      id: derived.maintenanceId!,
      expectedStatus: "scheduled",
      transition: "cancel",
      reason: "Se canceló por error de coordinación",
    })

    await transitionMaintenanceRecord(maintenanceSession, {
      id: derived.maintenanceId!,
      expectedStatus: "cancelled",
      transition: "reopen",
      reason: "Se retoma la reparación pendiente",
    })

    const [maintenance] = await testDb.select().from(schema.maintenanceRecords)
      .where(eq(schema.maintenanceRecords.id, derived.maintenanceId!))
    expect(maintenance).toMatchObject({ status: "in_progress", cancelledAt: null, cancellationReason: null })
    const [finding] = await testDb.select().from(schema.preventionInspectionFindings)
      .where(eq(schema.preventionInspectionFindings.id, FINDING_ID))
    expect(finding!.status).toBe("capa_linked")
  })

  it("no permite que Mantención reabra por sí sola una CAPA ya verificada", async () => {
    const { transitionMaintenanceRecord } = await import("@/lib/services/maintenance")
    const derived = await deriveFinding()
    await transitionMaintenanceRecord(maintenanceSession, {
      id: derived.maintenanceId!,
      expectedStatus: "scheduled",
      transition: "complete",
      reason: "Frenos reparados y probados en ruta",
    })
    await testDb.update(schema.preventionCapaActions).set({
      status: "verified",
      verifiedByUserId: USER_ID,
      verifiedAt: new Date().toISOString(),
      effectivenessStatus: "effective",
    }).where(eq(schema.preventionCapaActions.id, derived.capaId))

    await expect(transitionMaintenanceRecord(maintenanceSession, {
      id: derived.maintenanceId!,
      expectedStatus: "completed",
      transition: "reopen",
      reason: "La falla volvió a presentarse en terreno",
    })).rejects.toThrow(/debe reabrirla un usuario autorizado de Prevención/)

    const [maintenance] = await testDb.select().from(schema.maintenanceRecords)
      .where(eq(schema.maintenanceRecords.id, derived.maintenanceId!))
    expect(maintenance!.status).toBe("completed")
    const [capa] = await testDb.select().from(schema.preventionCapaActions)
      .where(eq(schema.preventionCapaActions.id, derived.capaId))
    expect(capa!.status).toBe("verified")
  })
})
