import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest"
import { migratePGlite } from "@/lib/testing/pglite-migrate"
import { truncateImmutableTable } from "@/lib/testing/immutable-tables"
import * as schema from "@/db/schema"

const pg = new PGlite()
const inMemoryDb = drizzle(pg, { schema })
const testGlobal = globalThis as typeof globalThis & { __db?: typeof inMemoryDb }
// @ts-expect-error PGlite is structurally compatible with the app DB at runtime.
testGlobal.__db = inMemoryDb

vi.mock("@/db", () => ({
  get db() {
    return testGlobal.__db
  },
}))

await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))

afterAll(async () => {
  delete testGlobal.__db
  await pg.close()
})

const WORKSITE_ID = "ws-capability-roster"
const OTHER_WORKSITE_ID = "ws-capability-other"
const USER_ID = "user-capability-roster"
const DRIVER_POSITION_ID = "position-driver"
const OTHER_POSITION_ID = "position-other"
const DRIVES_ID = "worker-capability-drives-vehicle"
const OPERATES_ID = "worker-capability-operates-equipment"
const now = new Date().toISOString()

beforeEach(async () => {
  await inMemoryDb.delete(schema.pdtpExecutions)
  await inMemoryDb.delete(schema.pdtpActivitySchedule)
  await inMemoryDb.delete(schema.pdtpActivities)
  await inMemoryDb.delete(schema.pdtpPrograms)
  await inMemoryDb.delete(schema.workerCapabilityOverrides)
  await truncateImmutableTable(inMemoryDb, "worker_position_history")
  await inMemoryDb.delete(schema.workers)
  await inMemoryDb.delete(schema.workerPositionCapabilities)
  await inMemoryDb.delete(schema.workerPositionAliases)
  await inMemoryDb.delete(schema.workerPositions)
  await inMemoryDb.delete(schema.workerCapabilities)
  await inMemoryDb.delete(schema.worksites)
  await inMemoryDb.delete(schema.users)

  await inMemoryDb.insert(schema.users).values({
    id: USER_ID,
    name: "Prevencionista prueba",
    email: "capability-roster@example.test",
    hashedPassword: "x",
  })
  await inMemoryDb.insert(schema.worksites).values([
    { id: WORKSITE_ID, name: "Faena padrón", code: "FPAD", isActive: true },
    { id: OTHER_WORKSITE_ID, name: "Faena ajena", code: "FAJE", isActive: true },
  ])
  await inMemoryDb.insert(schema.workerCapabilities).values([
    { id: DRIVES_ID, code: "drives_vehicle", name: "Conduce vehículos", isActive: true },
    { id: OPERATES_ID, code: "operates_equipment", name: "Opera equipos", isActive: true },
  ])
  await inMemoryDb.insert(schema.workerPositions).values([
    {
      id: DRIVER_POSITION_ID,
      code: "CONDUCTOR",
      name: "Conductor",
      normalizedKey: "conductor",
      isActive: true,
      needsReview: false,
      isSystem: false,
    },
    {
      id: OTHER_POSITION_ID,
      code: "ADMIN",
      name: "Administrativo",
      normalizedKey: "administrativo",
      isActive: true,
      needsReview: false,
      isSystem: false,
    },
  ])
})

async function seedWorker(input: {
  id: string
  positionId?: string | null
  worksiteId?: string
  isActive?: boolean
}) {
  await inMemoryDb.insert(schema.workers).values({
    id: input.id,
    rut: `${input.id}-rut`,
    firstName: "Nombre",
    lastName: input.id,
    position: null,
    positionId: input.positionId ?? null,
    worksiteId: input.worksiteId ?? WORKSITE_ID,
    isActive: input.isActive ?? true,
    createdAt: now,
  })
}

