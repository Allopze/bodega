/**
 * `product_attributes.size_family` es lo que permite cruzar una variante con
 * `size_catalog` y con la talla habitual del padrón (`workers.size_*`). El
 * importador nunca lo escribía, así que todo el catálogo importado lo tenía en
 * NULL: `workerSizeFieldFor` sabía mapear `Talla guantes → sizeGloves`, pero
 * ninguna variante importada llevaba ese nombre ni esa familia.
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

async function stageAndConfirm(source: Record<string, string>) {
  const batchId = nanoid()
  await inMemoryDb.insert(schema.eppImportBatches).values({
    id: batchId, fileName: "tallas.xlsx", fileHash: nanoid(), status: "review",
    sourceFileData: "", createdBy: userId,
  })
  const normalized = normalizeEppRow(source)
  await inMemoryDb.insert(schema.eppImportRows).values({
    id: nanoid(), batchId, rowNumber: 1, sourceCode: normalized.sourceCode,
    originalJson: JSON.stringify(source), normalizedJson: JSON.stringify(normalized),
    identityKey: normalized.identityKey, severity: "info", decision: "create",
  })
  await confirmEppImportBatch(batchId, userId)
  return normalized
}

beforeAll(async () => {
  await inMemoryDb.insert(schema.users).values({ id: userId, name: "Admin", email: `admin-${nanoid()}@example.com`, hashedPassword: "x", isActive: true })
  await inMemoryDb.insert(schema.productCategories).values({
    id: "cat-epp", name: "Elementos de Protección Personal", slug: "epp",
    isEpp: true, requiresPrevencion: true,
  }).onConflictDoNothing()
})

describe("importación de EPP y familia de talla", () => {
  it("deja la variante de guante con su nombre de atributo y su familia", async () => {
    await stageAndConfirm({ name: "GUANTE NITRILO SHOWA", unitOfMeasure: "par", size: "T/L" })

    const product = await inMemoryDb.query.products.findFirst({
      where: eq(schema.products.name, "Guante Nitrilo Showa"),
      with: { productAttributes: true },
    })

    const size = product!.productAttributes.find((attribute) => attribute.name.startsWith("Talla"))
    expect(size).toBeDefined()
    expect(size!.name).toBe("Talla guantes")
    expect(size!.sizeFamily).toBe("guantes")
    expect(JSON.parse(size!.options!)).toEqual(["L"])
  })

  it("deja la variante de botín con la familia de calzado", async () => {
    await stageAndConfirm({ name: "BOTIN SEGURIDAD STEELPRO", unitOfMeasure: "par", size: "42.0" })

    const product = await inMemoryDb.query.products.findFirst({
      where: eq(schema.products.name, "Botin Seguridad Steelpro"),
      with: { productAttributes: true },
    })

    const size = product!.productAttributes.find((attribute) => attribute.name.startsWith("Talla"))
    expect(size!.name).toBe("Talla calzado")
    expect(size!.sizeFamily).toBe("calzado")
    expect(JSON.parse(size!.options!)).toEqual(["42"])
  })

  it("no le inventa familia a la talla de un ítem que no se sizea", async () => {
    await stageAndConfirm({ name: "LENTE ACTIVEX FX III", unitOfMeasure: "unidad", size: "M" })

    const product = await inMemoryDb.query.products.findFirst({
      where: eq(schema.products.name, "Lente Activex Fx Iii"),
      with: { productAttributes: true },
    })

    const size = product!.productAttributes.find((attribute) => attribute.name.startsWith("Talla"))
    expect(size!.name).toBe("Talla")
    expect(size!.sizeFamily).toBeNull()
  })
})
