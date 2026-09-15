import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import type { DB } from "@/db"
import * as schema from "@/db/schema"
import { migratePGlite } from "@/lib/testing/pglite-migrate"
import {
  replacePdtpAccreditationBindings,
  resolvePdtpAccreditationTarget,
} from "@/lib/services/pdtp/accreditation-bindings"

const pg = new PGlite()
const database = drizzle(pg, { schema })
const client = database as unknown as DB
const now = new Date().toISOString()

beforeAll(async () => {
  await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))
  await database.insert(schema.pdtpCatalogActivities).values([
    { id: "binding-active", code: "PDT-TEST-BINDING", status: "active", currentRevision: 1, createdAt: now, updatedAt: now },
    { id: "binding-retired", code: "PDT-TEST-RETIRED", status: "retired", currentRevision: 1, retiredReason: "Retirada para probar conservación histórica", retiredAt: now, createdAt: now, updatedAt: now },
  ])
  await database.insert(schema.pdtpCatalogActivityRevisions).values([
    { id: "binding-active-r1", catalogActivityId: "binding-active", revision: 1, title: "Ejecutar prueba de binding", description: "Descripción activa", executionGuidance: "Ejecutar prueba", createdAt: now },
    { id: "binding-retired-r1", catalogActivityId: "binding-retired", revision: 1, title: "Conservar prueba retirada", description: "Descripción retirada", executionGuidance: "Conservar historial", createdAt: now },
  ])
})
afterAll(async () => pg.close())

describe("bindings corporativos de acreditación PDTP", () => {
  it("prioriza identidades de catálogo y sólo usa números como compatibilidad", async () => {
    expect(await resolvePdtpAccreditationTarget({ sourceType: "campana", sourceId: "source-1", eventType: "close", legacyActivityNumbers: [85] }, client))
      .toEqual({ activityNumbers: [85] })
    await replacePdtpAccreditationBindings({ sourceType: "campana", sourceId: "source-1", eventType: "close", catalogActivityIds: ["binding-active"] }, client)
    expect(await resolvePdtpAccreditationTarget({ sourceType: "campana", sourceId: "source-1", eventType: "close", legacyActivityNumbers: [85] }, client))
      .toEqual({ catalogActivityIds: ["binding-active"] })
  })

  it("conserva un vínculo retirado existente pero impide seleccionarlo de nuevo", async () => {
    await database.insert(schema.pdtpAccreditationBindings).values({
      id: "existing-retired-binding", sourceType: "documento", sourceId: "source-history", eventType: "publish",
      catalogActivityId: "binding-retired", isActive: true, createdAt: now, updatedAt: now,
    })
    await expect(replacePdtpAccreditationBindings({ sourceType: "documento", sourceId: "source-history", eventType: "publish", catalogActivityIds: ["binding-retired"] }, client)).resolves.toEqual(["binding-retired"])
    await replacePdtpAccreditationBindings({ sourceType: "documento", sourceId: "source-history", eventType: "publish", catalogActivityIds: [] }, client)
    await expect(replacePdtpAccreditationBindings({ sourceType: "documento", sourceId: "source-history", eventType: "publish", catalogActivityIds: ["binding-retired"] }, client)).rejects.toThrow(/retirada/i)
  })
})
