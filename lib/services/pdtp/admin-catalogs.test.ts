import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest"
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
  await inMemoryDb.delete(schema.pdtpResponsibleCatalog)
})

afterEach(() => {})

describe("upsertPdtpResponsible", () => {
  it("rechaza un tipo fuera de los 4 valores conocidos en un responsable nuevo", async () => {
    const { upsertPdtpResponsible } = await import("./admin-catalogs")
    await expect(upsertPdtpResponsible({
      slug: "resp-invalid-kind",
      displayName: "Responsable con tipo inválido",
      kind: "inventado",
    })).rejects.toThrow(/Tipo de responsable inválido/)
  })

  it("acepta cada uno de los 4 tipos válidos", async () => {
    const { upsertPdtpResponsible } = await import("./admin-catalogs")
    for (const kind of ["rol_rbac", "grupo", "persona", "otro"]) {
      const row = await upsertPdtpResponsible({
        slug: `resp-${kind}`,
        displayName: `Responsable ${kind}`,
        kind,
      })
      expect(row?.kind).toBe(kind)
    }
  })

  it("rechaza un rol que no existe en el registry de módulos", async () => {
    const { upsertPdtpResponsible } = await import("./admin-catalogs")
    await expect(upsertPdtpResponsible({
      slug: "resp-bad-role",
      displayName: "Responsable con rol inventado",
      kind: "rol_rbac",
      roleName: "no_existe_este_rol_xyz",
    })).rejects.toThrow(/no es un rol del sistema conocido/)
  })

  it("acepta un rol real del registry", async () => {
    const { upsertPdtpResponsible } = await import("./admin-catalogs")
    const row = await upsertPdtpResponsible({
      slug: "resp-good-role",
      displayName: "Responsable con rol real",
      kind: "rol_rbac",
      roleName: "administrador",
    })
    expect(row?.roleName).toBe("administrador")
  })

  it("conserva un tipo y un rol heredados al reguardar sin tocarlos", async () => {
    const { upsertPdtpResponsible } = await import("./admin-catalogs")
    // Simula un responsable creado antes de que existiera la validación —
    // kind y roleName fuera de convención — insertado directo, sin pasar por
    // el servicio (que ya los habría rechazado).
    await inMemoryDb.insert(schema.pdtpResponsibleCatalog).values({
      slug: "resp_legacy",
      displayName: "Responsable heredado",
      kind: "role",
      roleName: "rol_retirado_hace_tiempo",
    })

    const row = await upsertPdtpResponsible({
      slug: "resp_legacy",
      displayName: "Responsable heredado (editado)",
      kind: "role",
      roleName: "rol_retirado_hace_tiempo",
    })
    expect(row?.kind).toBe("role")
    expect(row?.roleName).toBe("rol_retirado_hace_tiempo")
    expect(row?.displayName).toBe("Responsable heredado (editado)")
  })
})
