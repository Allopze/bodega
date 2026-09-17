import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { eq } from "drizzle-orm"
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
  // Orden importa: `pdtp_activities` referencia `pdtp_objectives` con una FK
  // compuesta `ON DELETE SET NULL` que (por ser compuesta sin lista de
  // columnas) nulifica también `program_id` — NOT NULL. Borrar las
  // actividades primero evita que quede una fila colgando cuando se borran
  // los objetivos después.
  await inMemoryDb.delete(schema.pdtpActivityExecutorAssignments)
  await inMemoryDb.delete(schema.pdtpRevisionDiffDecisions)
  await inMemoryDb.delete(schema.pdtpActivitySchedule)
  await inMemoryDb.delete(schema.pdtpActivities)
  await inMemoryDb.delete(schema.pdtpObjectives)
  await inMemoryDb.delete(schema.pdtpProgramTemplateVersions)
  await inMemoryDb.delete(schema.pdtpProgramTemplates)
  await inMemoryDb.delete(schema.pdtpPrograms)
  await inMemoryDb.delete(schema.pdtpResponsibleCatalog)
  await inMemoryDb.delete(schema.users)

  await inMemoryDb.insert(schema.users).values({ id: "user-1", name: "U1", email: "u1@test", hashedPassword: "x", isActive: true })
  await inMemoryDb.insert(schema.pdtpResponsibleCatalog).values([
    { slug: "prevencionista", displayName: "Prevencionista", kind: "role" },
  ])
})

/** Programa borrador con una actividad de prueba, listo para asignarle objetivos. */
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

