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
  // La OT vive en el módulo de mantención: el equipo necesita su ficha ahí.
  await testDb.insert(schema.mantBrands).values({ id: "inspection-maintenance-brand", name: "Marca prueba", nameKey: "marca prueba" }).onConflictDoNothing()
  await testDb.insert(schema.mantEquipmentProfiles).values({ vehicleId: VEHICLE_ID, brandId: "inspection-maintenance-brand" })
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

const NON_VEHICLE_RUN_ID = "inspection-maintenance-run-general"
const NON_VEHICLE_FINDING_ID = "inspection-maintenance-finding-general"

/** Inspección de una zona (sin equipo como sujeto) con un hallazgo abierto. */
async function seedNonVehicleFinding() {
  await testDb.insert(schema.preventionInspectionRuns).values({
    id: NON_VEHICLE_RUN_ID,
    code: "INS-IMT-002",
    templateId: "inspection-maintenance-template",
    worksiteId: WORKSITE_ID,
    subjectLabel: "Bodega central",
    status: "completed",
    executedByUserId: USER_ID,
    executedAt: "2026-08-31T12:00:00.000Z",
    createdByUserId: USER_ID,
  })
  await testDb.insert(schema.preventionInspectionFindings).values({
    id: NON_VEHICLE_FINDING_ID,
    runId: NON_VEHICLE_RUN_ID,
    description: "Pasillo de la bodega obstruido con material",
    danoPotencial: "moderado",
    criticality: "medium",
    status: "open",
  })
}

async function ordersOf(findingId: string) {
  return testDb.select().from(schema.mantWorkOrders)
    .where(eq(schema.mantWorkOrders.inspectionFindingId, findingId))
}

