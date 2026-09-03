import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { eq } from "drizzle-orm"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import path from "node:path"
import * as schema from "@/db/schema"
import type { DB } from "@/db"
import { migratePGlite } from "@/lib/testing/pglite-migrate"
import { seedTiBase, seedAssetType, plainDateIn } from "./helpers/ti-seeds"

const pg = new PGlite()
const testDb = drizzle(pg, { schema }) as unknown as DB
const testGlobal = globalThis as typeof globalThis & { __db?: DB }
testGlobal.__db = testDb

vi.mock("@/db", () => ({
  get db() { return testGlobal.__db },
  get Tx() { return undefined },
}))

import { createMaintenance, updateMaintenance, listMaintenances, maintenanceCostByAsset } from "@/lib/services/ti/maintenance"
import { retireAsset, retirementTargetStatus, listRetirements } from "@/lib/services/ti/retirements"
import { createSupplierLink, deleteSupplierLink, listSupplierLinks, listAssetsByWarranty } from "@/lib/services/ti/supplier-links"
import { createAsset } from "@/lib/services/ti/assets"

describe("módulo TI — mantenciones, bajas, proveedores y garantías", () => {
  let typeId: string
  const actor = { userId: "user-ti-tecnico", userEmail: "tecnico@ti.cl" }

  async function makeAsset(code: string, worksiteId = "ws-ti-norte") {
    return createAsset({ code, assetTypeId: typeId, worksiteId, cost: 500_000 }, actor)
  }

  beforeAll(async () => {
    await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))
    await seedTiBase(testDb)
    typeId = await seedAssetType(testDb)
  })

  afterAll(async () => pg.close())

  describe("mantenciones", () => {
    it("registra una mantención y la acumula en el costo por activo", async () => {
      const assetId = await makeAsset("TI-M-0001")

      await createMaintenance({
        assetId,
        type: "reparacion",
        date: "2026-08-01",
        reportedIssue: "Pantalla rota",
        diagnosis: "LCD dañado",
        workDone: "Cambio de pantalla",
        supplierId: "sup-ti-repuestos",
        cost: 150_000,
      }, actor)

      const rows = await listMaintenances({ assetId })
      expect(rows).toHaveLength(1)
      expect(rows[0]?.assetCode).toBe("TI-M-0001")
      expect(rows[0]?.supplierName).toBe("Repuestos TI Ltda.")

      const ranking = await maintenanceCostByAsset()
      const row = ranking.find((r) => r.assetId === assetId)
      expect(row?.totalCost).toBe(150_000)
      expect(row?.count).toBe(1)
    })

    it("actualiza el costo de una mantención", async () => {
      const assetId = await makeAsset("TI-M-0002")
      const id = await createMaintenance({
        assetId, type: "preventiva", date: "2026-07-01", workDone: "Limpieza", cost: 10_000,
      }, actor)

      await updateMaintenance({
        id, assetId, type: "preventiva", date: "2026-07-01", workDone: "Limpieza y pasta térmica", cost: 25_000,
      }, actor)

      const rows = await listMaintenances({ assetId })
      expect(rows.find((r) => r.id === id)?.cost).toBe(25_000)
    })

    it("rechaza la mantención de un activo de otra faena cuando hay scope", async () => {
      const assetId = await makeAsset("TI-M-0003", "ws-ti-sur")
      await expect(createMaintenance({
        assetId, type: "revision", date: "2026-07-01", workDone: "Revisión",
      }, actor, ["ws-ti-norte"])).rejects.toThrow(/No tienes acceso a esta faena/)
    })

    it("mantiene el scope al editar una mantención existente", async () => {
      const assetId = await makeAsset("TI-M-0004", "ws-ti-sur")
      const id = await createMaintenance({
        assetId, type: "revision", date: "2026-07-01", workDone: "Revisión inicial",
      }, actor)

      await expect(updateMaintenance({
        id, assetId, type: "revision", date: "2026-07-02", workDone: "Revisión actualizada",
      }, actor, ["ws-ti-norte"])).rejects.toThrow(/No tienes acceso a esta faena/)
    })
  })

  describe("bajas", () => {
    it("bloquea la baja con asignación abierta salvo pérdida/robo", async () => {
      const assetId = await makeAsset("TI-R-0001")
      await testDb.insert(schema.itAssetAssignments).values({
        id: "asg-retire-1",
        code: "ACT-2098-0001",
        assetId,
        workerId: "wk-ti-juan",
        worksiteId: "ws-ti-norte",
        kind: "delivery",
        deliveredAt: new Date().toISOString(),
        deliveredByUserId: actor.userId,
        physicalState: "bueno",
      })

      await expect(retireAsset({
        assetId, date: "2026-09-01", reason: "venta",
        responsibleUserId: actor.userId, authorizedByUserId: actor.userId,
      }, actor)).rejects.toThrow(/devuélvelo antes de dar de baja/)

      // Pérdida/robo no requieren devolución previa.
      await retireAsset({
        assetId, date: "2026-09-01", reason: "perdida",
        responsibleUserId: actor.userId, authorizedByUserId: actor.userId,
      }, actor)
      const asset = await testDb.select().from(schema.itAssets).where(eq(schema.itAssets.id, assetId))
      expect(asset[0]?.status).toBe("perdido")
    })

    it("da de baja un activo sin custodio y deja la auditoría en el historial", async () => {
      const assetId = await makeAsset("TI-R-0002")
      const retirementId = await retireAsset({
        assetId, date: "2026-09-01", reason: "reciclaje",
        responsibleUserId: actor.userId, authorizedByUserId: actor.userId,
        destination: "Recicladora Norte",
      }, actor)

      const asset = await testDb.select().from(schema.itAssets).where(eq(schema.itAssets.id, assetId))
      expect(asset[0]?.status).toBe("dado_de_baja")
      expect(asset[0]?.workerId).toBeNull()

      const retirements = await listRetirements({ assetId })
      const row = retirements.find((r) => r.id === retirementId)
      expect(row?.reason).toBe("reciclaje")
      expect(row?.destination).toBe("Recicladora Norte")
    })

    it("no permite dar de baja dos veces el mismo activo", async () => {
      const assetId = await makeAsset("TI-R-0003")
      await retireAsset({
        assetId, date: "2026-09-01", reason: "venta",
        responsibleUserId: actor.userId, authorizedByUserId: actor.userId,
      }, actor)

      await expect(retireAsset({
        assetId, date: "2026-09-02", reason: "donacion",
        responsibleUserId: actor.userId, authorizedByUserId: actor.userId,
      }, actor)).rejects.toThrow(/ya está en estado 'dado_de_baja'/)
    })

    it("mapea la razón de baja al estado objetivo", () => {
      expect(retirementTargetStatus("perdida")).toBe("perdido")
      expect(retirementTargetStatus("robo")).toBe("robado")
      expect(retirementTargetStatus("venta")).toBe("dado_de_baja")
    })
  })

  describe("proveedores TI y garantías", () => {
    it("vincula un proveedor con categoría y agrega conteos", async () => {
      await createSupplierLink({ supplierId: "sup-ti-repuestos", category: "reparacion" }, actor)
      const links = await listSupplierLinks()
      const link = links.find((l) => l.supplierId === "sup-ti-repuestos")
      expect(link?.supplierName).toBe("Repuestos TI Ltda.")
      expect(link?.category).toBe("reparacion")
    })

    it("impide duplicar el vínculo (proveedor, categoría)", async () => {
      await expect(createSupplierLink({ supplierId: "sup-ti-repuestos", category: "reparacion" }, actor))
        .rejects.toThrow()
    })

    it("elimina un vínculo", async () => {
      const id = await createSupplierLink({ supplierId: "sup-ti-repuestos", category: "licencias" }, actor)
      await deleteSupplierLink(id, actor)
      expect((await listSupplierLinks()).some((l) => l.id === id)).toBe(false)
    })

    it("filtra garantías por ventana de vencimiento", async () => {
      const porVencer = await makeAsset("TI-W-0001")
      const vencida = await makeAsset("TI-W-0002")
      const activa = await makeAsset("TI-W-0003")
      await testDb.update(schema.itAssets).set({ warrantyEndDate: plainDateIn(10) }).where(eq(schema.itAssets.id, porVencer))
      await testDb.update(schema.itAssets).set({ warrantyEndDate: plainDateIn(-5) }).where(eq(schema.itAssets.id, vencida))
      await testDb.update(schema.itAssets).set({ warrantyEndDate: plainDateIn(120) }).where(eq(schema.itAssets.id, activa))

      const en30 = await listAssetsByWarranty({ window: "expiring_30" })
      expect(en30.map((a) => a.id)).toContain(porVencer)
      expect(en30.map((a) => a.id)).not.toContain(vencida)
      expect(en30.map((a) => a.id)).not.toContain(activa)

      const vencidas = await listAssetsByWarranty({ window: "expired" })
      expect(vencidas.map((a) => a.id)).toContain(vencida)
    })
  })
})
