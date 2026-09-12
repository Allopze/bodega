import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { eq } from "drizzle-orm"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import path from "node:path"
import * as schema from "@/db/schema"
import type { DB } from "@/db"
import { migratePGlite } from "@/lib/testing/pglite-migrate"
import { seedTiBase, seedAssetType } from "./helpers/ti-seeds"

const pg = new PGlite()
const testDb = drizzle(pg, { schema }) as unknown as DB
const testGlobal = globalThis as typeof globalThis & { __db?: DB }
testGlobal.__db = testDb

vi.mock("@/db", () => ({
  get db() { return testGlobal.__db },
  get Tx() { return undefined },
}))

import { upsertAssetType, listAssetTypes, setAssetTypeActive } from "@/lib/services/ti/asset-types"
import { createAsset } from "@/lib/services/ti/assets"

function auditRowsFor(entityId: string) {
  return testDb.select().from(schema.auditLog).where(eq(schema.auditLog.entityId, entityId))
}

describe("módulo TI — catálogo de tipos de activo", () => {
  const actor = { userId: "user-ti-tecnico", userEmail: "tecnico@ti.cl" }
  let worksiteId: string

  beforeAll(async () => {
    await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))
    const seeds = await seedTiBase(testDb)
    worksiteId = seeds.worksiteId
  })

  afterAll(async () => pg.close())

  it("crea un tipo de activo y audita la creación", async () => {
    const id = await upsertAssetType(
      { name: "Notebook", category: "computacion", hasSpecs: true },
      actor,
    )

    const [row] = await testDb.select().from(schema.itAssetTypes).where(eq(schema.itAssetTypes.id, id))
    expect(row!.name).toBe("Notebook")
    expect(row!.category).toBe("computacion")
    expect(row!.hasSpecs).toBe(true)
    expect(row!.isActive).toBe(true)

    const [audit] = await auditRowsFor(id)
    expect(audit!.action).toBe("create")
    expect(audit!.entityType).toBe("it_asset_type")
    expect(JSON.parse(audit!.newState as string)).toMatchObject({ name: "Notebook", category: "computacion" })
  })

  it("edita un tipo existente y audita el antes/después", async () => {
    const id = await seedAssetType(testDb, { id: "type-ti-edit", name: "Mouse", category: "periferico", hasSpecs: false })

    await upsertAssetType(
      { id, name: "Mouse inalámbrico", category: "periferico", hasSpecs: false },
      actor,
    )

    const [row] = await testDb.select().from(schema.itAssetTypes).where(eq(schema.itAssetTypes.id, id))
    expect(row!.name).toBe("Mouse inalámbrico")

    const audits = await auditRowsFor(id)
    const update = audits.find((a) => a.action === "update")
    expect(update).toBeDefined()
    expect(JSON.parse(update!.oldState as string)).toMatchObject({ name: "Mouse" })
    expect(JSON.parse(update!.newState as string)).toMatchObject({ name: "Mouse inalámbrico" })
  })

  it("rechaza editar un tipo inexistente", async () => {
    await expect(upsertAssetType(
      { id: "no-existe", name: "X", category: "otro", hasSpecs: false },
      actor,
    )).rejects.toThrow(/Tipo de activo no encontrado/)
  })

  it("rechaza crear un tipo con un nombre ya usado", async () => {
    await seedAssetType(testDb, { id: "type-ti-dup-base", name: "Impresora láser", category: "periferico" })
    await expect(upsertAssetType(
      { name: "Impresora láser", category: "periferico", hasSpecs: false },
      actor,
    )).rejects.toThrow(/Ya existe un tipo de activo con ese nombre/)
  })

  it("rechaza renombrar un tipo al nombre de otro, pero permite conservar el propio", async () => {
    const idA = await seedAssetType(testDb, { id: "type-ti-dup-a", name: "Monitor", category: "computacion" })
    const idB = await seedAssetType(testDb, { id: "type-ti-dup-b", name: "Teclado", category: "periferico" })

    await expect(upsertAssetType(
      { id: idB, name: "Monitor", category: "periferico", hasSpecs: false },
      actor,
    )).rejects.toThrow(/Ya existe un tipo de activo con ese nombre/)

    // Reenviar el propio nombre al editar otros campos no debe chocar consigo mismo.
    await upsertAssetType({ id: idA, name: "Monitor", category: "computacion", hasSpecs: true }, actor)
    const [row] = await testDb.select().from(schema.itAssetTypes).where(eq(schema.itAssetTypes.id, idA))
    expect(row!.hasSpecs).toBe(true)
  })

  it("listAssetTypes excluye inactivos salvo que se pidan, y ordena por nombre", async () => {
    await seedAssetType(testDb, { id: "type-ti-zzz", name: "Zebra", category: "otro" })
    await seedAssetType(testDb, { id: "type-ti-aaa", name: "Access point", category: "red" })
    await seedAssetType(testDb, { id: "type-ti-inactivo-list", name: "Impresora vieja", category: "periferico", isActive: false })

    const active = await listAssetTypes()
    expect(active.some((t) => t.id === "type-ti-inactivo-list")).toBe(false)

    const all = await listAssetTypes({ includeInactive: true })
    expect(all.some((t) => t.id === "type-ti-inactivo-list")).toBe(true)

    const names = active.map((t) => t.name)
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)))
  })

  it("setAssetTypeActive cambia solo isActive y audita el cambio", async () => {
    const id = await seedAssetType(testDb, { id: "type-ti-toggle", name: "Router", category: "red" })

    const result = await setAssetTypeActive(id, false, actor)
    expect(result).toEqual({ id, name: "Router", isActive: false })

    const [row] = await testDb.select().from(schema.itAssetTypes).where(eq(schema.itAssetTypes.id, id))
    expect(row!.isActive).toBe(false)
    expect(row!.name).toBe("Router") // no se toca ningún otro campo

    const audits = await auditRowsFor(id)
    const toggle = audits.find((a) => JSON.parse(a.newState as string)?.isActive === false)
    expect(toggle).toBeDefined()
    expect(JSON.parse(toggle!.oldState as string)).toEqual({ isActive: true })
  })

  it("rechaza desactivar un tipo inexistente", async () => {
    await expect(setAssetTypeActive("no-existe", false, actor)).rejects.toThrow(/Tipo de activo no encontrado/)
  })

  it("desactivar un tipo en uso no modifica los activos que ya lo tienen", async () => {
    const id = await seedAssetType(testDb, { id: "type-ti-en-uso", name: "Switch", category: "red" })
    const assetId = await createAsset({
      code: "TI-SW-0001",
      assetTypeId: id,
      worksiteId,
    }, actor)

    await setAssetTypeActive(id, false, actor)

    const [asset] = await testDb.select().from(schema.itAssets).where(eq(schema.itAssets.id, assetId))
    expect(asset!.assetTypeId).toBe(id)
    expect(asset!.status).toBe("disponible")
  })
})
