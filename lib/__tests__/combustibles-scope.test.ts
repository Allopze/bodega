/**
 * Regression tests for CHO-002 (AUDITORIA_INTEGRAL_CHOME.md): Combustibles
 * bulk vehicle mutations and consumption-record vehicle linking must not
 * cross worksite scope. Runs against a real Postgres-compatible engine
 * (PGlite, full migrations) so worksiteScopeSql and the transactions are
 * exercised for real — only auth() and Next's revalidatePath are mocked.
 */

import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { eq } from "drizzle-orm"
import type { Session } from "next-auth"
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest"
import * as schema from "@/db/schema"
import { migratePGlite } from "@/lib/testing/pglite-migrate"

const pg = new PGlite()
const inMemoryDb = drizzle(pg, { schema })
const testGlobal = globalThis as typeof globalThis & { __db?: typeof inMemoryDb }
// @ts-expect-error — PGlite is structurally compatible at runtime
testGlobal.__db = inMemoryDb

vi.mock("@/db", () => ({
  get db() {
    return testGlobal.__db
  },
}))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }))

const mockAuth = vi.hoisted(() => vi.fn())
vi.mock("@/lib/auth/auth", () => ({ auth: mockAuth }))

await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))

import { NextRequest } from "next/server"
import { bulkToggleFuelVehicleActiveAction, toggleFuelVehicleActiveAction } from "@/app/(app)/combustibles/actions-module/vehicles"
import { linkConsumptionPlateAction } from "@/app/(app)/combustibles/actions-consumos"
import { POST as importFuelLoads } from "@/app/api/combustibles/import/route"

function scopedSession(worksiteIds: string[]): Session {
  return {
    user: {
      id: "actor-scoped",
      name: "Admin Contrato Faena A",
      email: "actor@example.com",
      roles: ["admin_contrato"],
      permissions: ["admin:fleet_vehicles", "combustibles:manage_vehicles", "combustibles:revert", "combustibles:import"],
      worksiteIds,
      primaryWorksiteId: worksiteIds[0] ?? null,
      avatarColor: null,
      isActive: true,
      isGlobal: false,
    },
    expires: "2099-01-01T00:00:00.000Z",
  }
}

