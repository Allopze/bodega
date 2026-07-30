import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { eq } from "drizzle-orm"
import { drizzle } from "drizzle-orm/pglite"
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest"
import { migratePGlite } from "@/lib/testing/pglite-migrate"
import * as schema from "@/db/schema"
import type { CampaignAccess } from "@/lib/services/prevention-campaigns"

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

vi.mock("@/lib/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}))

await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))

afterAll(async () => {
  delete testGlobal.__db
  await pg.close()
})

const USER_ID = "u-cmp-1"
const WS_ID = "ws-cmp-1"
const WORKER_1 = "wrk-cmp-1"
const WORKER_2 = "wrk-cmp-2"
const PROGRAM_ID = "pdtp-cmp-prog"

beforeEach(async () => {
  await inMemoryDb.delete(schema.pdtpExecutions)
  await inMemoryDb.delete(schema.preventionCampaignAttendance)
  await inMemoryDb.delete(schema.preventionCampaigns)
  await inMemoryDb.delete(schema.pdtpActivities)
  await inMemoryDb.delete(schema.pdtpPrograms)
  await inMemoryDb.delete(schema.workers)
  await inMemoryDb.delete(schema.worksites)
  await inMemoryDb.delete(schema.users)

  await inMemoryDb.insert(schema.users).values({
    id: USER_ID,
    name: "Prevencionista Campañas",
    email: "camp@example.test",
    hashedPassword: "x",
  })

  await inMemoryDb.insert(schema.worksites).values({
    id: WS_ID,
    name: "Faena Campañas",
    code: "FCMP",
    isActive: true,
  })

  await inMemoryDb.insert(schema.workers).values({
    id: WORKER_1,
    worksiteId: WS_ID,
    rut: "11.111.111-1",
    firstName: "Juan",
    lastName: "Pérez",
    isActive: true,
  })

  await inMemoryDb.insert(schema.workers).values({
    id: WORKER_2,
    worksiteId: WS_ID,
    rut: "22.222.222-2",
    firstName: "Maria",
    lastName: "Gomez",
    isActive: true,
  })

  await inMemoryDb.insert(schema.pdtpPrograms).values({
    id: PROGRAM_ID,
    year: 2026,
    version: 1,
    title: "PDTP 2026 Campañas Test",
    status: "active",
    elaboratedByName: "Prevencionista",
    elaboratedByTitle: "Experto",
    creationMode: "blank",
    complianceTarget: 0.9,
    pesoEjecucion: 0.5,
    pesoVerificacion: 0.3,
    pesoCierre: 0.2,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  })

  await inMemoryDb.insert(schema.pdtpActivities).values({
    id: "act-85",
    programId: PROGRAM_ID,
    n: 85,
    activity: "Campaña Uso de EPP",
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

describe("Prevention Campaigns Service (R9)", () => {
  const access: CampaignAccess = {
    userId: USER_ID,
    scope: { mode: "all", ids: [] },
    permissions: ["prevention:campaign:view", "prevention:campaign:manage"],
  }

  it("crea una campaña preventiva activa", async () => {
    const { createCampaign, listCampaigns } = await import("@/lib/services/prevention-campaigns")

    const created = await createCampaign({
      worksiteId: WS_ID,
      title: "Campaña Uso Correcto de EPP",
      description: "Difusión masiva en terreno",
      pdtpActivityNumbers: [85],
    }, access)

    expect(created!.id).toBeDefined()
    expect(created!.status).toBe("active")

    const list = await listCampaigns(access, WS_ID)
    expect(list).toHaveLength(1)
    expect(list[0]!.campaign.title).toBe("Campaña Uso Correcto de EPP")
  })

  it("registra asistencia y al cerrar la campaña auto-acredita en PDTP (R9)", async () => {
    const { createCampaign, recordCampaignAttendance, closeCampaign } = await import("@/lib/services/prevention-campaigns")

    const campaign = await createCampaign({
      worksiteId: WS_ID,
      title: "Campaña Uso Correcto de EPP",
      pdtpActivityNumbers: [85],
    }, access)

    await recordCampaignAttendance({
      campaignId: campaign!.id,
      workerIds: [WORKER_1, WORKER_2],
    }, access)

    const result = await closeCampaign({
      campaignId: campaign!.id,
    }, access)

    expect(result.campaign!.status).toBe("completed")
    expect(result.reachedWorkers).toBe(2)

    // Verificar auto-acreditación PDTP
    const executions = await inMemoryDb.select().from(schema.pdtpExecutions)
      .where(eq(schema.pdtpExecutions.sourceId, campaign!.id))

    expect(executions).toHaveLength(1)
    expect(executions[0]!.origin).toBe("integration")
    expect(executions[0]!.sourceType).toBe("campana")
    expect(executions[0]!.executedQuantity).toBe(2) // 2 trabajadores alcanzados
  })
})
