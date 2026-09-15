import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { eq } from "drizzle-orm"
import { drizzle } from "drizzle-orm/pglite"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import * as schema from "@/db/schema"
import type { DB } from "@/db"
import { migratePGlite } from "@/lib/testing/pglite-migrate"
import {
  addCatalogActivityToProgram,
  adoptLatestCatalogRevision,
  createCatalogActivity,
  createCatalogActivityRevision,
  publishCatalogActivity,
  retireCatalogActivity,
} from "@/lib/services/pdtp/catalog-activities"

const pg = new PGlite()
const database = drizzle(pg, { schema })
const client = database as unknown as DB
const now = new Date().toISOString()

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

    await expect(addCatalogActivityToProgram({ programId: "catalog-program-draft", catalogActivityId: created.id, n: 30, responsibleSlugs: [], responsibleDisplay: "Prevención" }, client))
      .rejects.toThrow(/publicada/i)

    await publishCatalogActivity(created.id, client)
    const annual = await addCatalogActivityToProgram({ programId: "catalog-program-draft", catalogActivityId: created.id, n: 30, responsibleSlugs: [], responsibleDisplay: "Prevención" }, client)
    expect(annual.catalogRevision).toBe(1)

    await expect(addCatalogActivityToProgram({ programId: "catalog-program-draft", catalogActivityId: created.id, n: 31, responsibleSlugs: [], responsibleDisplay: "Prevención" }, client))
      .rejects.toThrow(/ya está incorporada/i)

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
    const annual = await addCatalogActivityToProgram({ programId: "catalog-program-retire", catalogActivityId: created.id, n: 1, responsibleSlugs: [], responsibleDisplay: "Prevención" }, client)
    await retireCatalogActivity(created.id, "Ya no corresponde al estándar corporativo", client)

    expect((await database.select().from(schema.pdtpActivities).where(eq(schema.pdtpActivities.id, annual.id)))[0]).toBeDefined()
    await database.insert(schema.pdtpPrograms).values({
      id: "catalog-program-after-retire", year: 2097, version: 1, status: "draft", title: "Programa posterior",
      elaboratedByName: "Test", elaboratedByTitle: "Test", creationMode: "blank", createdAt: now, updatedAt: now,
    })
    await expect(addCatalogActivityToProgram({ programId: "catalog-program-after-retire", catalogActivityId: created.id, n: 1, responsibleSlugs: [], responsibleDisplay: "Prevención" }, client))
      .rejects.toThrow(/retirada/i)
  })
})
