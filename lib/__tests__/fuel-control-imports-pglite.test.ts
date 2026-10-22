import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { migratePGlite } from "@/lib/testing/pglite-migrate"
import { describe, it, expect, beforeAll, vi } from "vitest"
import path from "node:path"
import type { Session } from "next-auth"
import { eq } from "drizzle-orm"
import * as schema from "@/db/schema"
import { nanoid } from "@/lib/id"
import { buildXlsx } from "@/lib/combustibles/control/imports/test-helpers"

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
vi.mock("@/lib/utils", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/utils")>()),
  todayInChile: () => "2026-10-21",
}))

await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))

const service = await import("@/lib/combustibles/control/imports/service")

const TELEMETRY_HEADERS = ["Equipo", "Fecha", "Horas funcionamiento", "Horas en vacío", "Litros trabajando", "Litros en vacío"]
const SUPPLY_HEADERS = ["Fecha", "Faena", "Litros", "Referencia", "Patente o estanque"]

function session(userId: string, worksiteIds: string[] | "global"): Session {
  return {
    user: {
      id: userId, name: "Importadora", email: `${userId}@example.com`, roles: [], permissions: [], worksiteIds: worksiteIds === "global" ? [] : worksiteIds,
      primaryWorksiteId: null, avatarColor: null, isActive: true, ...(worksiteIds === "global" ? { isGlobal: true } : { isGlobal: false }),
    },
    expires: "2099-01-01T00:00:00.000Z",
  } as Session
}

