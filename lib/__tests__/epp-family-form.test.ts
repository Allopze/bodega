/**
 * La ficha de familia EPP (marca/modelo/certificación/vida útil) no tenía UI en
 * ninguna parte. Dos cosas que verificar:
 *
 *  - `identityKey` es UNIQUE y derivado de categoría+nombre+marca+modelo, y el
 *    import deduplica familias con él: guardar marca/modelo sin recalcularlo
 *    desincroniza el dedup y la próxima importación crea una familia duplicada.
 *  - `lifespanMonths` es lo que enciende el gap "expired"; mientras fue null en
 *    todas las familias, ningún EPP vencía nunca.
 */
import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { eq } from "drizzle-orm"
import { beforeAll, describe, expect, it, vi } from "vitest"
import type { Session } from "next-auth"
import * as schema from "@/db/schema"
import { migratePGlite } from "@/lib/testing/pglite-migrate"
import { nanoid } from "@/lib/id"

const pg = new PGlite()
const inMemoryDb = drizzle(pg, { schema })
const testGlobal = globalThis as typeof globalThis & { __db?: typeof inMemoryDb }
// @ts-expect-error — PGlite es estructuralmente compatible en runtime.
testGlobal.__db = inMemoryDb

const mockAuthFn = vi.hoisted(() => vi.fn())

vi.mock("@/db", () => ({ get db() { return testGlobal.__db } }))
vi.mock("@/lib/auth/auth", () => ({ auth: mockAuthFn }))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }))
vi.mock("@/lib/services/module-toggles", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/services/module-toggles")>()),
  assertPermissionModuleEnabled: vi.fn(async () => {}),
  assertRouteModuleEnabled: vi.fn(async () => {}),
}))

await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))

const { updateEppFamilyAction, mergeEppFamiliesAction, setEppFamilyTypeAction } = await import("@/app/(app)/admin/epps/actions")
const { buildEppFamilyIdentityKey } = await import("@/lib/services/epp-import")
const { resolveManualEppFamily } = await import("@/app/(app)/admin/productos/actions/helpers")

const userId = nanoid()
const categoryId = nanoid()
const CATEGORY_NAME = "Elementos de Protección Personal"

function form(fields: Record<string, string>) {
  const fd = new FormData()
  for (const [k, v] of Object.entries(fields)) fd.set(k, v)
  return fd
}

async function seedFamily(canonicalName: string, brand: string | null = null, model: string | null = null) {
  const id = nanoid()
  await inMemoryDb.insert(schema.eppProductFamilies).values({
    id, categoryId, canonicalName,
    identityKey: buildEppFamilyIdentityKey({ categoryName: CATEGORY_NAME, canonicalName, brand, model }),
    brand, model,
  })
  return id
}

beforeAll(async () => {
  mockAuthFn.mockResolvedValue({
    user: {
      id: userId, name: "Admin", email: "admin@chome.cl",
      permissions: ["admin:products"], roles: ["administrador"],
      worksiteIds: [], isGlobal: true, isActive: true,
    },
    expires: new Date(Date.now() + 86_400_000).toISOString(),
  } as unknown as Session)
  await inMemoryDb.insert(schema.users).values({
    id: userId, name: "Admin", email: `admin-${nanoid()}@example.com`, hashedPassword: "x", isActive: true,
  })
  await inMemoryDb.insert(schema.productCategories).values({
    id: categoryId, name: CATEGORY_NAME, slug: `epp-${nanoid(4).toLowerCase()}`,
  })
})

