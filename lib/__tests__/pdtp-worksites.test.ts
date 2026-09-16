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
  await inMemoryDb.delete(schema.pdtpActivityScheduleOverrides)
  await inMemoryDb.delete(schema.pdtpActivityWorksiteParams)
  await inMemoryDb.delete(schema.pdtpActivityWorksiteExclusions)
  await inMemoryDb.delete(schema.pdtpProgramWorksites)
  await inMemoryDb.delete(schema.pdtpExecutions)
  await inMemoryDb.delete(schema.pdtpActivitySchedule)
  await inMemoryDb.delete(schema.pdtpActivities)
  await inMemoryDb.delete(schema.pdtpPrograms)
  await inMemoryDb.delete(schema.pdtpResponsibleCatalog)
  await inMemoryDb.delete(schema.worksites)
  await inMemoryDb.delete(schema.users)

  await inMemoryDb.insert(schema.users).values({ id: "user-1", name: "U1", email: "u1@test", hashedPassword: "x", isActive: true })
  await inMemoryDb.insert(schema.pdtpResponsibleCatalog).values([
    { slug: "prf", displayName: "Prevencionista global", kind: "role" },
    { slug: "jdpr", displayName: "Jefatura DPR local", kind: "role" },
  ])
  await inMemoryDb.insert(schema.worksites).values([
    { id: "ws-1", name: "Faena 1", code: "F1", isActive: true },
    { id: "ws-2", name: "Faena 2", code: "F2", isActive: true },
    { id: "ws-3", name: "Faena 3", code: "F3", isActive: true },
  ])
})