/** Importadores del control contra PostgreSQL: idempotencia, upsert, alcance, rechazos y reversión. */
describe("importadores de telemetría y entradas de suministro (PostgreSQL)", () => {
  const worksiteA = nanoid()
  const worksiteB = nanoid()
  const userId = nanoid()
  const otherUserId = nanoid()
  const typeId = nanoid()
  const vehicleA = nanoid()
  const vehicleB = nanoid()
  const mediumId = "fsm-test-" + nanoid().slice(0, 6)
  const global = () => session(userId, "global")

  beforeAll(async () => {
    await inMemoryDb.insert(schema.worksites).values([
      { id: worksiteA, name: "Faena Norte", code: `FN-${nanoid().slice(0, 6)}`, isActive: true },
      { id: worksiteB, name: "Faena Sur", code: `FS-${nanoid().slice(0, 6)}`, isActive: true },
    ])
    await inMemoryDb.insert(schema.users).values([
      { id: userId, name: "Importadora", email: `${userId}@example.com`, hashedPassword: "x", isActive: true },
      { id: otherUserId, name: "Otro", email: `${otherUserId}@example.com`, hashedPassword: "x", isActive: true },
    ])
    await inMemoryDb.insert(schema.fuelEquipmentTypes).values({ id: typeId, slug: `camion-${nanoid().slice(0, 6)}`, name: "Camión" })
    await inMemoryDb.insert(schema.fuelVehicles).values([
      { id: vehicleA, plate: `TA${nanoid().slice(0, 4).toUpperCase()}`, code: "KA-63", type: "camion", equipmentTypeId: typeId, worksiteId: worksiteA, isActive: true, performanceUnit: "liters_per_hour" },
      { id: vehicleB, plate: `TB${nanoid().slice(0, 4).toUpperCase()}`, code: "KB-10", type: "camion", equipmentTypeId: typeId, worksiteId: worksiteB, isActive: true, performanceUnit: "liters_per_hour" },
    ])
    await inMemoryDb.insert(schema.fuelSupplyMedia).values({ id: mediumId, slug: mediumId, name: "Surtidor CMPC (prueba)", kind: "provider_station" })
  })

  describe("telemetría", () => {
    it("vista previa: separa nuevas, actualizaciones y rechazos sin escribir nada", async () => {
      const buffer = await buildXlsx(TELEMETRY_HEADERS, [
        ["KA-63", "15-01-2026", 8, 2, 100, 20],
        ["KA-63", "16-01-2026", 9, 1, null, null],
        ["NOEXISTE", "16-01-2026", 9, 1, null, null],
      ])
      const preview = await service.previewControlImport(global(), "telemetry", { buffer, fileName: "tele-1.xlsx", source: "VisionLink" })
      expect(preview.ok).toBe(true)
      if (!preview.ok) return
      expect(preview.data).toMatchObject({ validRows: 2, toInsert: 2, toUpdate: 0, targetLabel: "visionlink", periodFrom: "2026-01-15", periodTo: "2026-01-16", distinctVehicles: 1 })
      expect(preview.data.rejected).toHaveLength(1)
      expect(await inMemoryDb.select().from(schema.fuelTelemetryDaily)).toHaveLength(0)
    })

    it("confirma, audita y bloquea reimportar el mismo archivo (aun en paralelo)", async () => {
      const buffer = await buildXlsx(TELEMETRY_HEADERS, [
        ["KA-63", "15-01-2026", 8, 2, 100, 20],
        ["KA-63", "16-01-2026", 9, 1, null, null],
        ["NOEXISTE", "16-01-2026", 9, 1, null, null],
      ])
      const input = { buffer, fileName: "tele-1.xlsx", source: "VisionLink" }
      const [first, second] = await Promise.all([
        service.commitControlImport(global(), "telemetry", input),
        service.commitControlImport(global(), "telemetry", input),
      ])
      const outcomes = [first, second]
      expect(outcomes.filter((outcome) => outcome.ok)).toHaveLength(1)
      const failure = outcomes.find((outcome) => !outcome.ok)
      expect(failure && !failure.ok && failure.message).toMatch(/ya fue importado/)
      const ok = outcomes.find((outcome) => outcome.ok)!
      if (!ok.ok) throw new Error("sin lote")
      expect(ok.data).toMatchObject({ inserted: 2, updated: 0, rejectedCount: 1 })

      const batches = await inMemoryDb.select().from(schema.fuelControlImportBatches)
      expect(batches).toHaveLength(1)
      expect(batches[0]).toMatchObject({ kind: "telemetry", insertedRows: 2, updatedRows: 0, rejectedRows: 1, status: "imported", importedBy: userId })
      const rejections = await inMemoryDb.select().from(schema.fuelControlImportRejections)
      expect(rejections).toHaveLength(1)
      expect(rejections[0]).toMatchObject({ batchKind: "telemetry", rowIndex: 4, field: "Equipo" })
      const audits = await inMemoryDb.select().from(schema.auditLog).where(eq(schema.auditLog.entityId, ok.data.batchId))
      expect(audits).toHaveLength(1)
      expect(JSON.parse(audits[0]!.newState!)).toMatchObject({ kind: "telemetry", insertedRows: 2, rejectedRows: 1 })

      const preview = await service.previewControlImport(global(), "telemetry", input)
      expect(preview.ok && preview.data.alreadyImported?.batchId).toBe(ok.data.batchId)
    })

    it("un archivo que se superpone actualiza por (equipo, día, fuente) sin duplicar", async () => {
      const buffer = await buildXlsx(TELEMETRY_HEADERS, [
        ["KA-63", "16-01-2026", 7, 3, 50, 10],
        ["KA-63", "17-01-2026", 6, 0, null, null],
      ])
      const preview = await service.previewControlImport(global(), "telemetry", { buffer, fileName: "tele-2.xlsx", source: "VisionLink" })
      expect(preview.ok && [preview.data.toInsert, preview.data.toUpdate]).toEqual([1, 1])
      const result = await service.commitControlImport(global(), "telemetry", { buffer, fileName: "tele-2.xlsx", source: "VisionLink" })
      expect(result.ok && [result.data.inserted, result.data.updated]).toEqual([1, 1])

      const rows = await inMemoryDb.select().from(schema.fuelTelemetryDaily)
      expect(rows).toHaveLength(3)
      const updated = rows.find((row) => row.day === "2026-01-16")!
      expect(updated).toMatchObject({ operatingHours: 7, idleHours: 3, litersWorking: 50, litersIdle: 10 })

      // Otra fuente para el mismo equipo y día es otra fila.
      const other = await service.commitControlImport(global(), "telemetry", { buffer: await buildXlsx(TELEMETRY_HEADERS, [["KA-63", "16-01-2026", 5, 1, null, null]]), fileName: "otra.xlsx", source: "Otra Fuente" })
      expect(other.ok).toBe(true)
      expect(await inMemoryDb.select().from(schema.fuelTelemetryDaily)).toHaveLength(4)
    })

    it("rechaza equipos fuera del alcance de faenas del usuario", async () => {
      const buffer = await buildXlsx(TELEMETRY_HEADERS, [["KA-63", "20-01-2026", 5, 1, null, null], ["KB-10", "20-01-2026", 5, 1, null, null]])
      const scoped = session(otherUserId, [worksiteA])
      const result = await service.commitControlImport(scoped, "telemetry", { buffer, fileName: "alcance.xlsx" })
      expect(result.ok && [result.data.inserted, result.data.rejectedCount]).toEqual([1, 1])
      const rejection = (await inMemoryDb.select().from(schema.fuelControlImportRejections)).find((row) => row.message.includes("fuera de tu alcance"))
      expect(rejection).toBeDefined()
    })

    it("no crea lote si ninguna fila es válida", async () => {
      const before = (await inMemoryDb.select().from(schema.fuelControlImportBatches)).length
      const result = await service.commitControlImport(global(), "telemetry", { buffer: await buildXlsx(TELEMETRY_HEADERS, [["NOEXISTE", "20-01-2026", 5, 1, null, null]]), fileName: "nada.xlsx" })
      expect(result.ok).toBe(false)
      expect((await inMemoryDb.select().from(schema.fuelControlImportBatches)).length).toBe(before)
    })

    it("revertir elimina lo que insertó el lote, permite reimportar el archivo y queda auditado", async () => {
      const buffer = await buildXlsx(TELEMETRY_HEADERS, [["KB-10", "25-01-2026", 5, 1, null, null]])
      const imported = await service.commitControlImport(global(), "telemetry", { buffer, fileName: "revertible.xlsx" })
      if (!imported.ok) throw new Error(imported.message)
      const batchId = imported.data.batchId
      const count = async () => (await inMemoryDb.select().from(schema.fuelTelemetryDaily).where(eq(schema.fuelTelemetryDaily.batchId, batchId))).length
      expect(await count()).toBe(1)

      // Un usuario con alcance parcial que no ve la faena del lote no puede revertirlo (ni lo ve).
      const outsider = await service.revertControlImportBatch(session(otherUserId, [worksiteA]), batchId)
      expect(outsider.ok).toBe(false)

      const reverted = await service.revertControlImportBatch(global(), batchId)
      expect(reverted).toEqual({ ok: true, deletedRows: 1 })
      expect(await count()).toBe(0)
      const [batch] = await inMemoryDb.select().from(schema.fuelControlImportBatches).where(eq(schema.fuelControlImportBatches.id, batchId))
      expect(batch?.status).toBe("reverted")
      expect((await service.revertControlImportBatch(global(), batchId)).ok).toBe(false)
      const audits = await inMemoryDb.select().from(schema.auditLog).where(eq(schema.auditLog.entityId, batchId))
      expect(audits.map((audit) => audit.action).sort()).toEqual(["create", "update"])

      const again = await service.commitControlImport(global(), "telemetry", { buffer, fileName: "revertible.xlsx" })
      expect(again.ok).toBe(true)
    })

    it("el historial muestra todo a un rol global y solo lo propio al resto", async () => {
      const all = await service.listControlImportBatches(global())
      const mine = await service.listControlImportBatches(session(otherUserId, [worksiteA]))
      expect(all.length).toBeGreaterThan(mine.length)
      expect(mine.every((batch) => batch.importedByName === "Otro")).toBe(true)
    })
  })

  describe("entradas de suministro", () => {
    it("importa por medio, resuelve faena y equipo, y rechaza lo inválido", async () => {
      const buffer = await buildXlsx(SUPPLY_HEADERS, [
        ["15-01-2026", "faena norte", "1.000,5", "g-1", "KA-63"],
        ["15-01-2026", "Faena Sur", 500, "G-2", "estanque 3"],
        ["15-01-2026", "Faena Inexistente", 500, "G-3", null],
        ["15-01-2026", "Faena Norte", 0, "G-4", null],
      ])
      const result = await service.commitControlImport(global(), "supply_inputs", { buffer, fileName: "cmpc-1.xlsx", supplyMediumId: mediumId })
      if (!result.ok) throw new Error(result.message)
      expect(result.data).toMatchObject({ inserted: 2, updated: 0, rejectedCount: 2 })
      const rows = await inMemoryDb.select().from(schema.fuelSupplyInputs).where(eq(schema.fuelSupplyInputs.supplyMediumId, mediumId))
      const byReference = Object.fromEntries(rows.map((row) => [row.reference, row]))
      expect(byReference["G-1"]).toMatchObject({ liters: 1000.5, worksiteId: worksiteA, vehicleId: vehicleA, month: "2026-01" })
      expect(byReference["G-2"]).toMatchObject({ worksiteId: worksiteB, vehicleId: null })
    })

    it("reimportar una referencia del mismo medio actualiza; en otro medio es otra fila", async () => {
      const buffer = await buildXlsx(SUPPLY_HEADERS, [["15-01-2026", "Faena Norte", 1200, "G-1", null], ["16-01-2026", "Faena Norte", 80, "G-9", null]])
      const result = await service.commitControlImport(global(), "supply_inputs", { buffer, fileName: "cmpc-2.xlsx", supplyMediumId: mediumId })
      expect(result.ok && [result.data.inserted, result.data.updated]).toEqual([1, 1])
      const rows = await inMemoryDb.select().from(schema.fuelSupplyInputs).where(eq(schema.fuelSupplyInputs.supplyMediumId, mediumId))
      expect(rows).toHaveLength(3)
      expect(rows.find((row) => row.reference === "G-1")?.liters).toBe(1200)

      const otherMedium = "fsm-otro-" + nanoid().slice(0, 6)
      await inMemoryDb.insert(schema.fuelSupplyMedia).values({ id: otherMedium, slug: otherMedium, name: "Otro medio", kind: "card" })
      const again = await service.commitControlImport(global(), "supply_inputs", { buffer: await buildXlsx(SUPPLY_HEADERS, [["15-01-2026", "Faena Norte", 10, "G-1", null]]), fileName: "otro.xlsx", supplyMediumId: otherMedium })
      expect(again.ok && again.data.inserted).toBe(1)
    })

    it("exige un medio activo y rechaza faenas fuera de alcance", async () => {
      const buffer = await buildXlsx(SUPPLY_HEADERS, [["15-01-2026", "Faena Sur", 10, "Z-1", null]])
      expect((await service.commitControlImport(global(), "supply_inputs", { buffer, fileName: "x.xlsx" })).ok).toBe(false)
      expect((await service.commitControlImport(global(), "supply_inputs", { buffer, fileName: "x.xlsx", supplyMediumId: "no-existe" })).ok).toBe(false)
      const scoped = await service.commitControlImport(session(otherUserId, [worksiteA]), "supply_inputs", { buffer, fileName: "x.xlsx", supplyMediumId: mediumId })
      expect(scoped.ok).toBe(false)
    })

    it("lista y descarga los rechazos guardados de un lote", async () => {
      const batches = await service.listControlImportBatches(global())
      const withRejections = batches.find((batch) => batch.kind === "supply_inputs" && batch.rejectedRows > 0)!
      const result = await service.listBatchRejections(global(), withRejections.id)
      expect(result.ok && result.rows.length).toBe(withRejections.rejectedRows)
      if (result.ok) expect(result.rows[0]?.raw).toBeTruthy()
      expect((await service.listBatchRejections(session(nanoid(), [worksiteA]), withRejections.id)).ok).toBe(false)
    })
  })
})