describe("updateEppFamilyAction", () => {
  it("guarda la ficha y recalcula identityKey al cambiar marca y modelo", async () => {
    const familyId = await seedFamily("Casco de seguridad")

    const result = await updateEppFamilyAction({ ok: false }, form({
      id: familyId, canonicalName: "Casco de seguridad", categoryId,
      brand: "3M", model: "H-700", certification: "NCh 461", lifespanMonths: "24",
    }))

    expect(result.ok).toBe(true)
    const [family] = await inMemoryDb.select().from(schema.eppProductFamilies)
      .where(eq(schema.eppProductFamilies.id, familyId))

    expect(family).toMatchObject({ brand: "3M", model: "H-700", certification: "NCh 461", lifespanMonths: 24 })
    // La clave tiene que quedar consistente con lo guardado, o el próximo
    // import no reconocería la familia y crearía una duplicada.
    expect(family!.identityKey).toBe(buildEppFamilyIdentityKey({
      categoryName: CATEGORY_NAME, canonicalName: "Casco de seguridad", brand: "3M", model: "H-700",
    }))
  })

  it("rechaza con un error de campo cuando la nueva identidad choca con otra familia", async () => {
    await seedFamily("Guante nitrilo", "Ansell", "11-801")
    const otherId = await seedFamily("Guante nitrilo", "Activex", "HD")

    const result = await updateEppFamilyAction({ ok: false }, form({
      id: otherId, canonicalName: "Guante nitrilo", categoryId, brand: "Ansell", model: "11-801",
    }))

    expect(result.ok).toBe(false)
    expect(result.fieldErrors?.canonicalName?.[0]).toContain("Ya existe")
    // Y no dejó la familia a medio guardar.
    const [family] = await inMemoryDb.select().from(schema.eppProductFamilies)
      .where(eq(schema.eppProductFamilies.id, otherId))
    expect(family!.brand).toBe("Activex")
  })

  it("permite dejar la vida útil vacía (no vence) sin coaccionarla a 0", async () => {
    const familyId = await seedFamily("Lente de seguridad")

    const result = await updateEppFamilyAction({ ok: false }, form({
      id: familyId, canonicalName: "Lente de seguridad", categoryId,
      brand: "", model: "", certification: "", lifespanMonths: "",
    }))

    expect(result.ok).toBe(true)
    const [family] = await inMemoryDb.select().from(schema.eppProductFamilies)
      .where(eq(schema.eppProductFamilies.id, familyId))
    expect(family!.lifespanMonths).toBeNull()
  })

  it("rechaza una vida útil fuera de rango", async () => {
    const familyId = await seedFamily("Arnés de altura")

    const result = await updateEppFamilyAction({ ok: false }, form({
      id: familyId, canonicalName: "Arnés de altura", categoryId, lifespanMonths: "0",
    }))
    expect(result.ok).toBe(false)
    expect(result.fieldErrors?.lifespanMonths).toBeDefined()
  })
})

