import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { migratePGlite } from "@/lib/testing/pglite-migrate"
import * as schema from "@/db/schema"

const pg = new PGlite()
const inMemoryDb = drizzle(pg, { schema })

await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))

afterAll(async () => { await pg.close() })

async function expectCheckViolation(promise: Promise<unknown>): Promise<void> {
  let thrown: unknown = null
  try { await promise } catch (e) { thrown = e }
  expect(thrown).toBeTruthy()
  const cause = (thrown as { cause?: { message?: string } }).cause
  const msg = `${(thrown as Error).message}\n${cause?.message ?? ""}`
  expect(msg).toMatch(/check|constraint|violates|Failing row/i)
}

/**
 * Invariantes de base del contenedor como sujeto.
 *
 * No bastan las validaciones del servicio: el CHECK es lo que impide que una
 * carga directa o un script dejen un run con dos sujetos, y es también lo que
 * tiene que seguir admitiendo las instancias PDTP anteriores al catálogo.
 */
describe("CHECK del contenedor como sujeto", () => {
  beforeAll(async () => {
    const now = new Date().toISOString()
    await inMemoryDb.insert(schema.users).values({
      id: "u-cont", name: "U", email: "u-cont@test", hashedPassword: "x", isActive: true,
    })
    await inMemoryDb.insert(schema.worksites).values({
      id: "w-cont", name: "W", code: "WCONT", isActive: true,
    })
    await inMemoryDb.insert(schema.preventionContainers).values({
      id: "cont-1", worksiteId: "w-cont", code: "CT-CHK-1", location: "Acopio",
      status: "operational", isActive: true, version: 1, createdByUserId: "u-cont",
    })
    await inMemoryDb.insert(schema.preventionEmergencyResources).values({
      id: "res-1", worksiteId: "w-cont", name: "Extintor", kind: "extintor",
      location: "Pañol", status: "operational",
    })
    await inMemoryDb.insert(schema.preventionInspectionTemplates).values({
      id: "tpl-chk", code: "inspeccion_contenedores", versionLabel: "01",
      name: "Contenedores", kind: "inspection", sourceDefinitionCode: "inspeccion_contenedores",
      definitionSnapshot: {}, contentHash: "a".repeat(64), status: "approved",
      authorUserId: "u-cont", approvedByUserId: "u-cont", approvedAt: now,
      createdAt: now, updatedAt: now,
    })
  })

  it("rechaza un run con contenedor y recurso a la vez", async () => {
    await expectCheckViolation(inMemoryDb.insert(schema.preventionInspectionRuns).values({
      id: "run-doble", code: "INSP-DOBLE", templateId: "tpl-chk", worksiteId: "w-cont",
      subjectContainerId: "cont-1", subjectResourceId: "res-1",
      status: "planned", createdByUserId: "u-cont",
    }))
  })

  it("admite un run con sólo el contenedor", async () => {
    const [run] = await inMemoryDb.insert(schema.preventionInspectionRuns).values({
      id: "run-simple", code: "INSP-SIMPLE", templateId: "tpl-chk", worksiteId: "w-cont",
      subjectContainerId: "cont-1", subjectLabel: "CT-CHK-1 · Acopio",
      status: "planned", createdByUserId: "u-cont",
    }).returning()
    expect(run?.subjectContainerId).toBe("cont-1")
  })

})
