import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { eq } from "drizzle-orm"
import { drizzle } from "drizzle-orm/pglite"
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

describe("derivación de hallazgos de inspección a CAPA", () => {
  it("crea la CAPA sin crear ni devolver una OT del módulo retirado", async () => {
    const result = await deriveFinding()

    expect(result).not.toHaveProperty("maintenanceId")
    expect(result.capaId).toBeTruthy()
    expect(result.finding).toMatchObject({ id: FINDING_ID, status: "capa_linked" })
    const [capa] = await testDb.select().from(schema.preventionCapaActions)
      .where(eq(schema.preventionCapaActions.id, result.capaId))
    expect(capa).toBeTruthy()
  })
})
