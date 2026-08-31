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

const { updateEppFamilyAction } = await import("@/app/(app)/admin/epps/actions")
const { buildEppFamilyIdentityKey } = await import("@/lib/services/epp-import")

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
      id: familyId, brand: "3M", model: "H-700", certification: "NCh 461", lifespanMonths: "24",
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
      id: otherId, brand: "Ansell", model: "11-801",
    }))

    expect(result.ok).toBe(false)
    expect(result.fieldErrors?.brand?.[0]).toContain("Ya existe")
    // Y no dejó la familia a medio guardar.
    const [family] = await inMemoryDb.select().from(schema.eppProductFamilies)
      .where(eq(schema.eppProductFamilies.id, otherId))
    expect(family!.brand).toBe("Activex")
  })

  it("permite dejar la vida útil vacía (no vence) sin coaccionarla a 0", async () => {
    const familyId = await seedFamily("Lente de seguridad")

    const result = await updateEppFamilyAction({ ok: false }, form({
      id: familyId, brand: "", model: "", certification: "", lifespanMonths: "",
    }))

    expect(result.ok).toBe(true)
    const [family] = await inMemoryDb.select().from(schema.eppProductFamilies)
      .where(eq(schema.eppProductFamilies.id, familyId))
    expect(family!.lifespanMonths).toBeNull()
  })

  it("rechaza una vida útil fuera de rango", async () => {
    const familyId = await seedFamily("Arnés de altura")

    const result = await updateEppFamilyAction({ ok: false }, form({ id: familyId, lifespanMonths: "0" }))
    expect(result.ok).toBe(false)
    expect(result.fieldErrors?.lifespanMonths).toBeDefined()
  })
})