describe("derivación de hallazgos de inspección a CAPA", () => {
  // No se simula `createWorkOrderWithClient` a propósito: lo que se prueba es
  // la integración (transacción compartida, folio, índice único).
  it("un hallazgo de equipo crea exactamente una OT de reparación ligada al hallazgo", async () => {
    const result = await deriveFinding()

    expect(result.capaId).toBeTruthy()
    expect(result.finding).toMatchObject({ id: FINDING_ID, status: "capa_linked" })
    expect(result.workOrder).toMatchObject({ created: true })
    expect(result.workOrder?.folio).toBeTruthy()

    const orders = await ordersOf(FINDING_ID)
    expect(orders).toHaveLength(1)
    expect(orders[0]).toMatchObject({
      id: result.workOrder!.id,
      vehicleId: VEHICLE_ID,
      worksiteId: WORKSITE_ID,
      repair: true,
      maintenance: false,
      status: "solicitada",
      inspectionFindingId: FINDING_ID,
      repairDescription: "El camión presenta falla en el sistema de frenos",
    })
    expect(orders[0]!.observations).toContain("INS-IMT-001")
  })

  it("derivar de nuevo no crea otra CAPA ni otra OT", async () => {
    await deriveFinding()
    await expect(deriveFinding()).rejects.toThrow(/ya tiene una acción CAPA/)

    expect(await ordersOf(FINDING_ID)).toHaveLength(1)
    const capas = await testDb.select().from(schema.preventionCapaActions)
    expect(capas).toHaveLength(1)
  })

  it("si el hallazgo ya tiene una OT viva la reutiliza en vez de chocar con el índice único", async () => {
    // Sin pasar por `createWorkOrderWithClient`: la fila se inserta a mano para
    // que este caso pruebe sólo la reutilización de `createFindingCapa`.
    await testDb.insert(schema.mantWorkOrders).values({
      id: "inspection-maintenance-existing-ot",
      folio: "OT-PRE-0001",
      vehicleId: VEHICLE_ID,
      worksiteId: WORKSITE_ID,
      equipmentSnapshot: {} as never,
      repair: true,
      requestDate: "2026-08-31",
      requestedByUserId: USER_ID,
      requesterName: "Responsable Mantención",
      repairDescription: "OT previa del mismo hallazgo",
      inspectionFindingId: FINDING_ID,
    })

    const result = await deriveFinding()

    expect(result.workOrder).toEqual({ id: "inspection-maintenance-existing-ot", folio: "OT-PRE-0001", created: false })
    expect(await ordersOf(FINDING_ID)).toHaveLength(1)
  })

  it("si la OT anterior del hallazgo está cerrada, volver a derivar abre una OT nueva y la cerrada queda como historia", async () => {
    // Prevención reabrió y luego canceló la CAPA de un trabajo ya cerrado: el hallazgo vuelve a
    // `open` sin CAPA y hace falta trabajo nuevo (decisión del usuario, 2026-11-12). Antes se
    // reutilizaba la OT cerrada y la CAPA nueva nunca se acreditaba.
    const t = "2026-08-31T12:00:00.000Z"
    await testDb.insert(schema.mantWorkOrders).values({
      id: "inspection-maintenance-closed-ot", folio: "OT-PRE-0002", vehicleId: VEHICLE_ID, worksiteId: WORKSITE_ID,
      equipmentSnapshot: {} as never, repair: true, requestDate: "2026-08-31", requestedByUserId: USER_ID,
      requesterName: "Responsable Mantención", repairDescription: "Trabajo anterior del mismo hallazgo", inspectionFindingId: FINDING_ID,
      status: "cerrada", assignedToUserId: USER_ID,
      workshopEntryAt: t, estimatedDeliveryDate: "2026-08-31", startedAt: t, workshopKind: "interno",
      workshopExitAt: t, finishedAt: t,
      receivedAt: t, receivedByUserId: USER_ID, receivedRecordedAt: t, receiverName: "Pedro Retira",
      faenaReceivedAt: t, faenaReceivedByUserId: USER_ID, closedAt: t, faenaReceiverName: "Ana Faena",
    })

    const result = await deriveFinding()

    expect(result.workOrder).toMatchObject({ created: true })
    expect(result.workOrder?.id).not.toBe("inspection-maintenance-closed-ot")
    const orders = await ordersOf(FINDING_ID)
    expect(orders.map((order) => order.status).sort()).toEqual(["cerrada", "solicitada"])
  })

  it("un equipo que no está en el módulo de mantención deriva la CAPA igual, sin OT, y dice por qué", async () => {
    await testDb.delete(schema.mantEquipmentProfiles).where(eq(schema.mantEquipmentProfiles.vehicleId, VEHICLE_ID))

    const result = await deriveFinding()

    expect(result.capaId).toBeTruthy()
    expect(result.finding).toMatchObject({ status: "capa_linked" })
    expect(result.workOrder).toBeNull()
    expect(result.workOrderSkipped).toMatch(/no está en el módulo de mantención/)
    expect(await ordersOf(FINDING_ID)).toHaveLength(0)
  })

  it("un hallazgo de una inspección sin equipo crea la CAPA y ninguna OT", async () => {
    await seedNonVehicleFinding()
    const { createFindingCapa } = await import("@/lib/services/prevention-inspections")

    const result = await createFindingCapa({
      findingId: NON_VEHICLE_FINDING_ID,
      actionDescription: "Despejar el pasillo y demarcar la zona de tránsito.",
      responsibleUserId: USER_ID,
    }, inspectionAccess)

    expect(result.workOrder).toBeNull()
    expect(result.finding).toMatchObject({ status: "capa_linked" })
    expect(await testDb.select().from(schema.mantWorkOrders)).toHaveLength(0)
  })

  it("no deriva si el equipo ya fue trasladado a otra faena, y no deja CAPA a medias", async () => {
    await testDb.insert(schema.worksites).values({ id: "inspection-maintenance-other-worksite", code: "IM2", name: "Otra faena" })
    await testDb.update(schema.fuelVehicles)
      .set({ worksiteId: "inspection-maintenance-other-worksite" })
      .where(eq(schema.fuelVehicles.id, VEHICLE_ID))

    await expect(deriveFinding()).rejects.toThrow(/pertenece a otra faena/)

    expect(await testDb.select().from(schema.preventionCapaActions)).toHaveLength(0)
    expect(await testDb.select().from(schema.mantWorkOrders)).toHaveLength(0)
    const [finding] = await testDb.select().from(schema.preventionInspectionFindings)
      .where(eq(schema.preventionInspectionFindings.id, FINDING_ID))
    expect(finding).toMatchObject({ status: "open", capaActionId: null })
  })
})