describe("mergeEppFamiliesAction", () => {
  async function seedProduct(familyId: string | null, name: string) {
    const id = nanoid()
    await inMemoryDb.insert(schema.products).values({
      id, sku: `SKU-${nanoid(6)}`, name, categoryId, familyId, isEpp: true,
    })
    return id
  }

  it("moves the source's products to the target and deletes the source", async () => {
    const target = await seedFamily("Casco Activex")
    const source = await seedFamily("Casco Activex duplicado")
    const moved = await seedProduct(source, "Casco Activex I")

    const result = await mergeEppFamiliesAction(source, target)
    expect(result.ok).toBe(true)

    const product = await inMemoryDb.query.products.findFirst({ where: eq(schema.products.id, moved) })
    expect(product?.familyId).toBe(target)
    const gone = await inMemoryDb.query.eppProductFamilies.findFirst({ where: eq(schema.eppProductFamilies.id, source) })
    expect(gone).toBeUndefined()
  })

  it("fills only the target's empty ficha fields, never overwriting what it has", async () => {
    const target = await seedFamily("Botin V-Flex", "Norseg", null)
    const source = await seedFamily("Botin V-Flex dup", "OtraMarca", "V73")
    await inMemoryDb.update(schema.eppProductFamilies)
      .set({ certification: "NCh 772", lifespanMonths: 12 })
      .where(eq(schema.eppProductFamilies.id, source))

    expect((await mergeEppFamiliesAction(source, target)).ok).toBe(true)

    const merged = await inMemoryDb.query.eppProductFamilies.findFirst({ where: eq(schema.eppProductFamilies.id, target) })
    expect(merged?.brand).toBe("Norseg")        // el target ya tenía marca: se respeta
    expect(merged?.model).toBe("V73")           // estaba vacío: se hereda
    expect(merged?.certification).toBe("NCh 772")
    expect(merged?.lifespanMonths).toBe(12)
  })

  it("repoints a requirement's preferred family instead of letting the FK null it", async () => {
    const target = await seedFamily("Arnes Activex")
    const source = await seedFamily("Arnes Activex dup")
    const eppTypeId = nanoid()
    await inMemoryDb.insert(schema.eppTypes).values({ id: eppTypeId, code: `caidas-${nanoid(4)}`, label: "Caídas" })
    const requirementId = nanoid()
    await inMemoryDb.insert(schema.preventionEppRequirements).values({
      id: requirementId, eppTypeId, scopeType: "global",
      reason: "Trabajo en altura sobre 1,8 m", preferredFamilyId: source, createdByUserId: userId,
    })

    expect((await mergeEppFamiliesAction(source, target)).ok).toBe(true)

    const requirement = await inMemoryDb.query.preventionEppRequirements.findFirst({
      where: eq(schema.preventionEppRequirements.id, requirementId),
    })
    expect(requirement?.preferredFamilyId).toBe(target)
  })

  it("refuses to merge a family into itself", async () => {
    const family = await seedFamily("Guante Activex")
    const result = await mergeEppFamiliesAction(family, family)
    expect(result.ok).toBe(false)
    expect(result.message).toMatch(/misma familia/i)
  })

  it("refuses when either family does not exist", async () => {
    const family = await seedFamily("Lente Activex")
    expect((await mergeEppFamiliesAction(family, nanoid())).ok).toBe(false)
    expect((await mergeEppFamiliesAction(nanoid(), family)).ok).toBe(false)
  })
})

describe("setEppFamilyTypeAction", () => {
  it("rejects an epp type that does not exist instead of leaking the FK error", async () => {
    const family = await seedFamily("Casco para validar tipo")
    const result = await setEppFamilyTypeAction(family, nanoid())
    expect(result.ok).toBe(false)
    expect(result.message).toMatch(/tipo de epp/i)
  })

  it("classifies the family when the type exists", async () => {
    const family = await seedFamily("Casco para clasificar")
    const eppTypeId = nanoid()
    await inMemoryDb.insert(schema.eppTypes).values({ id: eppTypeId, code: `cabeza-${nanoid(4)}`, label: "Cabeza" })

    expect((await setEppFamilyTypeAction(family, eppTypeId)).ok).toBe(true)
    const updated = await inMemoryDb.query.eppProductFamilies.findFirst({ where: eq(schema.eppProductFamilies.id, family) })
    expect(updated?.eppTypeId).toBe(eppTypeId)
  })
})

