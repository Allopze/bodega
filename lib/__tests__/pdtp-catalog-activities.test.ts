import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { and, eq } from "drizzle-orm"
import { drizzle } from "drizzle-orm/pglite"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import * as schema from "@/db/schema"
import type { DB } from "@/db"
import { migratePGlite } from "@/lib/testing/pglite-migrate"
import {
  adoptLatestCatalogRevision,
  createCatalogActivity,
  createCatalogActivityRevision,
  publishCatalogActivity,
  retireCatalogActivity,
} from "@/lib/services/pdtp/catalog-activities"
import {
  addCatalogActivityToProgram,
  createPublishedCatalogActivityAndAddToProgram,
  PdtpCatalogCodeConflictError,
} from "@/lib/services/pdtp/activity-creation"

const pg = new PGlite()
const database = drizzle(pg, { schema })
const client = database as unknown as DB
const now = new Date().toISOString()

/**
 * Incorpora una identidad al programa como lo deja `addPdtpActivity`, que es
 * la única vía del producto. Sus guardas (publicada, no repetida, no retirada)
 * se prueban contra el servicio real en `prevention-pdtp.test.ts`; acá sólo se
 * necesita la actividad anual ya creada para ejercitar las revisiones.
 */
async function incorporateForTest(input: { programId: string; catalogActivityId: string; n: number }) {
  const [revision] = await database.select().from(schema.pdtpCatalogActivityRevisions)
    .where(eq(schema.pdtpCatalogActivityRevisions.catalogActivityId, input.catalogActivityId))
    .orderBy(schema.pdtpCatalogActivityRevisions.revision)
  const [created] = await database.insert(schema.pdtpActivities).values({
    id: `${input.programId}-catalog-${input.n}`,
    programId: input.programId,
    n: input.n,
    catalogActivityId: input.catalogActivityId,
    catalogRevision: revision!.revision,
    activity: revision!.description,
    program: revision!.executionGuidance,
    responsibleSlugs: [],
    responsibleDisplay: "Prevención",
    sourceSheetRow: 0,
    createdAt: now,
    updatedAt: now,
  }).returning()
  return created!
}

beforeAll(async () => migratePGlite(pg, path.resolve(process.cwd(), "db/migrations")))
afterAll(async () => pg.close())

describe("ciclo de vida de actividades corporativas PDTP", () => {
  it("fija revisiones y sólo permite adoptar la última en un programa editable", async () => {
    const created = await createCatalogActivity({
      code: "PDT-TEST-REVISIONES",
      title: "Inspeccionar condiciones de prueba",
      description: "Descripción de la revisión inicial",
      executionGuidance: "Ejecutar según la guía inicial",
    }, client)

    await database.insert(schema.pdtpPrograms).values({
      id: "catalog-program-draft", year: 2095, version: 1, status: "draft", title: "Programa de prueba",
      elaboratedByName: "Test", elaboratedByTitle: "Test", creationMode: "blank", createdAt: now, updatedAt: now,
    })

    await publishCatalogActivity(created.id, client)
    const annual = await incorporateForTest({ programId: "catalog-program-draft", catalogActivityId: created.id, n: 30 })
    expect(annual.catalogRevision).toBe(1)

    const revision = await createCatalogActivityRevision({
      catalogActivityId: created.id,
      title: "Inspeccionar condiciones actualizadas",
      description: "Descripción de la segunda revisión",
      executionGuidance: "Ejecutar según la guía actualizada",
      changeNote: "Se aclara el alcance de la inspección",
    }, client)
    expect(revision.revision).toBe(2)

    let [stored] = await database.select().from(schema.pdtpActivities).where(eq(schema.pdtpActivities.id, annual.id))
    expect(stored).toMatchObject({ catalogRevision: 1, activity: "Descripción de la revisión inicial" })

    await adoptLatestCatalogRevision(annual.id, client)
    ;[stored] = await database.select().from(schema.pdtpActivities).where(eq(schema.pdtpActivities.id, annual.id))
    expect(stored).toMatchObject({ catalogRevision: 2, activity: "Descripción de la segunda revisión", program: "Ejecutar según la guía actualizada" })

    await database.update(schema.pdtpPrograms).set({ status: "in_review" }).where(eq(schema.pdtpPrograms.id, "catalog-program-draft"))
    await createCatalogActivityRevision({
      catalogActivityId: created.id,
      title: "Inspeccionar condiciones finales",
      description: "Descripción de la tercera revisión",
      executionGuidance: "Ejecutar según la guía final",
      changeNote: "Nueva revisión sin adopción automática",
    }, client)
    await expect(adoptLatestCatalogRevision(annual.id, client)).rejects.toThrow(/editable/i)
  })

  it("retira sin borrar el historial y evita selecciones nuevas", async () => {
    const created = await createCatalogActivity({
      code: "PDT-TEST-RETIRO",
      title: "Realizar actividad que será retirada",
      description: "Descripción que debe conservarse",
      executionGuidance: "Guía que debe conservarse",
    }, client)
    await publishCatalogActivity(created.id, client)
    await database.insert(schema.pdtpPrograms).values({
      id: "catalog-program-retire", year: 2096, version: 1, status: "draft", title: "Programa retiro",
      elaboratedByName: "Test", elaboratedByTitle: "Test", creationMode: "blank", createdAt: now, updatedAt: now,
    })
    const annual = await incorporateForTest({ programId: "catalog-program-retire", catalogActivityId: created.id, n: 1 })
    await retireCatalogActivity(created.id, "Ya no corresponde al estándar corporativo", client)

    // La actividad anual ya incorporada sobrevive al retiro: el programa del
    // año está congelado y su historial tiene que seguir explicándose.
    expect((await database.select().from(schema.pdtpActivities).where(eq(schema.pdtpActivities.id, annual.id)))[0]).toBeDefined()
    const [revision] = await database.select().from(schema.pdtpCatalogActivityRevisions)
      .where(eq(schema.pdtpCatalogActivityRevisions.catalogActivityId, created.id))
    expect(revision).toMatchObject({ description: "Descripción que debe conservarse" })
  })
})

