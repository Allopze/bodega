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

import {
  createAsset, updateAsset, softDeleteAsset, changeAssetStatus, listAssets, getAssetById, listAssetOptions,
} from "@/lib/services/ti/assets"
import { getAssetHistory } from "@/lib/services/ti/history"
import { retireAsset } from "@/lib/services/ti/retirements"

describe("módulo TI — activos", () => {
  let typeId: string
  let noSpecsTypeId: string
  const actor = { userId: "user-ti-tecnico", userEmail: "tecnico@ti.cl" }

  beforeAll(async () => {
    await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))
    const seeds = await seedTiBase(testDb)
    typeId = await seedAssetType(testDb)
    noSpecsTypeId = await seedAssetType(testDb, { id: "type-ti-mouse", name: "Mouse", category: "periferico", hasSpecs: false })

    await createAsset({
      code: "TI-NB-0001",
      assetTypeId: typeId,
      brand: "Lenovo",
      model: "ThinkPad T14",
      serialNumber: "SN-0001",
      worksiteId: seeds.worksiteId,
      cost: 1_200_000,
      warrantyEndDate: plainDateIn(10),
      processor: "i7",
      ram: "16GB",
      storage: "512GB",
      os: "Windows 11",
    }, actor)
  })

  afterAll(async () => pg.close())

  it("crea un activo con specs y su entrada de historial 'created'", async () => {
    const id = await createAsset({
      code: "TI-NB-0002",
      assetTypeId: typeId,
      brand: "Dell",
      model: "Latitude 5440",
      serialNumber: "SN-0002",
      worksiteId: "ws-ti-norte",
      processor: "i5",
      ram: "8GB",
      storage: "256GB",
      os: "Windows 11",
    }, actor)

    const asset = await getAssetById(id)
    expect(asset?.code).toBe("TI-NB-0002")
    expect(asset?.status).toBe("disponible")
    expect(asset?.typeName).toBe("Notebook")
    expect(asset?.processor).toBe("i5")

    const history = await getAssetHistory(id)
    expect(history.some((h) => h.action === "created")).toBe(true)
  })

  it("rechaza crear un activo directamente en estado de custodia", async () => {
    await expect(createAsset({
      code: "TI-NB-ESTADO-INVALIDO",
      assetTypeId: typeId,
      status: "asignado",
    }, actor)).rejects.toThrow(/estado inicial debe ser disponible/i)
  })

  it("limpia los specs cuando el tipo no los declara (hasSpecs=false)", async () => {
    const id = await createAsset({
      code: "TI-MO-0001",
      assetTypeId: noSpecsTypeId,
      brand: "Logitech",
      processor: "i7", // debería descartarse
      ram: "16GB",
      os: "Windows",
    }, actor)

    const asset = await getAssetById(id)
    expect(asset?.processor).toBeNull()
    expect(asset?.ram).toBeNull()
    expect(asset?.os).toBeNull()
  })

  it("rechaza un código duplicado", async () => {
    await expect(createAsset({ code: "TI-NB-0001", assetTypeId: typeId }, actor))
      .rejects.toThrow(/Ya existe un activo con el código TI-NB-0001/)
  })

  it("rechaza un tipo de activo inexistente o inactivo", async () => {
    await expect(createAsset({ code: "TI-NB-9999", assetTypeId: "no-existe" }, actor))
      .rejects.toThrow(/Tipo de activo no encontrado/)
    const inactive = await seedAssetType(testDb, { id: "type-ti-inactivo", name: "Inactivo", category: "otro", isActive: false })
    await expect(createAsset({ code: "TI-NB-9998", assetTypeId: inactive }, actor))
      .rejects.toThrow(/tipo de activo está inactivo/)
  })

  it("edita el activo y deja la entrada 'edited' en el historial", async () => {
    const [row] = await testDb.select({ id: schema.itAssets.id }).from(schema.itAssets)
      .where(eq(schema.itAssets.code, "TI-NB-0001"))
    await updateAsset({
      id: row!.id,
      code: "TI-NB-0001",
      assetTypeId: typeId,
      brand: "Lenovo",
      model: "ThinkPad T14s",
      serialNumber: "SN-0001",
      worksiteId: "ws-ti-norte",
      cost: 1_250_000,
      warrantyEndDate: plainDateIn(10), // el formulario manda todas las columnas
    }, actor)

    const asset = await getAssetById(row!.id)
    expect(asset?.model).toBe("ThinkPad T14s")
    const history = await getAssetHistory(row!.id)
    expect(history.some((h) => h.action === "edited")).toBe(true)
  })

  it("rechaza editar o cambiar el estado de un activo fuera del scope de faena", async () => {
    const id = await createAsset({ code: "TI-SCOPE-0001", assetTypeId: typeId, worksiteId: "ws-ti-sur" }, actor)

    await expect(updateAsset({
      id,
      code: "TI-SCOPE-0001",
      assetTypeId: typeId,
      worksiteId: "ws-ti-sur",
    }, actor, ["ws-ti-norte"])).rejects.toThrow(/No tienes acceso a esta faena/)

    await expect(changeAssetStatus({ assetId: id, status: "en_reparacion", reason: "Diagnóstico" }, actor, ["ws-ti-norte"]))
      .rejects.toThrow(/No tienes acceso a esta faena/)
  })

  it("no permite usar el cambio manual para dar de baja un activo con custodia abierta", async () => {
    const id = await createAsset({ code: "TI-STATUS-0001", assetTypeId: typeId, worksiteId: "ws-ti-norte" }, actor)
    await testDb.insert(schema.itAssetAssignments).values({
      id: "asg-status-bypass",
      code: "ACT-2099-STATUS",
      assetId: id,
      workerId: "wk-ti-juan",
      worksiteId: "ws-ti-norte",
      kind: "delivery",
      deliveredAt: new Date().toISOString(),
      deliveredByUserId: actor.userId,
      physicalState: "bueno",
    })

    await expect(changeAssetStatus({ assetId: id, status: "dado_de_baja", reason: "Baja directa" }, actor))
      .rejects.toThrow(/flujo formal|estado manual|baja/i)
  })

  it("filtra por estado y por ventana de garantía", async () => {
    const disponibles = await listAssets({ status: "disponible" })
    expect(disponibles.some((a) => a.code === "TI-NB-0001")).toBe(true)

    const porVencer = await listAssets({ warrantyWindow: "expiring_30" })
    expect(porVencer.map((a) => a.code)).toContain("TI-NB-0001")

    const vencidas = await listAssets({ warrantyWindow: "expired" })
    expect(vencidas.map((a) => a.code)).not.toContain("TI-NB-0001")
  })

  it("excluye los activos dados de baja del inventario salvo includeRetired", async () => {
    const id = await createAsset({ code: "TI-NB-0003", assetTypeId: typeId }, actor)
    await retireAsset({
      assetId: id,
      date: "2026-09-03",
      reason: "reciclaje",
      responsibleUserId: actor.userId,
      // Doble control: el autorizante debe ser otro usuario.
      authorizedByUserId: "user-ti-gestor",
    }, actor)

    const activos = await listAssets({})
    expect(activos.map((a) => a.code)).not.toContain("TI-NB-0003")
    const conBajas = await listAssets({ includeRetired: true })
    expect(conBajas.map((a) => a.code)).toContain("TI-NB-0003")
  })

  it("impide pasar a 'asignado' sin una entrega abierta", async () => {
    const id = await createAsset({ code: "TI-NB-0004", assetTypeId: typeId }, actor)
    await expect(changeAssetStatus({ assetId: id, status: "asignado", reason: "A mano" }, actor))
      .rejects.toThrow(/Solo una entrega registrada puede dejar el activo en 'asignado'/)
  })

  it("cambia estado con historial y status_history", async () => {
    const id = await createAsset({ code: "TI-NB-0005", assetTypeId: typeId }, actor)
    await changeAssetStatus({ assetId: id, status: "en_reparacion", reason: "Pantalla rota" }, actor)

    const asset = await getAssetById(id)
    expect(asset?.status).toBe("en_reparacion")
    const history = await getAssetHistory(id)
    const entry = history.find((h) => h.action === "status_changed")
    expect(entry?.detail).toContain("en_reparacion")

    const changes = await testDb.select().from(schema.statusHistory)
      .where(eq(schema.statusHistory.entityId, id))
    expect(changes.some((c) => c.fromStatus === "disponible" && c.toStatus === "en_reparacion")).toBe(true)
  })

  it("no borra (baja lógica) un activo con asignación abierta y sí lo hace sin ella", async () => {
    // Con asignación abierta: se inserta la asignación directo para no depender del flujo completo.
    const id = await createAsset({ code: "TI-NB-0006", assetTypeId: typeId }, actor)
    await testDb.insert(schema.itAssetAssignments).values({
      id: "asg-blk-delete",
      code: "ACT-2099-0001",
      assetId: id,
      workerId: "wk-ti-juan",
      worksiteId: "ws-ti-norte",
      kind: "delivery",
      deliveredAt: new Date().toISOString(),
      deliveredByUserId: actor.userId,
      physicalState: "bueno",
    })
    await expect(softDeleteAsset(id, actor)).rejects.toThrow(/asignación .* abierta/)

    // Sin asignación abierta: se elimina lógicamente y desaparece del listado.
    const free = await createAsset({ code: "TI-NB-0007", assetTypeId: typeId }, actor)
    await softDeleteAsset(free, actor)
    expect(await getAssetById(free)).toBeNull()
    const rows = await listAssets({})
    expect(rows.map((a) => a.code)).not.toContain("TI-NB-0007")
  })

  it("listAssetOptions no incluye activos dados de baja", async () => {
    const options = await listAssetOptions()
    expect(options.map((o) => o.code)).toContain("TI-NB-0001")
    expect(options.map((o) => o.code)).not.toContain("TI-NB-0003")
  })

  it("explica la colisión de código o serie contra activos eliminados en vez de dejar caer el índice único", async () => {
    const typeId = "type-ti-notebook"
    const id = await createAsset({
      code: "TI-NB-9001", assetTypeId: typeId, serialNumber: "SN-UNICO-9001",
    }, actor)
    await softDeleteAsset(id, actor)

    // El índice único de `code`/`serial_number` es total, no parcial: el activo
    // eliminado sigue ocupando ambos valores y el mensaje debe decirlo.
    await expect(createAsset({ code: "TI-NB-9001", assetTypeId: typeId }, actor))
      .rejects.toThrow(/activo eliminado/i)
    await expect(createAsset({ code: "TI-NB-9002", assetTypeId: typeId, serialNumber: "SN-UNICO-9001" }, actor))
      .rejects.toThrow(/activo eliminado/i)

    // Serie duplicada entre dos activos vigentes: antes no se validaba.
    await createAsset({ code: "TI-NB-9003", assetTypeId: typeId, serialNumber: "SN-VIVO-1" }, actor)
    await expect(createAsset({ code: "TI-NB-9004", assetTypeId: typeId, serialNumber: "SN-VIVO-1" }, actor))
      .rejects.toThrow(/número de serie .* ya está registrado/i)
  })
})
