import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import * as schema from "@/db/schema"
import { migratePGlite } from "@/lib/testing/pglite-migrate"

const pg = new PGlite()
const database = drizzle(pg, { schema })
const now = new Date().toISOString()

beforeAll(async () => {
  await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))
})

afterAll(async () => pg.close())

describe("restricciones del catálogo corporativo PDTP", () => {
  it("impide modificar una revisión o el código estable", async () => {
    await database.insert(schema.pdtpCatalogActivities).values({
      id: "catalog-immutable",
      code: "PDT-TEST-IMMUTABLE",
      status: "active",
      currentRevision: 1,
      createdAt: now,
      updatedAt: now,
    })
    await database.insert(schema.pdtpCatalogActivityRevisions).values({
      id: "catalog-immutable-r1",
      catalogActivityId: "catalog-immutable",
      revision: 1,
      title: "Inspeccionar equipos",
      description: "Descripción histórica",
      executionGuidance: "Guía histórica",
      createdAt: now,
    })

    await expect(database.update(schema.pdtpCatalogActivityRevisions).set({ title: "Reescrito" }))
      .rejects.toThrow()
    await expect(database.update(schema.pdtpCatalogActivities).set({ code: "PDT-OTRO" }))
      .rejects.toThrow()
  })

  it("permite usar la misma identidad con números anuales distintos pero no duplicarla", async () => {
    await database.insert(schema.pdtpCatalogActivities).values({
      id: "catalog-shared",
      code: "PDT-TEST-SHARED",
      status: "active",
      currentRevision: 1,
      createdAt: now,
      updatedAt: now,
    })
    await database.insert(schema.pdtpCatalogActivityRevisions).values({
      id: "catalog-shared-r1",
      catalogActivityId: "catalog-shared",
      revision: 1,
      title: "Realizar inspección compartida",
      description: "La misma identidad corporativa",
      executionGuidance: "Aplicar guía",
      createdAt: now,
    })
    await database.insert(schema.pdtpPrograms).values([
      { id: "program-2026", year: 2026, version: 1, title: "Programa 2026", status: "draft", elaboratedByName: "Test", elaboratedByTitle: "Test", creationMode: "blank", createdAt: now, updatedAt: now },
      { id: "program-2027", year: 2027, version: 1, title: "Programa 2027", status: "draft", elaboratedByName: "Test", elaboratedByTitle: "Test", creationMode: "blank", createdAt: now, updatedAt: now },
    ])
    await database.insert(schema.pdtpActivities).values([
      { id: "annual-2026", programId: "program-2026", n: 30, catalogActivityId: "catalog-shared", catalogRevision: 1, activity: "La misma identidad corporativa", program: "Aplicar guía", responsibleSlugs: [], responsibleDisplay: "Test", sourceSheetRow: 1, createdAt: now, updatedAt: now },
      { id: "annual-2027", programId: "program-2027", n: 7, catalogActivityId: "catalog-shared", catalogRevision: 1, activity: "La misma identidad corporativa", program: "Aplicar guía", responsibleSlugs: [], responsibleDisplay: "Test", sourceSheetRow: 1, createdAt: now, updatedAt: now },
    ])

    await expect(database.insert(schema.pdtpActivities).values({
      id: "annual-2027-duplicate",
      programId: "program-2027",
      n: 8,
      catalogActivityId: "catalog-shared",
      catalogRevision: 1,
      activity: "Duplicada",
      program: "Duplicada",
      responsibleSlugs: [],
      responsibleDisplay: "Test",
      sourceSheetRow: 2,
      createdAt: now,
      updatedAt: now,
    })).rejects.toThrow()
  })
})