describe("Padrón PDTP por capacidades de trabajadores", () => {
  it("cuenta una sola vez a cada trabajador aunque coincida por varias capacidades", async () => {
    await inMemoryDb.insert(schema.workerPositionCapabilities).values([
      { positionId: DRIVER_POSITION_ID, capabilityId: DRIVES_ID },
      { positionId: DRIVER_POSITION_ID, capabilityId: OPERATES_ID },
    ])
    await seedWorker({ id: "worker-both", positionId: DRIVER_POSITION_ID })
    await seedWorker({ id: "worker-other-site", positionId: DRIVER_POSITION_ID, worksiteId: OTHER_WORKSITE_ID })

    const { resolvePdtpSubjectRoster } = await import("@/lib/services/pdtp/subject-registry")
    const roster = await resolvePdtpSubjectRoster(
      "trabajadores_capacidad",
      WORKSITE_ID,
      { year: 2026, month: 1 },
      { capabilityCodes: ["drives_vehicle", "operates_equipment"] },
    )
    if (!roster) throw new Error("El padrón por capacidad no se resolvió")

    expect(roster).toMatchObject({
      source: "trabajadores_capacidad",
      status: "resolved",
      count: 1,
      capabilityCodes: ["drives_vehicle", "operates_equipment"],
    })
    expect(roster.members).toEqual([
      expect.objectContaining({
        workerId: "worker-both",
        positionId: DRIVER_POSITION_ID,
        matchedCapabilities: [
          expect.objectContaining({ code: "drives_vehicle", source: "position" }),
          expect.objectContaining({ code: "operates_equipment", source: "position" }),
        ],
      }),
    ])
  })

  it("excluye trabajadores inactivos y respeta overrides include/exclude", async () => {
    await inMemoryDb.insert(schema.workerPositionCapabilities).values({
      positionId: DRIVER_POSITION_ID,
      capabilityId: DRIVES_ID,
    })
    await seedWorker({ id: "worker-excluded", positionId: DRIVER_POSITION_ID })
    await seedWorker({ id: "worker-included", positionId: OTHER_POSITION_ID })
    await seedWorker({ id: "worker-inactive", positionId: OTHER_POSITION_ID, isActive: false })
    await inMemoryDb.insert(schema.workerCapabilityOverrides).values([
      {
        id: "override-exclude",
        workerId: "worker-excluded",
        capabilityId: DRIVES_ID,
        mode: "exclude",
        reason: "No conduce vehículos en esta asignación",
      },
      {
        id: "override-include",
        workerId: "worker-included",
        capabilityId: DRIVES_ID,
        mode: "include",
        reason: "Conduce ocasionalmente para la faena",
      },
      {
        id: "override-inactive",
        workerId: "worker-inactive",
        capabilityId: DRIVES_ID,
        mode: "include",
        reason: "Registro histórico de conducción",
      },
    ])

    const { resolvePdtpSubjectRoster } = await import("@/lib/services/pdtp/subject-registry")
    const roster = await resolvePdtpSubjectRoster(
      "trabajadores_capacidad",
      WORKSITE_ID,
      { year: 2026, month: 1 },
      { capabilityCodes: ["drives_vehicle"] },
    )
    if (!roster) throw new Error("El padrón por capacidad no se resolvió")

    expect(roster.count).toBe(1)
    expect(roster.members).toEqual([
      expect.objectContaining({
        workerId: "worker-included",
        matchedCapabilities: [expect.objectContaining({ code: "drives_vehicle", source: "override" })],
      }),
    ])
  })

  it("explica como pendiente un padrón configurado que no tiene coincidencias", async () => {
    await seedWorker({ id: "worker-unclassified", positionId: OTHER_POSITION_ID })

    const { resolvePdtpSubjectRoster } = await import("@/lib/services/pdtp/subject-registry")
    const roster = await resolvePdtpSubjectRoster(
      "trabajadores_capacidad",
      WORKSITE_ID,
      { year: 2026, month: 1 },
      { capabilityCodes: ["drives_vehicle"] },
    )
    if (!roster) throw new Error("El padrón por capacidad no se resolvió")

    expect(roster).toMatchObject({
      status: "pending_classification",
      count: 0,
      capabilityCodes: ["drives_vehicle"],
      members: [],
    })
    expect(roster.explanation).toContain("no tiene trabajadores activos clasificados")
  })

  it("no sustituye un padrón por capacidad vacío por la cantidad planificada", async () => {
    await seedWorker({ id: "worker-without-capability", positionId: OTHER_POSITION_ID })
    await inMemoryDb.insert(schema.pdtpPrograms).values({
      id: "program-capability-roster",
      year: 2026,
      version: 1,
      status: "draft",
      title: "Programa padrón por capacidades",
      elaboratedByName: "Prevencionista prueba",
      elaboratedByTitle: "Prevencionista",
      creationMode: "blank",
      complianceTarget: 0.9,
      pesoEjecucion: 0.5,
      pesoVerificacion: 0.3,
      pesoCierre: 0.2,
      createdAt: now,
      updatedAt: now,
    })
    await inMemoryDb.insert(schema.pdtpActivities).values({
      id: "activity-capability-roster",
      programId: "program-capability-roster",
      n: 56,
      activity: "Manejo a la defensiva",
      program: "Prevención",
      responsibleSlugs: ["prevencionista"],
      responsibleDisplay: "Prevencionista",
      scheduleMode: "scheduled",
      scheduleClassificationStatus: "confirmed",
      indicatorMode: "coverage",
      subjectSource: "trabajadores_capacidad",
      subjectCapabilityCodes: ["drives_vehicle", "operates_equipment"],
      sourceSheetRow: 56,
      createdAt: now,
      updatedAt: now,
    })
    await inMemoryDb.insert(schema.pdtpActivitySchedule).values({
      id: "schedule-capability-roster",
      activityId: "activity-capability-roster",
      year: 2026,
      month: 1,
      week: 1,
      plannedQuantity: 7,
      sourceColumn: "test",
    })

    const { getPdtpComplianceIndicators } = await import("@/lib/services/pdtp/compliance")
    const compliance = await getPdtpComplianceIndicators("program-capability-roster", WORKSITE_ID)

    // toMatchObject: la tarea 1.4 agregó `zeroActivityMonths`/`zeroActivityIds`
    // a `annual`, ajeno a lo que este caso prueba (padrón por capacidad vacío).
    expect(compliance?.annual).toMatchObject({ planned: 0, executed: 0, percent: null })
    expect(compliance?.subjectRosterIssues).toEqual([
      expect.objectContaining({
        activityId: "activity-capability-roster",
        worksiteId: WORKSITE_ID,
        status: "pending_classification",
        capabilityCodes: ["drives_vehicle", "operates_equipment"],
      }),
    ])
  })
})