describe("creación unificada de actividades PDTP", () => {
  it("publica la definición y configura la actividad anual en una sola transacción", async () => {
    await database.insert(schema.users).values({
      id: "unified-creator-user",
      name: "Prevencionista creador",
      email: "unified-creator@example.test",
      hashedPassword: "x",
    })
    await database.insert(schema.pdtpResponsibleCatalog).values({
      slug: "unified-responsible",
      displayName: "Equipo responsable unificado",
      roleName: "prevencionista",
      kind: "rol_rbac",
    })
    await database.insert(schema.pdtpPrograms).values({
      id: "unified-program", year: 2097, version: 1, status: "draft", title: "Programa unificado",
      elaboratedByName: "Test", elaboratedByTitle: "Test", creationMode: "blank", createdAt: now, updatedAt: now,
    })
    await database.insert(schema.pdtpSheets).values({
      id: "unified-program-general",
      programId: "unified-program",
      code: "pdtp_general",
      label: "Vista general",
      area: "Prevención",
      defaultScopeRoles: [],
    })

    const result = await createPublishedCatalogActivityAndAddToProgram({
      programId: "unified-program",
      definition: {
        code: "PDT-TEST-UNIFICADA",
        title: "Inspeccionar controles críticos",
        description: "Inspeccionar los controles críticos definidos para la operación",
        executionGuidance: "Registrar el resultado y adjuntar evidencia verificable",
      },
      execution: {
        responsibleSlug: "unified-responsible",
        scheduleMode: "scheduled",
        recurrenceRule: { frequency: "monthly", interval: 1, plannedQuantity: 1, weekOfMonth: 2 },
        evidenceRequirement: "Registro de ejecución",
        audienceRoles: [],
        notes: "Creada desde el flujo unificado",
      },
    }, {
      userId: "unified-creator-user",
      userEmail: "unified-creator@example.test",
    }, client)

    const [catalog] = await database.select().from(schema.pdtpCatalogActivities)
      .where(eq(schema.pdtpCatalogActivities.id, result.catalogActivityId))
    expect(catalog).toMatchObject({ code: "PDT-TEST-UNIFICADA", status: "active", currentRevision: 1 })

    const [annual] = await database.select().from(schema.pdtpActivities)
      .where(eq(schema.pdtpActivities.id, result.annualActivityId))
    expect(annual).toMatchObject({
      programId: "unified-program",
      catalogActivityId: result.catalogActivityId,
      catalogRevision: 1,
      responsibleSlugs: ["unified-responsible"],
      responsibleDisplay: "Equipo responsable unificado",
      scheduleMode: "scheduled",
    })

    const schedule = await database.select().from(schema.pdtpActivitySchedule)
      .where(eq(schema.pdtpActivitySchedule.activityId, result.annualActivityId))
    expect(schedule).toHaveLength(12)
    expect(schedule.every((cell) => cell.week === 2 && cell.plannedQuantity === 1)).toBe(true)
    expect(await database.select().from(schema.pdtpSheetActivities)
      .where(eq(schema.pdtpSheetActivities.activityId, result.annualActivityId))).toHaveLength(1)
    expect(await database.select().from(schema.pdtpChangeLog)
      .where(eq(schema.pdtpChangeLog.programId, "unified-program"))).toHaveLength(1)
    expect(await database.select().from(schema.auditLog).where(and(
      eq(schema.auditLog.entityType, "pdtp_catalog_activity"),
      eq(schema.auditLog.entityId, result.catalogActivityId),
    ))).toHaveLength(1)
  })

  it("revierte la definición si el programa no tiene una hoja utilizable", async () => {
    await database.insert(schema.pdtpPrograms).values({
      id: "unified-program-no-sheet", year: 2098, version: 1, status: "draft", title: "Programa sin hoja",
      elaboratedByName: "Test", elaboratedByTitle: "Test", creationMode: "blank", createdAt: now, updatedAt: now,
    })

    await expect(createPublishedCatalogActivityAndAddToProgram({
      programId: "unified-program-no-sheet",
      definition: {
        code: "PDT-TEST-SIN-HOJA",
        title: "Actividad que debe revertirse",
        description: "No puede quedar como definición huérfana",
        executionGuidance: "No corresponde ejecutar",
      },
      execution: {
        responsibleSlug: "unified-responsible",
        scheduleMode: "on_demand",
        dueDays: 5,
        audienceRoles: [],
      },
    }, { userId: "unified-creator-user" }, client)).rejects.toThrow(/hoja/i)

    expect(await database.select().from(schema.pdtpCatalogActivities)
      .where(eq(schema.pdtpCatalogActivities.code, "PDT-TEST-SIN-HOJA"))).toHaveLength(0)
  })

  it("revierte todas las escrituras si falla el registro final", async () => {
    await expect(createPublishedCatalogActivityAndAddToProgram({
      programId: "unified-program",
      definition: {
        code: "PDT-TEST-ROLLBACK-FINAL",
        title: "Probar reversión al final",
        description: "La definición no puede sobrevivir a una transacción fallida",
        executionGuidance: "Intentar registrar con un actor inexistente",
      },
      execution: {
        responsibleSlug: "unified-responsible",
        scheduleMode: "on_demand",
        dueDays: 3,
        audienceRoles: [],
      },
    }, { userId: "actor-que-no-existe" }, client)).rejects.toThrow()

    expect(await database.select().from(schema.pdtpCatalogActivities)
      .where(eq(schema.pdtpCatalogActivities.code, "PDT-TEST-ROLLBACK-FINAL"))).toHaveLength(0)
  })

  it("no deja registros parciales si el programa está bloqueado o el código está repetido", async () => {
    await database.insert(schema.pdtpPrograms).values({
      id: "unified-program-locked", year: 2099, version: 1, status: "in_review", title: "Programa bloqueado",
      elaboratedByName: "Test", elaboratedByTitle: "Test", creationMode: "blank", createdAt: now, updatedAt: now,
    })
    await database.insert(schema.pdtpSheets).values({
      id: "unified-program-locked-general", programId: "unified-program-locked", code: "pdtp_general",
      label: "Vista general bloqueada", area: "Prevención", defaultScopeRoles: [],
    })

    const input = {
      definition: {
        code: "PDT-TEST-PROGRAMA-BLOQUEADO",
        title: "No incorporar en programa bloqueado",
        description: "Esta definición debe revertirse",
        executionGuidance: "No corresponde ejecutar",
      },
      execution: {
        responsibleSlug: "unified-responsible",
        scheduleMode: "on_demand" as const,
        dueDays: 3,
        audienceRoles: [],
      },
    }
    await expect(createPublishedCatalogActivityAndAddToProgram({ ...input, programId: "unified-program-locked" }, {
      userId: "unified-creator-user",
    }, client)).rejects.toThrow(/bloqueado|editable/i)
    expect(await database.select().from(schema.pdtpCatalogActivities)
      .where(eq(schema.pdtpCatalogActivities.code, input.definition.code))).toHaveLength(0)

    await expect(createPublishedCatalogActivityAndAddToProgram({
      ...input,
      programId: "unified-program",
      definition: { ...input.definition, code: "PDT-TEST-UNIFICADA" },
    }, { userId: "unified-creator-user" }, client)).rejects.toBeInstanceOf(PdtpCatalogCodeConflictError)
    expect(await database.select().from(schema.pdtpCatalogActivities)
      .where(eq(schema.pdtpCatalogActivities.code, "PDT-TEST-UNIFICADA"))).toHaveLength(1)
  })

  it("configura actividades bajo demanda y por evento sin fabricar calendario", async () => {
    const onDemand = await createPublishedCatalogActivityAndAddToProgram({
      programId: "unified-program",
      definition: {
        code: "PDT-TEST-BAJO-DEMANDA",
        title: "Atender solicitud preventiva",
        description: "Atender solicitudes preventivas cuando existan",
        executionGuidance: "Registrar la solicitud y su cierre",
      },
      execution: {
        responsibleSlug: "unified-responsible", scheduleMode: "on_demand", dueDays: 4, audienceRoles: [],
      },
    }, { userId: "unified-creator-user" }, client)
    const triggered = await createPublishedCatalogActivityAndAddToProgram({
      programId: "unified-program",
      definition: {
        code: "PDT-TEST-POR-EVENTO",
        title: "Inducir después de un ingreso",
        description: "Realizar inducción después del ingreso de personal",
        executionGuidance: "Registrar la inducción y la asistencia",
      },
      execution: {
        responsibleSlug: "unified-responsible", scheduleMode: "triggered", triggerType: "worker_entry",
        triggerDescription: "Ingreso de un trabajador", dueDays: 2, audienceRoles: [],
      },
    }, { userId: "unified-creator-user" }, client)

    const rows = await database.select().from(schema.pdtpActivities)
      .where(eq(schema.pdtpActivities.programId, "unified-program"))
    expect(rows.find((row) => row.id === onDemand.annualActivityId)).toMatchObject({ scheduleMode: "on_demand", dueDays: 4 })
    expect(rows.find((row) => row.id === triggered.annualActivityId)).toMatchObject({
      scheduleMode: "triggered", triggerType: "worker_entry", triggerDescription: "Ingreso de un trabajador", dueDays: 2,
    })
    expect(await database.select().from(schema.pdtpActivitySchedule)
      .where(eq(schema.pdtpActivitySchedule.activityId, onDemand.annualActivityId))).toHaveLength(0)
    expect(await database.select().from(schema.pdtpActivitySchedule)
      .where(eq(schema.pdtpActivitySchedule.activityId, triggered.annualActivityId))).toHaveLength(0)
  })

  it("rechaza incorporar dos veces la misma identidad de catálogo", async () => {
    const [catalog] = await database.select().from(schema.pdtpCatalogActivities)
      .where(eq(schema.pdtpCatalogActivities.code, "PDT-TEST-UNIFICADA"))
    const before = await database.select().from(schema.pdtpActivities)
      .where(eq(schema.pdtpActivities.programId, "unified-program"))

    await expect(addCatalogActivityToProgram({
      programId: "unified-program",
      catalogActivityId: catalog!.id,
      execution: {
        responsibleSlug: "unified-responsible", scheduleMode: "scheduled",
        recurrenceRule: { frequency: "annual", interval: 1, plannedQuantity: 1, weekOfMonth: 1 },
        audienceRoles: [],
      },
    }, { userId: "unified-creator-user" }, client)).rejects.toThrow(/ya está incorporada/i)

    expect(await database.select().from(schema.pdtpActivities)
      .where(eq(schema.pdtpActivities.programId, "unified-program"))).toHaveLength(before.length)
  })
})