describe("combustibles — alcance de faena en mutaciones masivas y vinculación", () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    await inMemoryDb.delete(schema.fuelConsumptionRecords)
    await inMemoryDb.delete(schema.fuelImportBatches)
    await inMemoryDb.delete(schema.fuelVehicles)
    await inMemoryDb.delete(schema.fuelEquipmentTypes)
    await inMemoryDb.delete(schema.auditLog)
    await inMemoryDb.delete(schema.users)
    await inMemoryDb.delete(schema.worksites)

    await inMemoryDb.insert(schema.worksites).values([
      { id: "ws-a", name: "Faena A", code: "FN-A" },
      { id: "ws-b", name: "Faena B", code: "FN-B" },
    ])
    await inMemoryDb.insert(schema.users).values({
      id: "actor-scoped",
      name: "Admin Contrato Faena A",
      email: "actor@example.com",
      hashedPassword: "test-hash",
    })
    await inMemoryDb.insert(schema.fuelEquipmentTypes).values({
      id: "fet-camioneta",
      slug: "camioneta",
      name: "Camioneta",
    })
    await inMemoryDb.insert(schema.fuelVehicles).values([
      { id: "veh-a", plate: "AAAA11", type: "camioneta", equipmentTypeId: "fet-camioneta", worksiteId: "ws-a", isActive: true },
      { id: "veh-b", plate: "BBBB22", type: "camioneta", equipmentTypeId: "fet-camioneta", worksiteId: "ws-b", isActive: true },
    ])
  })

  afterAll(async () => {
    delete testGlobal.__db
    await pg.close()
  })

  describe("bulkToggleFuelVehicleActiveAction", () => {
    it("rejects the whole batch when one id is outside the session's worksite scope", async () => {
      mockAuth.mockResolvedValue(scopedSession(["ws-a"]))
      const formData = new FormData()
      formData.set("ids", "veh-a,veh-b")
      formData.set("activate", "false")
      formData.set("reason", "Baja masiva por fin de temporada")

      const state = await bulkToggleFuelVehicleActiveAction({ ok: false }, formData)

      expect(state.ok).toBe(false)
      expect(state.message).toMatch(/fuera de tu alcance/)

      const untouchedA = await inMemoryDb.query.fuelVehicles.findFirst({ where: eq(schema.fuelVehicles.id, "veh-a") })
      const untouchedB = await inMemoryDb.query.fuelVehicles.findFirst({ where: eq(schema.fuelVehicles.id, "veh-b") })
      expect(untouchedA?.isActive).toBe(true)
      expect(untouchedB?.isActive).toBe(true)
    })

    it("allows toggling vehicles that are entirely within scope", async () => {
      mockAuth.mockResolvedValue(scopedSession(["ws-a"]))
      const formData = new FormData()
      formData.set("ids", "veh-a")
      formData.set("activate", "false")
      formData.set("reason", "Baja por fin de temporada")

      const state = await bulkToggleFuelVehicleActiveAction({ ok: false }, formData)

      expect(state.ok).toBe(true)
      const updated = await inMemoryDb.query.fuelVehicles.findFirst({ where: eq(schema.fuelVehicles.id, "veh-a") })
      expect(updated?.isActive).toBe(false)
    })

    // CO-025/CO-028: la masiva audita una fila por vehículo, no un resumen agregado.
    it("audita una fila de auditoría por cada vehículo dado de baja", async () => {
      mockAuth.mockResolvedValue(scopedSession(["ws-a"]))
      const formData = new FormData()
      formData.set("ids", "veh-a")
      formData.set("activate", "false")
      formData.set("reason", "Baja por fin de temporada")

      await bulkToggleFuelVehicleActiveAction({ ok: false }, formData)

      const entries = await inMemoryDb.query.auditLog.findMany({
        where: eq(schema.auditLog.entityId, "veh-a"),
      })
      expect(entries).toHaveLength(1)
      expect(entries[0]?.entityType).toBe("fuel_vehicle")
      expect(JSON.parse(entries[0]!.oldState!)).toMatchObject({ isActive: true })
      expect(JSON.parse(entries[0]!.newState!)).toMatchObject({ isActive: false, reason: "Baja por fin de temporada" })
    })
  })

  // CO-025/CO-028: la baja individual no auditaba, no exigía motivo y no
  // repetía el estado esperado en el UPDATE (sin control optimista).
  describe("toggleFuelVehicleActiveAction", () => {
    it("audita el estado previo/nuevo con motivo dentro de la transacción", async () => {
      mockAuth.mockResolvedValue(scopedSession(["ws-a"]))

      const state = await toggleFuelVehicleActiveAction("veh-a", false, "Sale de servicio por revisión mecánica")

      expect(state.ok).toBe(true)
      const updated = await inMemoryDb.query.fuelVehicles.findFirst({ where: eq(schema.fuelVehicles.id, "veh-a") })
      expect(updated?.isActive).toBe(false)

      const entries = await inMemoryDb.query.auditLog.findMany({ where: eq(schema.auditLog.entityId, "veh-a") })
      expect(entries).toHaveLength(1)
      expect(JSON.parse(entries[0]!.oldState!)).toMatchObject({ isActive: true })
      expect(JSON.parse(entries[0]!.newState!)).toMatchObject({ isActive: false, reason: "Sale de servicio por revisión mecánica" })
    })

    it("rechaza un motivo demasiado corto sin tocar la fila", async () => {
      mockAuth.mockResolvedValue(scopedSession(["ws-a"]))

      const state = await toggleFuelVehicleActiveAction("veh-a", false, "no")

      expect(state.ok).toBe(false)
      expect(state.message).toMatch(/motivo/i)
      const untouched = await inMemoryDb.query.fuelVehicles.findFirst({ where: eq(schema.fuelVehicles.id, "veh-a") })
      expect(untouched?.isActive).toBe(true)
    })

    // Control optimista: si el estado ya cambió (a lo que se pide), no hay
    // nada que reconciliar y no debe fallar como si fuera una carrera perdida.
    it("no falla si el vehículo ya estaba en el estado pedido", async () => {
      mockAuth.mockResolvedValue(scopedSession(["ws-a"]))

      const state = await toggleFuelVehicleActiveAction("veh-a", true, "Ya estaba activo, confirmando estado")

      expect(state.ok).toBe(true)
    })
  })

  describe("linkConsumptionPlateAction", () => {
    async function seedBatch(worksiteId: string) {
      await inMemoryDb.insert(schema.fuelImportBatches).values({
        id: "batch-1",
        worksiteId,
        periodoDesde: "2026-06-01",
        periodoHasta: "2026-06-30",
        archivoNombre: "consumos.xlsx",
        hashArchivo: "hash-1",
        importadoPor: "actor-scoped",
      })
      await inMemoryDb.insert(schema.fuelConsumptionRecords).values({
        id: "rec-1",
        batchId: "batch-1",
        worksiteId,
        patente: "ZZZZ99",
        cantidadUnidad: 10,
        monto: 1000,
        periodoDesde: "2026-06-01",
        periodoHasta: "2026-06-30",
      })
    }

    it("rejects linking a vehicle from another worksite, even when the batch is in scope", async () => {
      await seedBatch("ws-a")
      mockAuth.mockResolvedValue(scopedSession(["ws-a"]))
      const formData = new FormData()
      formData.set("batchId", "batch-1")
      formData.set("patente", "ZZZZ99")
      formData.set("vehicleId", "veh-b") // belongs to ws-b, not the batch's ws-a

      const state = await linkConsumptionPlateAction({ ok: false }, formData)

      expect(state.ok).toBe(false)
      expect(state.message).toMatch(/no pertenece a la faena del lote/)

      const record = await inMemoryDb.query.fuelConsumptionRecords.findFirst({ where: eq(schema.fuelConsumptionRecords.id, "rec-1") })
      expect(record?.vehicleId).toBeNull()
    })

    it("rejects operating on a batch outside the session's worksite scope", async () => {
      await seedBatch("ws-b")
      mockAuth.mockResolvedValue(scopedSession(["ws-a"]))
      const formData = new FormData()
      formData.set("batchId", "batch-1")
      formData.set("patente", "ZZZZ99")
      formData.set("vehicleId", "veh-b")

      const state = await linkConsumptionPlateAction({ ok: false }, formData)

      expect(state.ok).toBe(false)
      expect(state.message).toMatch(/No tienes acceso a esta faena/)
    })

    it("allows linking a vehicle that matches the batch's worksite", async () => {
      await seedBatch("ws-a")
      mockAuth.mockResolvedValue(scopedSession(["ws-a"]))
      const formData = new FormData()
      formData.set("batchId", "batch-1")
      formData.set("patente", "ZZZZ99")
      formData.set("vehicleId", "veh-a")

      const state = await linkConsumptionPlateAction({ ok: false }, formData)

      expect(state.ok).toBe(true)
      const record = await inMemoryDb.query.fuelConsumptionRecords.findFirst({ where: eq(schema.fuelConsumptionRecords.id, "rec-1") })
      expect(record?.vehicleId).toBe("veh-a")
    })
  })

  describe("POST /api/combustibles/import — creación de faenas y mapeo fuera de alcance", () => {
    function minimalLoad(worksiteName: string) {
      return {
        rowIndex: 1,
        loadDate: "2026-06-01",
        month: "2026-06",
        serviceType: "TCT",
        vehicle: "AAAA11",
        supplier: "Proveedor X",
        worksite: worksiteName,
        product: "diesel",
        receiptNumber: "F-1",
        liters: 100,
        baseAmount: 1000,
        totalAmount: 1000,
      }
    }

    function importRequest(body: unknown) {
      return new NextRequest("http://localhost/api/combustibles/import", {
        method: "POST",
        body: JSON.stringify(body),
        headers: { "content-type": "application/json" },
      })
    }

    it("rejects CREATE_FAENA for a non-global session without admin:worksites", async () => {
      mockAuth.mockResolvedValue(scopedSession(["ws-a"]))
      const req = importRequest({
        loads: [minimalLoad("Faena Nueva")],
        faenaMapping: { "Faena Nueva": "__create__" },
      })

      const res = await importFuelLoads(req)

      expect(res.status).toBe(500)
      const createdWorksite = await inMemoryDb.query.worksites.findFirst({ where: eq(schema.worksites.name, "Faena Nueva") })
      expect(createdWorksite).toBeUndefined()
    })

    it("rejects mapping to an existing worksite outside the session's scope", async () => {
      mockAuth.mockResolvedValue(scopedSession(["ws-a"]))
      const req = importRequest({
        loads: [minimalLoad("Faena B (archivo)")],
        faenaMapping: { "Faena B (archivo)": "ws-b" },
      })

      const res = await importFuelLoads(req)

      expect(res.status).toBe(500)
      const loadsInB = await inMemoryDb.query.fuelLoads.findMany({ where: eq(schema.fuelLoads.worksiteId, "ws-b") })
      expect(loadsInB).toHaveLength(0)
    })
  })
})
