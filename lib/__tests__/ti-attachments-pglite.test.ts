import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { and, eq } from "drizzle-orm"
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

import { createTiAttachment, listTiAttachments } from "@/lib/services/ti/attachments"
import { createAsset, softDeleteAsset } from "@/lib/services/ti/assets"
import { getAssetHistory } from "@/lib/services/ti/history"

describe("módulo TI — adjuntos de activos", () => {
  let typeId: string
  const actor = { userId: "user-ti-tecnico", userEmail: "tecnico@ti.cl" }

  beforeAll(async () => {
    await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))
    await seedTiBase(testDb)
    typeId = await seedAssetType(testDb)
  })

  afterAll(async () => pg.close())

  it("adjunta un documento y deja historial + auditoría", async () => {
    const assetId = await createAsset({ code: "TI-DOC-0001", assetTypeId: typeId, worksiteId: "ws-ti-norte" }, actor)

    const id = await createTiAttachment({
      entityType: "it_asset",
      entityId: assetId,
      fileName: "factura-0001.pdf",
      filePath: "storage/ti/factura-0001.pdf",
      fileSize: 20_480,
      mimeType: "application/pdf",
    }, actor)

    expect(id).toBeTruthy()

    const docs = await listTiAttachments("it_asset", assetId)
    expect(docs).toHaveLength(1)
    expect(docs[0]?.fileName).toBe("factura-0001.pdf")
    expect(docs[0]?.uploadedByName).toBe("Técnico TI")

    const history = await getAssetHistory(assetId)
    expect(history.some((h) => h.action === "document" && h.detail.includes("factura-0001.pdf"))).toBe(true)

    const [auditRow] = await testDb.select().from(schema.auditLog)
      .where(and(eq(schema.auditLog.entityType, "it_attachment"), eq(schema.auditLog.entityId, id)))
    expect(auditRow?.action).toBe("create")
  })

  it("rechaza subir a una faena fuera del alcance del actor", async () => {
    const assetId = await createAsset({ code: "TI-DOC-0002", assetTypeId: typeId, worksiteId: "ws-ti-norte" }, actor)

    await expect(createTiAttachment({
      entityType: "it_asset",
      entityId: assetId,
      fileName: "oc-0002.pdf",
      filePath: "storage/ti/oc-0002.pdf",
      fileSize: 1024,
      mimeType: "application/pdf",
    }, actor, ["ws-ti-sur"])).rejects.toThrow(/No tienes acceso a esta faena/)

    expect(await listTiAttachments("it_asset", assetId)).toHaveLength(0)
  })

  it("rechaza adjuntar a un activo eliminado lógicamente", async () => {
    // Es el caso concreto que se perdería si se hubiera reusado el resolver
    // de la ruta GET (esa rama no filtra `deletedAt`, correcto para leer
    // trazabilidad histórica pero no para autorizar una escritura nueva).
    const assetId = await createAsset({ code: "TI-DOC-0003", assetTypeId: typeId, worksiteId: "ws-ti-norte" }, actor)
    await softDeleteAsset(assetId, actor)

    await expect(createTiAttachment({
      entityType: "it_asset",
      entityId: assetId,
      fileName: "informe.pdf",
      filePath: "storage/ti/informe.pdf",
      fileSize: 1024,
      mimeType: "application/pdf",
    }, actor)).rejects.toThrow(/Activo no encontrado/)
  })

  it("rechaza un entityType que no está en la lista blanca", async () => {
    const assetId = await createAsset({ code: "TI-DOC-0004", assetTypeId: typeId, worksiteId: "ws-ti-norte" }, actor)

    await expect(createTiAttachment({
      // @ts-expect-error — entityType fuera de TiUploadableEntityType a propósito
      entityType: "it_ticket",
      entityId: assetId,
      fileName: "captura.png",
      filePath: "storage/ti/captura.png",
      fileSize: 1024,
      mimeType: "image/png",
    }, actor)).rejects.toThrow(/no admite adjuntos/)
  })
})