describe("updateEppFamilyAction — nombre y categoría", () => {
  it("renombra la familia y recalcula identityKey con el nombre nuevo", async () => {
    const familyId = await seedFamily("Nombre heredado del backfill")

    const result = await updateEppFamilyAction({ ok: false }, form({
      id: familyId, canonicalName: "Traje PU Verde Activex", categoryId,
    }))
    expect(result.ok).toBe(true)

    const family = await inMemoryDb.query.eppProductFamilies.findFirst({
      where: eq(schema.eppProductFamilies.id, familyId),
    })
    expect(family?.canonicalName).toBe("Traje PU Verde Activex")
    expect(family?.identityKey).toBe(buildEppFamilyIdentityKey({
      categoryName: CATEGORY_NAME, canonicalName: "Traje PU Verde Activex", brand: null, model: null,
    }))
  })

  it("rejects a category that does not exist rather than keying on a blank name", async () => {
    const familyId = await seedFamily("Familia con categoría inválida")
    const result = await updateEppFamilyAction({ ok: false }, form({
      id: familyId, canonicalName: "Familia con categoría inválida", categoryId: nanoid(),
    }))
    expect(result.ok).toBe(false)
    expect(result.fieldErrors?.categoryId?.[0]).toMatch(/no existe/i)
  })

  it("records the deliberate never-expires decision, distinct from an unset lifespan", async () => {
    const familyId = await seedFamily("Casco sin fecha fija")

    expect((await updateEppFamilyAction({ ok: false }, form({
      id: familyId, canonicalName: "Casco sin fecha fija", categoryId,
      lifespanNotApplicable: "true",
    }))).ok).toBe(true)

    const family = await inMemoryDb.query.eppProductFamilies.findFirst({
      where: eq(schema.eppProductFamilies.id, familyId),
    })
    expect(family?.lifespanMonths).toBeNull()
    expect(family?.lifespanNotApplicable).toBe(true)
  })

  it("refuses declaring never-expires together with a lifespan", async () => {
    const familyId = await seedFamily("Familia contradictoria")
    const result = await updateEppFamilyAction({ ok: false }, form({
      id: familyId, canonicalName: "Familia contradictoria", categoryId,
      lifespanMonths: "12", lifespanNotApplicable: "true",
    }))
    expect(result.ok).toBe(false)
    expect(result.fieldErrors?.lifespanNotApplicable).toBeDefined()
  })
})

/**
 * H-2: sólo el import XLSX clasificaba la familia. `ensureEppFamilyTx` —la vía
 * del formulario manual y del asistente de EPP— insertaba con `eppTypeId` nulo
 * sin intentar inferirlo, así que todo lo creado a mano nacía invisible para
 * `computeEppCoverageGaps`.
 */
describe("resolveManualEppFamily", () => {
  it("classifies the family from the product name on manual creation", async () => {
    // Los 9 tipos (zonas corporales) ya vienen sembrados por migración.
    const seeded = await inMemoryDb.query.eppTypes.findFirst({ where: eq(schema.eppTypes.code, "cabeza") })
    expect(seeded, "el catálogo de tipos debe estar sembrado").toBeDefined()

    const family = await inMemoryDb.transaction((tx) =>
      // @ts-expect-error — PGlite es estructuralmente compatible en runtime.
      resolveManualEppFamily(tx, { categoryId, name: "Casco Activex I", isEpp: true }))

    const stored = await inMemoryDb.query.eppProductFamilies.findFirst({
      where: eq(schema.eppProductFamilies.id, family!.id),
    })
    expect(stored?.eppTypeId).toBe(seeded!.id)
  })

  it("leaves the type null when the name declares no mappable item", async () => {
    const family = await inMemoryDb.transaction((tx) =>
      // @ts-expect-error — PGlite es estructuralmente compatible en runtime.
      resolveManualEppFamily(tx, { categoryId, name: "BORDADO ESPALDA", isEpp: true }))

    const stored = await inMemoryDb.query.eppProductFamilies.findFirst({
      where: eq(schema.eppProductFamilies.id, family!.id),
    })
    expect(stored?.eppTypeId).toBeNull()
  })

  it("backfills the type of a family that was left unclassified", async () => {
    const unclassified = await seedFamily("Guante Activex Nitrilo")
    const manos = await inMemoryDb.query.eppTypes.findFirst({ where: eq(schema.eppTypes.code, "manos") })

    await inMemoryDb.transaction((tx) =>
      // @ts-expect-error — PGlite es estructuralmente compatible en runtime.
      resolveManualEppFamily(tx, { categoryId, name: "Guante Activex Nitrilo", isEpp: true }))

    const stored = await inMemoryDb.query.eppProductFamilies.findFirst({
      where: eq(schema.eppProductFamilies.id, unclassified),
    })
    expect(stored?.eppTypeId).toBe(manos!.id)
  })
})
