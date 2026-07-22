import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { eq } from "drizzle-orm"
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest"
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
  await inMemoryDb.delete(schema.pdtpActivityWorksiteExclusions)
  await inMemoryDb.delete(schema.pdtpProgramWorksites)
  await inMemoryDb.delete(schema.pdtpActivities)
  await inMemoryDb.delete(schema.pdtpPrograms)
  await inMemoryDb.delete(schema.worksites)
  await inMemoryDb.delete(schema.users)

  await inMemoryDb.insert(schema.users).values({ id: "user-1", name: "U1", email: "u1@test", hashedPassword: "x", isActive: true })
  await inMemoryDb.insert(schema.worksites).values([
    { id: "ws-1", name: "Faena 1", code: "F1", isActive: true },
    { id: "ws-2", name: "Faena 2", code: "F2", isActive: true },
    { id: "ws-3", name: "Faena 3", code: "F3", isActive: true },
  ])
})

afterEach(() => {})

async function createDraftProgramWithActivity(year: number) {
  const { createPdtpProgram, addPdtpActivity } = await import("@/lib/services/prevention-pdtp")
  const program = await createPdtpProgram({ year, title: `Programa ${year}`, userId: "user-1" })
  const activity = await addPdtpActivity({
    programId: program.id,
    objectiveOrder: 1,
    objective: "Objetivo 1",
    activity: "Actividad de prueba",
    program: "Guía de ejecución",
    responsibleSlugs: ["prevencionista"],
    responsibleDisplay: "Prevencionista",
    sheetCodes: [],
    scheduleMode: "on_demand",
  }, "user-1")
  return { program, activity }
}

describe("PDTP multifaena: membresía y exclusiones", () => {
  it("resolveProgramWorksiteIds: sin membresía declarada, aplica a todo el scope del usuario", async () => {
    const { resolveProgramWorksiteIds } = await import("@/lib/services/pdtp/worksites")
    expect(resolveProgramWorksiteIds([], ["ws-1", "ws-2"], ["ws-1", "ws-2", "ws-3"])).toEqual(["ws-1", "ws-2"])
    expect(resolveProgramWorksiteIds([], "all", ["ws-1", "ws-2", "ws-3"])).toEqual(["ws-1", "ws-2", "ws-3"])
  })

  it("resolveProgramWorksiteIds: con membresía, solo la intersección con el scope (nunca amplía)", async () => {
    const { resolveProgramWorksiteIds } = await import("@/lib/services/pdtp/worksites")
    expect(resolveProgramWorksiteIds(["ws-1", "ws-2"], ["ws-1"], ["ws-1", "ws-2", "ws-3"])).toEqual(["ws-1"])
    expect(resolveProgramWorksiteIds(["ws-2"], ["ws-1"], ["ws-1", "ws-2", "ws-3"])).toEqual([])
  })

  it("setPdtpProgramWorksites declara membresía y assertPdtpWorksiteCanOperateProgram falla cerrado fuera de ella", async () => {
    const { setPdtpProgramWorksites, assertPdtpWorksiteCanOperateProgram } = await import("@/lib/services/pdtp/worksites")
    const { program } = await createDraftProgramWithActivity(2040)

    // Sin membresía: cualquier faena puede operar.
    await expect(assertPdtpWorksiteCanOperateProgram(program.id, "ws-3")).resolves.toBeUndefined()

    await setPdtpProgramWorksites(program.id, ["ws-1", "ws-2"], "user-1")
    await expect(assertPdtpWorksiteCanOperateProgram(program.id, "ws-1")).resolves.toBeUndefined()
    await expect(assertPdtpWorksiteCanOperateProgram(program.id, "ws-3")).rejects.toThrow(/no está habilitada/)

    // Vaciar la membresía vuelve al comportamiento histórico (todas).
    await setPdtpProgramWorksites(program.id, [], "user-1")
    await expect(assertPdtpWorksiteCanOperateProgram(program.id, "ws-3")).resolves.toBeUndefined()
  })

  it("una exclusión puntual saca la actividad solo de la faena excluida, no de las demás", async () => {
    const { excludeActivityForWorksite, includeActivityForWorksite, resolvePdtpEffectiveActivitiesForWorksite } = await import("@/lib/services/pdtp/worksites")
    const { program, activity } = await createDraftProgramWithActivity(2041)

    let ws1Activities = await resolvePdtpEffectiveActivitiesForWorksite(program.id, "ws-1")
    let ws2Activities = await resolvePdtpEffectiveActivitiesForWorksite(program.id, "ws-2")
    expect(ws1Activities.map((a) => a.id)).toContain(activity.id)
    expect(ws2Activities.map((a) => a.id)).toContain(activity.id)

    await excludeActivityForWorksite(activity.id, "ws-1", "La faena 1 no ejecuta esta actividad", "user-1")

    ws1Activities = await resolvePdtpEffectiveActivitiesForWorksite(program.id, "ws-1")
    ws2Activities = await resolvePdtpEffectiveActivitiesForWorksite(program.id, "ws-2")
    expect(ws1Activities.map((a) => a.id)).not.toContain(activity.id)
    expect(ws2Activities.map((a) => a.id)).toContain(activity.id)

    await includeActivityForWorksite(activity.id, "ws-1", "Se revirtió la exclusión tras revisión", "user-1")
    ws1Activities = await resolvePdtpEffectiveActivitiesForWorksite(program.id, "ws-1")
    expect(ws1Activities.map((a) => a.id)).toContain(activity.id)
  })

  it("agregar membresía o una exclusión cambia el digest firmable (schemaVersion 6)", async () => {
    const { setPdtpProgramWorksites, excludeActivityForWorksite } = await import("@/lib/services/pdtp/worksites")
    const { computePdtpProgramContentDigest } = await import("@/lib/services/pdtp/content-digest")
    const { program, activity } = await createDraftProgramWithActivity(2042)

    const baseline = await computePdtpProgramContentDigest(program.id)
    expect(baseline.snapshot).toMatchObject({ schemaVersion: 6 })

    await setPdtpProgramWorksites(program.id, ["ws-1"], "user-1")
    const afterMembership = await computePdtpProgramContentDigest(program.id)
    expect(afterMembership.digest).not.toBe(baseline.digest)

    await excludeActivityForWorksite(activity.id, "ws-1", "Motivo de exclusión suficientemente largo", "user-1")
    const afterExclusion = await computePdtpProgramContentDigest(program.id)
    expect(afterExclusion.digest).not.toBe(afterMembership.digest)
  })

  it("rechaza declarar membresía o exclusiones fuera de draft (guarda central)", async () => {
    const { setPdtpProgramWorksites, excludeActivityForWorksite } = await import("@/lib/services/pdtp/worksites")
    const { program, activity } = await createDraftProgramWithActivity(2043)

    await inMemoryDb.update(schema.pdtpPrograms).set({ status: "in_review" }).where(eq(schema.pdtpPrograms.id, program.id))

    await expect(setPdtpProgramWorksites(program.id, ["ws-1"], "user-1")).rejects.toThrow(/revisión/)
    await expect(excludeActivityForWorksite(activity.id, "ws-1", "Motivo de exclusión suficientemente largo", "user-1")).rejects.toThrow(/revisión/)
  })
})
