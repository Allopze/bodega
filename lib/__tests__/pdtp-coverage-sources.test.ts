import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { afterAll, beforeEach, describe, expect, it } from "vitest"
import { migratePGlite } from "@/lib/testing/pglite-migrate"
import * as schema from "@/db/schema"

const pg = new PGlite()
const inMemoryDb = drizzle(pg, { schema })
const testGlobal = globalThis as typeof globalThis & { __db?: typeof inMemoryDb }
// @ts-expect-error PGlite is compatible at runtime
testGlobal.__db = inMemoryDb

await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))

afterAll(async () => {
  delete testGlobal.__db
  await pg.close()
})

beforeEach(async () => {
  await inMemoryDb.delete(schema.preventionRiskLegalHistory)
  await inMemoryDb.delete(schema.preventionPdtpSourceLinks)
  await inMemoryDb.delete(schema.preventionCommittees)
  await inMemoryDb.delete(schema.preventionEmergencyPlans)
  await inMemoryDb.delete(schema.pdtpActivities)
  await inMemoryDb.delete(schema.pdtpPrograms)
  await inMemoryDb.delete(schema.worksites)
  await inMemoryDb.delete(schema.users)

  await inMemoryDb.insert(schema.users).values({ id: "user-1", name: "U1", email: "u1@test", hashedPassword: "x", isActive: true })
  await inMemoryDb.insert(schema.worksites).values([
    { id: "ws-1", name: "Faena 1", code: "F1", isActive: true },
    { id: "ws-2", name: "Faena 2", code: "F2", isActive: true },
  ])
})

async function createDraftProgramWithActivity(year: number) {
  const { createLegacyPdtpProgramForTests, addPdtpActivity } = await import("@/lib/services/prevention-pdtp")
  const program = await createLegacyPdtpProgramForTests({ year, title: `Programa ${year}`, userId: "user-1" })
  const activity = await addPdtpActivity({
    programId: program.id,
    activity: "Actividad de prueba",
    program: "Guía de ejecución",
    responsibleSlugs: ["prevencionista"],
    responsibleDisplay: "Prevencionista",
    sheetCodes: [],
    scheduleMode: "on_demand",
  }, "user-1")
  return { program, activity }
}

const ACCESS = { userId: "user-1", scope: { mode: "some" as const, ids: ["ws-1"] }, permissions: ["prevention:pdtp:program:manage"] }

describe("linkPdtpActivitySource: dominios de fuente ampliados (capacitacion/inspeccion/cphs/epp/emergencia)", () => {
  it("vincula un comité CPHS activo dentro de la faena y expone su versión en el snapshot", async () => {
    const { linkPdtpActivitySource, getPdtpCoverage } = await import("@/lib/services/prevention-risk-legal")
    const { activity } = await createDraftProgramWithActivity(2050)
    const now = new Date().toISOString()
    await inMemoryDb.insert(schema.preventionCommittees).values({
      id: "committee-1", worksiteId: "ws-1", name: "CPHS Faena 1",
      constitutedOn: "2024-01-01", mandateEndsOn: "2026-01-01", status: "active",
      createdByUserId: "user-1", createdAt: now, updatedAt: now,
    })

    const link = await linkPdtpActivitySource({
      activityId: activity.id, worksiteId: "ws-1", sourceType: "cphs", sourceId: "committee-1",
      justification: "El CPHS revisa esta actividad en su reunión mensual.",
    }, ACCESS)
    expect(link.sourceVersionSnapshot).toBe("CPHS Faena 1 v1")

    const coverage = await getPdtpCoverage(activity.programId, { ...ACCESS, permissions: ["prevention:pdtp:view"] })
    expect(coverage.sourceOptions.committees).toEqual(
      expect.arrayContaining([{ id: "committee-1", worksiteId: "ws-1", label: "CPHS Faena 1" }]),
    )
  })

  it("rechaza vincular un comité CPHS disuelto", async () => {
    const { linkPdtpActivitySource } = await import("@/lib/services/prevention-risk-legal")
    const { activity } = await createDraftProgramWithActivity(2051)
    const now = new Date().toISOString()
    await inMemoryDb.insert(schema.preventionCommittees).values({
      id: "committee-2", worksiteId: "ws-1", name: "CPHS disuelto",
      constitutedOn: "2020-01-01", mandateEndsOn: "2022-01-01", status: "dissolved",
      createdByUserId: "user-1", createdAt: now, updatedAt: now,
    })

    await expect(linkPdtpActivitySource({
      activityId: activity.id, worksiteId: "ws-1", sourceType: "cphs", sourceId: "committee-2",
      justification: "Intento sobre un comité ya disuelto.",
    }, ACCESS)).rejects.toThrow(/no encontrado, no activo o fuera de alcance/)
  })

  it("vincula un plan de emergencia aprobado y rechaza uno fuera de la faena autorizada", async () => {
    const { linkPdtpActivitySource } = await import("@/lib/services/prevention-risk-legal")
    const { activity } = await createDraftProgramWithActivity(2052)
    const now = new Date().toISOString()
    await inMemoryDb.insert(schema.preventionEmergencyPlans).values([
      {
        id: "plan-1", worksiteId: "ws-1", code: "PLN-001", title: "Plan de emergencia faena 1",
        status: "approved", approvedByUserId: "user-1", approvedAt: now, createdByUserId: "user-1", createdAt: now, updatedAt: now,
      },
      {
        id: "plan-2", worksiteId: "ws-2", code: "PLN-002", title: "Plan de emergencia faena 2",
        status: "approved", approvedByUserId: "user-1", approvedAt: now, createdByUserId: "user-1", createdAt: now, updatedAt: now,
      },
    ])

    const link = await linkPdtpActivitySource({
      activityId: activity.id, worksiteId: "ws-1", sourceType: "emergencia", sourceId: "plan-1",
      justification: "El simulacro anual cubre esta actividad preventiva.",
    }, ACCESS)
    expect(link.sourceVersionSnapshot).toBe("PLN-001 v1")

    await expect(linkPdtpActivitySource({
      activityId: activity.id, worksiteId: "ws-1", sourceType: "emergencia", sourceId: "plan-2",
      justification: "Intento sobre un plan de otra faena.",
    }, ACCESS)).rejects.toThrow(/no encontrado, no aprobado o fuera de alcance/)
  })
})