describe("PDTP objetivos: servicio y huella", () => {
  it("eliminar un objetivo deja objectiveId en null en sus actividades", async () => {
    const { upsertPdtpObjective, deletePdtpObjective, setPdtpActivityObjective } = await import("@/lib/services/pdtp/objectives")
    const { program, activity } = await createDraftProgramWithActivity(2061)

    const objective = await upsertPdtpObjective({
      programId: program.id,
      code: "1",
      name: "FORTALECER EL LIDERAZGO DE SEGURIDAD Y SALUD EN EL TRABAJO",
    }, "user-1")
    await setPdtpActivityObjective({ programId: program.id, activityId: activity.id, objectiveId: objective.id }, "user-1")

    const [assigned] = await inMemoryDb.select().from(schema.pdtpActivities).where(eq(schema.pdtpActivities.id, activity.id))
    expect(assigned?.objectiveId).toBe(objective.id)

    await deletePdtpObjective({ programId: program.id, objectiveId: objective.id }, "user-1")

    const [afterDelete] = await inMemoryDb.select().from(schema.pdtpActivities).where(eq(schema.pdtpActivities.id, activity.id))
    expect(afterDelete?.objectiveId).toBeNull()
    const remainingObjectives = await inMemoryDb.select().from(schema.pdtpObjectives).where(eq(schema.pdtpObjectives.programId, program.id))
    expect(remainingObjectives).toHaveLength(0)
  })

  it("la revisión v+1 conserva los objetivos y remapea objectiveId en la copia (no copia el id del origen)", async () => {
    const { upsertPdtpObjective, setPdtpActivityObjective } = await import("@/lib/services/pdtp/objectives")
    const { createPdtpRevision } = await import("@/lib/services/pdtp/programs")
    const { program, activity } = await createDraftProgramWithActivity(2062)

    const objective = await upsertPdtpObjective({
      programId: program.id,
      code: "1",
      name: "FORTALECER EL LIDERAZGO DE SEGURIDAD Y SALUD EN EL TRABAJO",
    }, "user-1")
    await setPdtpActivityObjective({ programId: program.id, activityId: activity.id, objectiveId: objective.id }, "user-1")

    // La revisión sólo se puede abrir desde el programa activo.
    await inMemoryDb.update(schema.pdtpPrograms).set({ status: "active" }).where(eq(schema.pdtpPrograms.id, program.id))

    const revision = await createPdtpRevision({ sourceProgramId: program.id, userId: "user-1" })
    expect(revision.program.id).not.toBe(program.id)

    const revisionObjectives = await inMemoryDb.select().from(schema.pdtpObjectives)
      .where(eq(schema.pdtpObjectives.programId, revision.programId))
    expect(revisionObjectives).toHaveLength(1)
    expect(revisionObjectives[0]?.code).toBe("1")
    expect(revisionObjectives[0]?.name).toBe(objective.name)
    // Objetivo clonado, no reutilizado: mismo código, id distinto.
    expect(revisionObjectives[0]?.id).not.toBe(objective.id)

    const revisionActivities = await inMemoryDb.select().from(schema.pdtpActivities)
      .where(eq(schema.pdtpActivities.programId, revision.programId))
    expect(revisionActivities).toHaveLength(1)
    // El objetivo remapeado apunta al objetivo NUEVO del programa nuevo, no al
    // id del programa origen (que violaría la FK compuesta
    // `pdtp_activities_objective_same_program_fk`).
    expect(revisionActivities[0]?.objectiveId).toBe(revisionObjectives[0]?.id)
    expect(revisionActivities[0]?.objectiveId).not.toBe(objective.id)
  })

  it("la huella cambia al asignar un objetivo y reporta el schemaVersion vigente", async () => {
    const { setPdtpActivityObjective, upsertPdtpObjective } = await import("@/lib/services/pdtp/objectives")
    const { computePdtpProgramContentDigest, CURRENT_PDTP_CONTENT_SCHEMA_VERSION } = await import("@/lib/services/pdtp/content-digest")
    const { program, activity } = await createDraftProgramWithActivity(2063)

    const baseline = await computePdtpProgramContentDigest(program.id)
    expect(baseline.snapshot).toMatchObject({ schemaVersion: CURRENT_PDTP_CONTENT_SCHEMA_VERSION, objectives: [] })

    const objective = await upsertPdtpObjective({
      programId: program.id,
      code: "1",
      name: "FORTALECER EL LIDERAZGO DE SEGURIDAD Y SALUD EN EL TRABAJO",
    }, "user-1")
    await setPdtpActivityObjective({ programId: program.id, activityId: activity.id, objectiveId: objective.id }, "user-1")

    const withObjective = await computePdtpProgramContentDigest(program.id)
    expect(withObjective.digest).not.toBe(baseline.digest)
    expect(withObjective.snapshot).toMatchObject({
      schemaVersion: CURRENT_PDTP_CONTENT_SCHEMA_VERSION,
      objectives: [expect.objectContaining({ code: "1", name: objective.name })],
      activities: [expect.objectContaining({ objectiveCode: "1" })],
    })
  })

  it("batchUpdatePdtpActivities con objectiveId asigna a N actividades", async () => {
    const { addPdtpActivity, batchUpdatePdtpActivities } = await import("@/lib/services/prevention-pdtp")
    const { upsertPdtpObjective } = await import("@/lib/services/pdtp/objectives")
    const { program, activity: first } = await createDraftProgramWithActivity(2064)
    const second = await addPdtpActivity({
      programId: program.id,
      activity: "Segunda actividad de prueba",
      program: "Guía de ejecución",
      responsibleSlugs: ["prevencionista"],
      responsibleDisplay: "Prevencionista",
      sheetCodes: [],
      scheduleMode: "on_demand",
    }, "user-1")

    const objective = await upsertPdtpObjective({
      programId: program.id,
      code: "2",
      name: "MANTENER A LA EMPRESA Y SUS SUCURSALES ENTRE LOS MÁRGENES DE LA NORMATIVA LEGAL VIGENTE",
    }, "user-1")

    const result = await batchUpdatePdtpActivities({
      programId: program.id,
      activityIds: [first.id, second.id],
      objectiveId: objective.id,
    }, "user-1")
    expect(result.updatedCount).toBe(2)

    const updated = await inMemoryDb.select().from(schema.pdtpActivities)
      .where(eq(schema.pdtpActivities.programId, program.id))
    expect(updated.every((row) => row.objectiveId === objective.id)).toBe(true)

    // Un objetivo ajeno al programa se rechaza (FK compuesta por programa).
    const { program: otherProgram, activity: otherActivity } = await createDraftProgramWithActivity(2065)
    await expect(
      batchUpdatePdtpActivities({ programId: otherProgram.id, activityIds: [otherActivity.id], objectiveId: objective.id }, "user-1"),
    ).rejects.toThrow()
  })

  it("adoptar una diferencia de la Base resuelve objectiveCode al objectiveId del programa destino, no el del origen (I1)", async () => {
    const { upsertPdtpObjective, setPdtpActivityObjective } = await import("@/lib/services/pdtp/objectives")
    const { createPdtpRevision } = await import("@/lib/services/pdtp/programs")
    const { createPdtpTemplateVersion } = await import("@/lib/services/pdtp/templates")
    const { comparePdtpRevisionToCurrentBase } = await import("@/lib/services/pdtp/base-comparison")
    const { decidePdtpRevisionDiff } = await import("@/lib/services/pdtp/revision-diff-decisions")
    const { program: source, activity: sourceActivity } = await createDraftProgramWithActivity(2070)

    const sourceObjective1 = await upsertPdtpObjective({
      programId: source.id, code: "1", name: "FORTALECER EL LIDERAZGO DE SEGURIDAD Y SALUD EN EL TRABAJO",
    }, "user-1")
    const sourceObjective2 = await upsertPdtpObjective({
      programId: source.id, code: "2", name: "MANTENER A LA EMPRESA Y SUS SUCURSALES ENTRE LOS MÁRGENES DE LA NORMATIVA LEGAL VIGENTE",
    }, "user-1")
    await setPdtpActivityObjective({ programId: source.id, activityId: sourceActivity.id, objectiveId: sourceObjective1.id }, "user-1")

    // La revisión clona ambos objetivos (1 y 2) con ids nuevos, y la
    // actividad queda apuntando al objetivo "1" clonado — igual que en el
    // test de arriba.
    await inMemoryDb.update(schema.pdtpPrograms).set({ status: "active" }).where(eq(schema.pdtpPrograms.id, source.id))
    const revision = await createPdtpRevision({ sourceProgramId: source.id, userId: "user-1" })
    const [revisionActivity] = await inMemoryDb.select().from(schema.pdtpActivities)
      .where(eq(schema.pdtpActivities.programId, revision.programId))
    const revisionObjective2 = (await inMemoryDb.select().from(schema.pdtpObjectives)
      .where(eq(schema.pdtpObjectives.programId, revision.programId)))
      .find((objective) => objective.code === "2")!

    // El programa origen (ahora "activo", fuera del flujo de edición normal)
    // cambia de objetivo directamente en la base — el operador no puede usar
    // `setPdtpActivityObjective` sobre un programa activo, así que se simula
    // el cambio como lo haría una edición posterior antes de publicar Base.
    await inMemoryDb.update(schema.pdtpActivities).set({ objectiveId: sourceObjective2.id })
      .where(eq(schema.pdtpActivities.id, sourceActivity.id))

    await createPdtpTemplateVersion({
      sourceProgramId: source.id,
      name: "Base preventiva 2026",
      userId: "user-1",
      allowUnclassifiedBaseActivities: true,
    })

    const diff = await comparePdtpRevisionToCurrentBase(revision.programId)
    const changed = diff?.items.find((item) => item.activityNumber === revisionActivity!.n)
    expect(changed).toMatchObject({ kind: "content_changed" })

    await decidePdtpRevisionDiff({
      programId: revision.programId,
      activityIdentity: changed!.identity,
      decision: "applied",
      userId: "user-1",
    })

    const [afterActivity] = await inMemoryDb.select().from(schema.pdtpActivities)
      .where(eq(schema.pdtpActivities.id, revisionActivity!.id))
    // Apunta al objetivo "2" YA EXISTENTE en el programa destino (clonado al
    // crear la revisión), nunca al id del objetivo "2" del programa origen —
    // eso violaría la FK compuesta `pdtp_activities_objective_same_program_fk`.
    expect(afterActivity?.objectiveId).toBe(revisionObjective2.id)
    expect(afterActivity?.objectiveId).not.toBe(sourceObjective2.id)
  })

  it("reorderPdtpObjectives exige la lista completa y rechaza duplicados (I2)", async () => {
    const { upsertPdtpObjective, reorderPdtpObjectives } = await import("@/lib/services/pdtp/objectives")
    const { program } = await createDraftProgramWithActivity(2071)

    const a = await upsertPdtpObjective({ programId: program.id, code: "1", name: "A" }, "user-1")
    const b = await upsertPdtpObjective({ programId: program.id, code: "2", name: "B" }, "user-1")
    const c = await upsertPdtpObjective({ programId: program.id, code: "3", name: "C" }, "user-1")

    // Lista parcial: omite "b".
    await expect(
      reorderPdtpObjectives({ programId: program.id, orderedIds: [c.id, a.id] }, "user-1"),
    ).rejects.toThrow(/todos los objetivos/)

    // Duplicado explícito: A(0), B(1), C(2) con `[C, A]` dejaría C=0, A=1 y B
    // sin tocar — orden ambiguo. Con `[A, A, C]` el largo (3) coincide con el
    // total de objetivos pese a omitir B y repetir A; sin el rechazo
    // explícito de duplicados, `[...new Set(ids)]` lo habría dejado pasar.
    await expect(
      reorderPdtpObjectives({ programId: program.id, orderedIds: [a.id, a.id, c.id] }, "user-1"),
    ).rejects.toThrow(/duplicados/)

    // Ninguno de los dos intentos rechazados alteró el orden vigente.
    const unchanged = await inMemoryDb.select().from(schema.pdtpObjectives)
      .where(eq(schema.pdtpObjectives.programId, program.id))
    expect(unchanged.find((o) => o.id === a.id)?.displayOrder).toBe(a.displayOrder)
    expect(unchanged.find((o) => o.id === b.id)?.displayOrder).toBe(b.displayOrder)
    expect(unchanged.find((o) => o.id === c.id)?.displayOrder).toBe(c.displayOrder)

    // La lista completa y sin duplicados sí se aplica.
    await reorderPdtpObjectives({ programId: program.id, orderedIds: [c.id, a.id, b.id] }, "user-1")
    const reordered = await inMemoryDb.select().from(schema.pdtpObjectives)
      .where(eq(schema.pdtpObjectives.programId, program.id))
    expect(reordered.find((o) => o.id === c.id)?.displayOrder).toBe(0)
    expect(reordered.find((o) => o.id === a.id)?.displayOrder).toBe(1)
    expect(reordered.find((o) => o.id === b.id)?.displayOrder).toBe(2)
  })

  it("deletePdtpProgram borra un programa con objetivos y actividades asignadas sin reventar (I3)", async () => {
    const { upsertPdtpObjective, setPdtpActivityObjective } = await import("@/lib/services/pdtp/objectives")
    const { deletePdtpProgram } = await import("@/lib/services/pdtp/programs")
    const { program, activity } = await createDraftProgramWithActivity(2072)

    const objective = await upsertPdtpObjective({ programId: program.id, code: "1", name: "Objetivo" }, "user-1")
    await setPdtpActivityObjective({ programId: program.id, activityId: activity.id, objectiveId: objective.id }, "user-1")

    // Antes de la migración 0302 esto revienta con 23502 (la FK compuesta
    // original nulificaba también `program_id`, NOT NULL) en cualquier orden
    // de ejecución de cascades donde el de `pdtp_objectives` corra antes que
    // el de `pdtp_activities` — que es justamente el orden que produce
    // reconstruir el esquema desde cero, porque `pdtpObjectives` se declara
    // antes que `pdtpActivities` en `db/schema/prevention/pdtp.ts`.
    await expect(deletePdtpProgram(program.id)).resolves.toBeUndefined()

    const remainingPrograms = await inMemoryDb.select().from(schema.pdtpPrograms).where(eq(schema.pdtpPrograms.id, program.id))
    expect(remainingPrograms).toHaveLength(0)
    const remainingActivities = await inMemoryDb.select().from(schema.pdtpActivities).where(eq(schema.pdtpActivities.programId, program.id))
    expect(remainingActivities).toHaveLength(0)
    const remainingObjectives = await inMemoryDb.select().from(schema.pdtpObjectives).where(eq(schema.pdtpObjectives.programId, program.id))
    expect(remainingObjectives).toHaveLength(0)
  })
})
