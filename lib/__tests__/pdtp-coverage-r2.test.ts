import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest"
import { migratePGlite } from "@/lib/testing/pglite-migrate"
import * as schema from "@/db/schema"

const pg = new PGlite()
const inMemoryDb = drizzle(pg, { schema })
const testGlobal = globalThis as typeof globalThis & { __db?: typeof inMemoryDb }
// @ts-expect-error PGlite compatibility
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

const USER_ID = "u-r2-1"
const WS_ID = "ws-r2-1"
const PROGRAM_ID = "pdtp-r2-prog"
const ACT_ID = "pdtp-r2-act-1"

beforeEach(async () => {
  await inMemoryDb.delete(schema.pdtpActivityWorksiteParams)
  await inMemoryDb.delete(schema.pdtpActivities)
  await inMemoryDb.delete(schema.pdtpPrograms)
  await inMemoryDb.delete(schema.worksites)
  await inMemoryDb.delete(schema.users)

  await inMemoryDb.insert(schema.users).values({
    id: USER_ID,
    name: "User R2",
    email: "r2@example.test",
    hashedPassword: "x",
  })

  await inMemoryDb.insert(schema.worksites).values({
    id: WS_ID,
    name: "Faena R2",
    code: "FR2",
    isActive: true,
  })

  await inMemoryDb.insert(schema.pdtpPrograms).values({
    id: PROGRAM_ID,
    year: 2026,
    version: 1,
    title: "PDTP 2026 R2 Test",
    status: "active",
    elaboratedByName: "User R2",
    elaboratedByTitle: "Prevencionista",
    creationMode: "blank",
    complianceTarget: 0.9,
    pesoEjecucion: 0.5,
    pesoVerificacion: 0.3,
    pesoCierre: 0.2,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  })

  await inMemoryDb.insert(schema.pdtpActivities).values({
    id: ACT_ID,
    programId: PROGRAM_ID,
    n: 54,
    activity: "Capacitación Masiva Conductores",
    objective: "Cobertura de personas",
    objectiveOrder: 1,
    program: "Prevención",
    responsibleSlugs: ["prevencionista"],
    responsibleDisplay: "Prevencionista",
    scheduleMode: "scheduled",
    scheduleClassificationStatus: "confirmed",
    indicatorMode: "coverage",
    sourceSheetRow: 1,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  })
})

describe("Pdtp Activity Worksite Params & Coverage (R1/R2)", () => {
  it("permite guardar y consultar parámetros por faena (esperado sujetos R1 y meta R2)", async () => {
    const { setPdtpActivityWorksiteParams, listPdtpActivityWorksiteParams } = await import("@/lib/services/pdtp/worksites")

    await setPdtpActivityWorksiteParams(ACT_ID, WS_ID, {
      expectedSubjectCount: 15,
      targetCoveragePercent: 90.0,
    }, USER_ID)

    const params = await listPdtpActivityWorksiteParams([ACT_ID], WS_ID)
    expect(params).toHaveLength(1)
    expect(params[0]!.expectedSubjectCount).toBe(15)
    expect(Number(params[0]!.targetCoveragePercent)).toBe(90)
  })

  it("actualiza parámetros existentes de forma idempotente", async () => {
    const { setPdtpActivityWorksiteParams, listPdtpActivityWorksiteParams } = await import("@/lib/services/pdtp/worksites")

    await setPdtpActivityWorksiteParams(ACT_ID, WS_ID, {
      expectedSubjectCount: 10,
    }, USER_ID)

    await setPdtpActivityWorksiteParams(ACT_ID, WS_ID, {
      expectedSubjectCount: 20,
      targetCoveragePercent: 95.5,
    }, USER_ID)

    const params = await listPdtpActivityWorksiteParams([ACT_ID], WS_ID)
    expect(params).toHaveLength(1)
    expect(params[0]!.expectedSubjectCount).toBe(20)
    expect(Number(params[0]!.targetCoveragePercent)).toBe(95.5)
  })
})