afterEach(() => {})

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

  it("lista para la UI solo las faenas miembro que también están dentro del alcance", async () => {
    const services = await import("@/lib/services/pdtp/worksites")
    const listAccessiblePdtpProgramWorksites = Reflect.get(services, "listAccessiblePdtpProgramWorksites") as
      | ((programId: string, scope: "all" | string[]) => Promise<Array<{ id: string; name: string; code: string }>>)
      | undefined
    expect(listAccessiblePdtpProgramWorksites).toBeTypeOf("function")

    const { program } = await createDraftProgramWithActivity(2050)
    await services.setPdtpProgramWorksites(program.id, ["ws-1", "ws-2"], "user-1")

    await expect(listAccessiblePdtpProgramWorksites!(program.id, "all"))
      .resolves.toEqual([
        expect.objectContaining({ id: "ws-1", name: "Faena 1" }),
        expect.objectContaining({ id: "ws-2", name: "Faena 2" }),
      ])
    await expect(listAccessiblePdtpProgramWorksites!(program.id, ["ws-2", "ws-3"]))
      .resolves.toEqual([expect.objectContaining({ id: "ws-2", name: "Faena 2" })])
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

  it("solo un usuario con alcance global puede reemplazar la membresía del programa", async () => {
    const { setPdtpProgramWorksites } = await import("@/lib/services/pdtp/worksites")
    const { program } = await createDraftProgramWithActivity(2048)

    await expect(
      setPdtpProgramWorksites(program.id, ["ws-1"], "user-1", ["ws-1"]),
    ).rejects.toThrow(/alcance global/)
    await expect(
      setPdtpProgramWorksites(program.id, ["ws-1"], "user-1", "all"),
    ).resolves.toEqual([expect.objectContaining({ worksiteId: "ws-1" })])
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

  it("agregar membresía o una exclusión cambia el digest firmable (versión de esquema vigente)", async () => {
    const { setPdtpProgramWorksites, excludeActivityForWorksite } = await import("@/lib/services/pdtp/worksites")
    const { computePdtpProgramContentDigest, CURRENT_PDTP_CONTENT_SCHEMA_VERSION } = await import("@/lib/services/pdtp/content-digest")
    const { program, activity } = await createDraftProgramWithActivity(2042)

    const baseline = await computePdtpProgramContentDigest(program.id)
    expect(baseline.snapshot).toMatchObject({ schemaVersion: CURRENT_PDTP_CONTENT_SCHEMA_VERSION })

    await setPdtpProgramWorksites(program.id, ["ws-1"], "user-1")
    const afterMembership = await computePdtpProgramContentDigest(program.id)
    expect(afterMembership.digest).not.toBe(baseline.digest)

    await excludeActivityForWorksite(activity.id, "ws-1", "Motivo de exclusión suficientemente largo", "user-1")
    const afterExclusion = await computePdtpProgramContentDigest(program.id)
    expect(afterExclusion.digest).not.toBe(afterMembership.digest)
  })

  it("cambiar las capacidades del padrón modifica el contenido firmable", async () => {
    const { updatePdtpActivity } = await import("@/lib/services/pdtp/activities")
    const { computePdtpProgramContentDigest, CURRENT_PDTP_CONTENT_SCHEMA_VERSION } = await import("@/lib/services/pdtp/content-digest")
    const { program, activity } = await createDraftProgramWithActivity(2051)

    await updatePdtpActivity({
      activityId: activity.id,
      indicatorMode: "coverage",
      subjectSource: "trabajadores_capacidad",
      subjectCapabilityCodes: ["drives_vehicle"],
    }, "user-1")
    const driversOnly = await computePdtpProgramContentDigest(program.id)
    expect(driversOnly.snapshot).toMatchObject({
      schemaVersion: CURRENT_PDTP_CONTENT_SCHEMA_VERSION,
      activities: [expect.objectContaining({
        subjectSource: "trabajadores_capacidad",
        subjectCapabilityCodes: ["drives_vehicle"],
      })],
    })

    await updatePdtpActivity({
      activityId: activity.id,
      subjectSource: "trabajadores_capacidad",
      subjectCapabilityCodes: ["drives_vehicle", "operates_equipment"],
    }, "user-1")
    const driversAndOperators = await computePdtpProgramContentDigest(program.id)
    expect(driversAndOperators.digest).not.toBe(driversOnly.digest)
  })

  it("rechaza declarar membresía o exclusiones fuera de draft (guarda central)", async () => {
    const { setPdtpProgramWorksites, excludeActivityForWorksite } = await import("@/lib/services/pdtp/worksites")
    const { program, activity } = await createDraftProgramWithActivity(2043)

    await inMemoryDb.update(schema.pdtpPrograms).set({ status: "in_review" }).where(eq(schema.pdtpPrograms.id, program.id))

    await expect(setPdtpProgramWorksites(program.id, ["ws-1"], "user-1")).rejects.toThrow(/revisión/)
    await expect(excludeActivityForWorksite(activity.id, "ws-1", "Motivo de exclusión suficientemente largo", "user-1")).rejects.toThrow(/revisión/)
  })

  /**
   * El padrón (`expectedSubjectCount`) no es contenido firmado del programa.
   *
   * El programa compromete a quién se le exige cada actividad, con qué meta y en
   * qué faenas aplica. Cuántos sujetos existen hoy es un hecho del mundo que
   * cambia cuando entra o sale gente de un GES, mientras el compromiso sigue
   * igual. Estaba en la huella por arrastre —vive en la misma fila que la meta y
   * el responsable por faena—, y eso obligaba a abrir una revisión nueva del
   * programa para corregir un conteo.
   */
  it("cargar el padrón no altera el digest; cambiar la meta sí", async () => {
    const { setPdtpActivityWorksiteAdjustment } = await import("@/lib/services/pdtp/worksites")
    const { computePdtpProgramContentDigest } = await import("@/lib/services/pdtp/content-digest")
    const { program, activity } = await createDraftProgramWithActivity(2046)

    const baseline = await computePdtpProgramContentDigest(program.id)

    // Aparece la fila de parámetros por primera vez: sin el filtro de filas sin
    // contenido firmado, esto solo bastaría para mover la huella.
    await setPdtpActivityWorksiteAdjustment({
      activityId: activity.id,
      worksiteId: "ws-1",
      excluded: false,
      reason: "Padrón de expuestos declarado para la faena.",
      expectedSubjectCount: 6,
    }, "user-1", ["ws-1"])
    expect((await computePdtpProgramContentDigest(program.id)).digest).toBe(baseline.digest)

    // Y corregirlo después tampoco: es el caso real, gente que entra al GES.
    await setPdtpActivityWorksiteAdjustment({
      activityId: activity.id,
      worksiteId: "ws-1",
      excluded: false,
      reason: "Se incorporaron dos personas al grupo de exposición.",
      expectedSubjectCount: 8,
    }, "user-1", ["ws-1"])
    expect((await computePdtpProgramContentDigest(program.id)).digest).toBe(baseline.digest)

    // La meta sí es un compromiso del programa.
    await setPdtpActivityWorksiteAdjustment({
      activityId: activity.id,
      worksiteId: "ws-1",
      excluded: false,
      reason: "Meta de cobertura acordada con la jefatura.",
      targetCoveragePercent: 90,
    }, "user-1", ["ws-1"])
    expect((await computePdtpProgramContentDigest(program.id)).digest).not.toBe(baseline.digest)
  })

  it("el programa firmado admite corregir el padrón, no el resto de la proyección", async () => {
    const { setPdtpActivityWorksiteAdjustment, listPdtpActivityWorksiteParams } = await import("@/lib/services/pdtp/worksites")
    const { program, activity } = await createDraftProgramWithActivity(2047)

    await inMemoryDb.update(schema.pdtpPrograms)
      .set({ status: "in_review", contentDigest: "a".repeat(64) })
      .where(eq(schema.pdtpPrograms.id, program.id))

    const base = {
      activityId: activity.id,
      worksiteId: "ws-1",
      excluded: false,
      reason: "Ajuste sobre un programa ya firmado.",
    }

    // El padrón pasa: no es contenido firmado.
    await setPdtpActivityWorksiteAdjustment({ ...base, expectedSubjectCount: 12 }, "user-1", ["ws-1"])
    const params = await listPdtpActivityWorksiteParams([activity.id], "ws-1")
    expect(params[0]!.expectedSubjectCount).toBe(12)

    // Reenviar el mismo padrón tampoco choca: la comparación es contra el estado
    // actual, no contra qué campos trae la llamada.
    await expect(setPdtpActivityWorksiteAdjustment({ ...base, expectedSubjectCount: 12 }, "user-1", ["ws-1"]))
      .resolves.toBeDefined()

    // Todo lo que sí es compromiso sigue bloqueado.
    await expect(setPdtpActivityWorksiteAdjustment({ ...base, targetCoveragePercent: 90 }, "user-1", ["ws-1"]))
      .rejects.toThrow(/revisión/)
    await expect(setPdtpActivityWorksiteAdjustment({
      ...base, responsibleSlugs: ["prevencionista"], responsibleDisplay: "PRF",
    }, "user-1", ["ws-1"])).rejects.toThrow(/revisión/)
    await expect(setPdtpActivityWorksiteAdjustment({
      ...base, schedule: [{ month: 3, week: 1, plannedQuantity: 2 }],
    }, "user-1", ["ws-1"])).rejects.toThrow(/revisión/)
    await expect(setPdtpActivityWorksiteAdjustment({
      ...base, excluded: true, reason: "La actividad no aplica al alcance local.",
    }, "user-1", ["ws-1"])).rejects.toThrow(/revisión/)
  })

  it("el ajuste unificado falla cerrado fuera del alcance de faena", async () => {
    const { setPdtpActivityWorksiteAdjustment } = await import("@/lib/services/pdtp/worksites")
    const { activity } = await createDraftProgramWithActivity(2044)

    await expect(setPdtpActivityWorksiteAdjustment({
      activityId: activity.id,
      worksiteId: "ws-2",
      excluded: false,
      reason: "Ajuste solicitado por una faena fuera del alcance.",
      expectedSubjectCount: 10,
    }, "user-1", ["ws-1"])).rejects.toThrow(/sin acceso/)
  })

  it("bloquea ejecuciones excluidas para la faena", async () => {
    const { setPdtpActivityWorksiteAdjustment } = await import("@/lib/services/pdtp/worksites")
    const { markPdtpExecution } = await import("@/lib/services/prevention-pdtp")
    const { program, activity } = await createDraftProgramWithActivity(2045)
    await setPdtpActivityWorksiteAdjustment({
      activityId: activity.id,
      worksiteId: "ws-1",
      excluded: true,
      reason: "La actividad no corresponde al alcance operativo local.",
    }, "user-1", ["ws-1"])
    await inMemoryDb.update(schema.pdtpPrograms).set({ status: "active" }).where(eq(schema.pdtpPrograms.id, program.id))

    await expect(markPdtpExecution({
      activityId: activity.id,
      worksiteId: "ws-1",
      year: 2045,
      month: 1,
      week: 1,
      executedQuantity: 1,
    }, "user-1", ["ws-1"])).rejects.toThrow(/excluida/)
  })

  it("aplica el retiro por período y conserva planificación y ejecución previas", async () => {
    const { retirePdtpActivity } = await import("@/lib/services/pdtp/activities")
    const { loadProgramScheduleAndExecutions } = await import("@/lib/services/pdtp/helpers")
    const { markPdtpExecution } = await import("@/lib/services/prevention-pdtp")
    const { program, activity } = await createDraftProgramWithActivity(2046)
    await inMemoryDb.insert(schema.pdtpActivitySchedule).values([
      { id: "retire-before", activityId: activity.id, year: 2046, month: 7, week: 4, plannedQuantity: 1, sourceColumn: "test" },
      { id: "retire-after", activityId: activity.id, year: 2046, month: 8, week: 1, plannedQuantity: 1, sourceColumn: "test" },
    ])
    await retirePdtpActivity({
      activityId: activity.id,
      reason: "La actividad será reemplazada por un control equivalente.",
      effectiveFrom: "2046-08-01",
    }, "user-1")
    await inMemoryDb.update(schema.pdtpPrograms).set({ status: "active" }).where(eq(schema.pdtpPrograms.id, program.id))

    await expect(markPdtpExecution({
      activityId: activity.id,
      worksiteId: "ws-1",
      year: 2046,
      month: 7,
      week: 4,
      executedQuantity: 1,
    }, "user-1", ["ws-1"])).resolves.toEqual(expect.objectContaining({ month: 7, week: 4 }))
    await expect(markPdtpExecution({
      activityId: activity.id,
      worksiteId: "ws-1",
      year: 2046,
      month: 8,
      week: 1,
      executedQuantity: 1,
    }, "user-1", ["ws-1"])).rejects.toThrow(/retirada/)

    const effective = await loadProgramScheduleAndExecutions([activity.id], 2046, "ws-1")
    expect(effective.scheduleRows.map((row) => [row.month, row.week])).toEqual([[7, 4]])
    expect(effective.executionRows).toEqual([expect.objectContaining({ month: 7, week: 4 })])
  })

  it("agrega por faena aplicando overrides y exclusiones, sin filtrar evidencia entre faenas", async () => {
    const { getPdtpAggregatedSheetViewByProgram } = await import("@/lib/services/prevention-pdtp")
    const { excludeActivityForWorksite } = await import("@/lib/services/pdtp/worksites")
    const { program, activity } = await createDraftProgramWithActivity(2049)
    const now = new Date().toISOString()

    const [sheet] = await inMemoryDb.select().from(schema.pdtpSheets)
      .where(eq(schema.pdtpSheets.programId, program.id))
    expect(sheet).toBeDefined()
    await inMemoryDb.insert(schema.pdtpSheetActivities).values({
      id: "aggregate-membership",
      sheetId: sheet!.id,
      sheetCode: "pdtp_general",
      activityId: activity.id,
      sheetRow: 1,
      displayOrder: 1,
    }).onConflictDoNothing()
    await inMemoryDb.insert(schema.pdtpActivitySchedule).values({
      id: "aggregate-plan",
      activityId: activity.id,
      year: 2049,
      month: 1,
      week: 1,
      plannedQuantity: 1,
      sourceColumn: "test",
    })
    await inMemoryDb.insert(schema.pdtpActivityScheduleOverrides).values({
      id: "aggregate-override",
      activityId: activity.id,
      worksiteId: "ws-1",
      year: 2049,
      month: 1,
      week: 1,
      plannedQuantity: 2,
      updatedByUserId: "user-1",
      createdAt: now,
      updatedAt: now,
    })
    await inMemoryDb.insert(schema.pdtpExecutions).values([
      { id: "aggregate-approved", activityId: activity.id, worksiteId: "ws-1", year: 2049, month: 1, week: 1, executedQuantity: 2, status: "approved", evidenceText: "Evidencia privada A", evidencePhotos: [], sourceMetadataJson: {}, evidenceStatus: "provided", createdAt: now, updatedAt: now },
      { id: "aggregate-draft", activityId: activity.id, worksiteId: "ws-2", year: 2049, month: 1, week: 1, executedQuantity: 1, status: "draft", evidenceText: "Borrador privado B", evidencePhotos: [], sourceMetadataJson: {}, evidenceStatus: "provided", createdAt: now, updatedAt: now },
    ])
    await excludeActivityForWorksite(activity.id, "ws-2", "No aplica a la segunda faena durante este programa.", "user-1")

    const aggregate = await getPdtpAggregatedSheetViewByProgram(program.id, "pdtp_general", ["ws-1", "ws-2"], { year: 2049, month: 1, week: 1 })

    expect(aggregate?.aggregate).toBe(true)
    expect(aggregate?.monthlyTotals[0]).toMatchObject({ planned: 2, executed: 2 })
    expect(aggregate?.activities[0]).toMatchObject({ totalPlanned: 2, totalExecuted: 2, executions: [] })
    expect(aggregate?.activities[0]?.worksiteSummaries).toEqual([
      expect.objectContaining({ worksiteId: "ws-1", planned: 2, executed: 2, status: "executed" }),
      expect.objectContaining({ worksiteId: "ws-2", planned: 0, executed: 0, status: "not_scheduled" }),
    ])
    expect(JSON.stringify(aggregate)).not.toContain("Evidencia privada")
    expect(JSON.stringify(aggregate)).not.toContain("Borrador privado")
  })

  it("el agregado falla cerrado a la membresía declarada del programa", async () => {
    const { getPdtpAggregatedSheetViewByProgram, setPdtpProgramWorksites } = await import("@/lib/services/prevention-pdtp")
    const { program, activity } = await createDraftProgramWithActivity(2050)
    const [sheet] = await inMemoryDb.select().from(schema.pdtpSheets)
      .where(eq(schema.pdtpSheets.programId, program.id))
    await inMemoryDb.insert(schema.pdtpSheetActivities).values({
      id: "membership-aggregate-sheet-activity",
      sheetId: sheet!.id,
      sheetCode: "pdtp_general",
      activityId: activity.id,
      sheetRow: 1,
      displayOrder: 1,
    })

    await setPdtpProgramWorksites(program.id, ["ws-1"], "user-1", "all")
    const aggregate = await getPdtpAggregatedSheetViewByProgram(program.id, "pdtp_general", ["ws-1", "ws-2"], { year: 2050, month: 1, week: 1 })

    expect(aggregate?.worksiteSummaries.map((summary) => summary.worksiteId)).toEqual(["ws-1"])
    expect(aggregate?.activities.every((activity) => activity.worksiteSummaries.every((summary) => summary.worksiteId === "ws-1"))).toBe(true)
  })

  it("el reporte filtra por clave estable y usa el responsable efectivo de la faena", async () => {
    const { setPdtpActivityWorksiteAdjustment } = await import("@/lib/services/pdtp/worksites")
    const { getPdtpManagementReport } = await import("@/lib/services/prevention-pdtp")
    const { program, activity } = await createDraftProgramWithActivity(2047)
    await inMemoryDb.update(schema.pdtpActivities).set({
      scheduleMode: "scheduled",
      responsibleSlugs: ["prf"],
      responsibleDisplay: "Prevencionista global",
    }).where(eq(schema.pdtpActivities.id, activity.id))
    await inMemoryDb.insert(schema.pdtpActivitySchedule).values({
      id: "report-plan",
      activityId: activity.id,
      year: 2047,
      month: 1,
      week: 1,
      plannedQuantity: 1,
      sourceColumn: "test",
    })
    await setPdtpActivityWorksiteAdjustment({
      activityId: activity.id,
      worksiteId: "ws-1",
      excluded: false,
      reason: "La faena asigna una jefatura responsable específica.",
      responsibleSlugs: ["jdpr"],
      responsibleDisplay: "Jefatura DPR local",
    }, "user-1", ["ws-1"])
    await inMemoryDb.update(schema.pdtpPrograms).set({ status: "active" }).where(eq(schema.pdtpPrograms.id, program.id))

    const byOverride = await getPdtpManagementReport({
      programId: program.id,
      worksiteId: "ws-1",
      scope: ["ws-1"],
      filters: { responsibleSlug: "jdpr", activityNumber: activity.n },
    })
    expect(byOverride?.activities).toEqual([
      expect.objectContaining({ activityNumber: activity.n, responsibles: ["Jefatura DPR local"], planned: 1 }),
    ])
    expect(byOverride?.responsibleOptions).toContainEqual({ value: "jdpr", label: "Jefatura DPR local" })

    const byGlobal = await getPdtpManagementReport({
      programId: program.id,
      worksiteId: "ws-1",
      scope: ["ws-1"],
      filters: { responsibleSlug: "prf" },
    })
    expect(byGlobal?.activities).toHaveLength(0)
  })
})
