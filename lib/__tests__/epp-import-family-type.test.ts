/**
 * `epp_product_families.epp_type_id` (FK a `epp_types`, migración 0091) nunca
 * lo escribía nadie: el import XLSX sólo llenaba el texto deprecado
 * `epp_type` con su propio vocabulario de ítem ("casco", "guante"...), no el
 * vocabulario de zona corporal que `computeEppCoverageGaps` usa para contar
 * entregas como cobertura (INNER JOIN sobre `epp_type_id`). Prueba que
 * `confirmEppImportBatch` clasifica la familia al crearla, y que una familia
 * ya clasificada por otra vía no se reclasifica en silencio.
 */
import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { eq } from "drizzle-orm"
import { beforeAll, describe, expect, it, vi } from "vitest"
import * as schema from "@/db/schema"
import { migratePGlite } from "@/lib/testing/pglite-migrate"
import { nanoid } from "@/lib/id"

const pg = new PGlite()
const inMemoryDb = drizzle(pg, { schema })
const testGlobal = globalThis as typeof globalThis & { __db?: typeof inMemoryDb }
// @ts-expect-error — PGlite es estructuralmente compatible en runtime.
testGlobal.__db = inMemoryDb

vi.mock("@/db", () => ({
  get db() {
    return testGlobal.__db
  },
}))

await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))

const { normalizeEppRow, confirmEppImportBatch } = await import("@/lib/services/epp-import")

const userId = nanoid()

async function stageBatch(rows: ReturnType<typeof normalizeEppRow>[]) {
  const batchId = nanoid()
  await inMemoryDb.insert(schema.eppImportBatches).values({
    id: batchId, fileName: "test.xlsx", fileHash: nanoid(), status: "review",
    sourceFileData: "", createdBy: userId,
  })
  for (const [i, normalized] of rows.entries()) {
    await inMemoryDb.insert(schema.eppImportRows).values({
      id: nanoid(), batchId, rowNumber: i + 1,
      originalJson: "{}", normalizedJson: JSON.stringify(normalized),
      decision: "create",
    })
  }
  return batchId
}

beforeAll(async () => {
  await inMemoryDb.insert(schema.users).values({ id: userId, name: "Admin", email: `admin-${nanoid()}@example.com`, hashedPassword: "x", isActive: true })
})

describe("EPP import classifies families by body-part type", () => {
  it("maps the item-level type ('casco') to the body-part epp_types code ('cabeza') on a new family", async () => {
    const normalized = normalizeEppRow({ name: "Casco de seguridad blanco clase A", unitOfMeasure: "unidad" })
    expect(normalized.eppType).toBe("casco")

    const batchId = await stageBatch([normalized])
    await confirmEppImportBatch(batchId, userId)

    const family = await inMemoryDb.query.eppProductFamilies.findFirst({ where: eq(schema.eppProductFamilies.identityKey, normalized.familyIdentityKey) })
    const cabeza = await inMemoryDb.query.eppTypes.findFirst({ where: eq(schema.eppTypes.code, "cabeza") })
    expect(family?.eppTypeId).toBe(cabeza!.id)
  })

  it("does not overwrite a family's type once it's already classified", async () => {
    const first = normalizeEppRow({ name: "Guante de nitrilo talla M", unitOfMeasure: "par" })
    const batch1 = await stageBatch([first])
    await confirmEppImportBatch(batch1, userId)

    const family = await inMemoryDb.query.eppProductFamilies.findFirst({ where: eq(schema.eppProductFamilies.identityKey, first.familyIdentityKey) })
    const manos = await inMemoryDb.query.eppTypes.findFirst({ where: eq(schema.eppTypes.code, "manos") })
    expect(family?.eppTypeId).toBe(manos!.id)

    // Manually reclassify — a second import row for the same family should
    // leave that manual correction alone rather than silently overwrite it.
    const auditiva = await inMemoryDb.query.eppTypes.findFirst({ where: eq(schema.eppTypes.code, "auditiva") })
    await inMemoryDb.update(schema.eppProductFamilies).set({ eppTypeId: auditiva!.id }).where(eq(schema.eppProductFamilies.id, family!.id))

    const second = normalizeEppRow({ name: "Guante de nitrilo talla L", unitOfMeasure: "par" })
    const batch2 = await stageBatch([second])
    await confirmEppImportBatch(batch2, userId)

    const reloaded = await inMemoryDb.query.eppProductFamilies.findFirst({ where: eq(schema.eppProductFamilies.id, family!.id) })
    expect(reloaded?.eppTypeId).toBe(auditiva!.id)
  })

  it("leaves the family unclassified when the item type has no body-part mapping ('otros')", async () => {
    const normalized = normalizeEppRow({ name: "Elemento de protección otros modelo X", unitOfMeasure: "unidad" })
    expect(normalized.eppType).toBe("otros")

    const batchId = await stageBatch([normalized])
    await confirmEppImportBatch(batchId, userId)

    const family = await inMemoryDb.query.eppProductFamilies.findFirst({ where: eq(schema.eppProductFamilies.identityKey, normalized.familyIdentityKey) })
    expect(family?.eppTypeId).toBeNull()
  })
})
