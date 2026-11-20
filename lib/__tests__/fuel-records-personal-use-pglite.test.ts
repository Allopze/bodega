import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { beforeAll, describe, expect, it, vi } from "vitest"
import * as schema from "@/db/schema"
import type { DB } from "@/db"
import { migratePGlite } from "@/lib/testing/pglite-migrate"
import { IDS, filtersFor, globalSession, seedControlFixtures, submission } from "@/lib/combustibles/control/queries/test-fixtures"

/**
 * La marca «Uso personal» de los registros (bitácora de Cargas y cola de revisión), contra Postgres
 * de verdad. Es una marca, no un filtro: la fila se lista y se cuenta igual; sólo dice que el día de
 * la carga cae en un período del equipo (día de Chile, extremos inclusivos, período abierto hasta hoy).
 */

const pg = new PGlite()
const testDb = drizzle(pg, { schema }) as unknown as DB
const g = globalThis as typeof globalThis & { __db?: DB }
g.__db = testDb
vi.mock("@/db", () => ({ get db() { return g.__db } }))
vi.mock("server-only", () => ({}))

const { getFuelLogRows, getFuelLogTotal } = await import("@/lib/combustibles/fuel-log")
const { getReviewQueue, parseReviewTab } = await import("@/lib/combustibles/control/review-queue")

const PAGE = { limit: 100, offset: 0, sort: "asc" as const }
const L = schema.fuelEquipmentLoads
const ids: Record<string, string> = {}

/** Carga en terreno proyectada a `fuel_equipment_loads` (la fila que lee la cola de revisión). */
async function addFieldLoad(key: string, vehicleId: string, loadedAt: string, review: "ok" | "flagged" = "ok") {
  const sub = submission({ vehicleId, loadedAt, submittedAt: loadedAt })
  await testDb.insert(schema.fuelTaeSubmissions).values(sub)
  await testDb.insert(L).values({
    id: `fr-l-${key}`, source: "field", taeSubmissionId: sub.id, vehicleId, worksiteId: IDS.wsA, occurredAt: loadedAt,
    month: loadedAt.slice(0, 7), liters: 100, performanceUnit: "liters_per_hour", performanceValue: 10, performanceStatus: "computed",
    reviewStatus: review, flagReasons: review === "flagged" ? ["outlier"] : [],
  })
  ids[key] = sub.id
}

beforeAll(async () => {
  await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))
  await seedControlFixtures(testDb)
  await testDb.insert(schema.fuelSuppliers).values({ id: "fr-sup", name: "Copec" })
  await testDb.insert(schema.fuelOperationBatches).values({
    id: "fr-batch", archivoNombre: "x.xlsx", hashArchivo: "fr-hash", periodoDesde: "2026-10-01", periodoHasta: "2026-10-31", importadoPor: IDS.user,
  })
  // vA: uso personal del 10 al 19 de octubre. vB: período abierto desde el 25 de octubre.
  await testDb.insert(schema.fuelVehiclePersonalUsePeriods).values([
    { id: "fr-pu-a", vehicleId: IDS.vA, startedOn: "2026-10-10", endedOn: "2026-10-19" },
    { id: "fr-pu-b", vehicleId: IDS.vB, startedOn: "2026-10-25", endedOn: null },
  ])

  // Terreno: dentro, 22:30 de Chile del último día (…T01:30Z del 20: dentro), 00:30 del día siguiente (fuera) y antes.
  await addFieldLoad("tIn", IDS.vA, "2026-10-15T15:00:00.000Z", "flagged")
  await addFieldLoad("tEdgeIn", IDS.vA, "2026-10-20T01:30:00.000Z")
  await addFieldLoad("tEdgeOut", IDS.vA, "2026-10-20T03:30:00.000Z")
  await addFieldLoad("tBefore", IDS.vA, "2026-10-05T15:00:00.000Z")
  await addFieldLoad("tOpen", IDS.vB, "2026-10-28T15:00:00.000Z")
  await addFieldLoad("tOtherVehicle", IDS.vC, "2026-10-15T15:00:00.000Z")

  // Planilla: una fila dentro del período (con su carga proyectada) y otra fuera.
  for (const [key, fecha, day] of [["opIn", "2026-10-12", "2026-10-12"], ["opOut", "2026-10-22", "2026-10-22"]] as const) {
    await testDb.insert(schema.fuelOperationRecords).values({ id: `fr-op-${key}`, batchId: "fr-batch", worksiteId: IDS.wsA, vehicleId: IDS.vA, plate: "AA-0001", fecha, liters: 50 })
    await testDb.insert(L).values({
      id: `fr-lop-${key}`, source: "operations_import", operationRecordId: `fr-op-${key}`, vehicleId: IDS.vA, worksiteId: IDS.wsA,
      occurredAt: `${day}T15:00:00.000Z`, month: "2026-10", liters: 50, performanceUnit: "liters_per_hour", performanceStatus: "computed", reviewStatus: "ok",
    })
    ids[key] = `fr-op-${key}`
  }

  // Facturadas (`fuel_loads`): una dentro del período de vA y una fuera.
  for (const [key, loadDate] of [["invIn", "2026-10-19"], ["invOut", "2026-10-20"]] as const) {
    await testDb.insert(schema.fuelLoads).values({
      id: `fr-inv-${key}`, loadDate, month: "2026-10", serviceType: "TCT", vehicleId: IDS.vA, fuelSupplierId: "fr-sup", worksiteId: IDS.wsA,
      product: "PETROLEO DIESEL", productId: IDS.product, liters: 80, baseAmount: 80_000, totalAmount: 95_200, status: "registered", createdBy: IDS.user,
    })
    ids[key] = `fr-inv-${key}`
  }
}, 60_000)

describe("bitácora de Cargas", () => {
  it("marca la carga cuyo día de Chile cae en un período y deja la fila en la lista", async () => {
    const rows = await getFuelLogRows(globalSession(), {}, PAGE)
    const flag = (id: string) => rows.find((row) => row.id === id)?.personalUse

    // Terreno
    expect(flag(ids.tIn!)).toBe(true)
    expect(flag(ids.tEdgeIn!)).toBe(true) // 22:30 en Chile del 19: último día, inclusivo
    expect(flag(ids.tEdgeOut!)).toBe(false) // 00:30 del 20
    expect(flag(ids.tBefore!)).toBe(false)
    expect(flag(ids.tOtherVehicle!)).toBe(false) // otro equipo, mismas fechas
    // Período abierto: cubre desde su inicio hasta hoy.
    expect(flag(ids.tOpen!)).toBe(true)
    // Planilla y factura
    expect(flag(ids.opIn!)).toBe(true)
    expect(flag(ids.opOut!)).toBe(false)
    expect(flag(ids.invIn!)).toBe(true)
    expect(flag(ids.invOut!)).toBe(false)
  })

  it("no oculta filas: el total es el mismo con y sin períodos", async () => {
    const rows = await getFuelLogRows(globalSession(), {}, PAGE)
    expect(rows).toHaveLength(10)
    expect(await getFuelLogTotal(globalSession(), {})).toBe(10)

    await testDb.delete(schema.fuelVehiclePersonalUsePeriods)
    const without = await getFuelLogRows(globalSession(), {}, PAGE)
    expect(without).toHaveLength(10)
    expect(without.every((row) => row.personalUse === false)).toBe(true)
    expect(await getFuelLogTotal(globalSession(), {})).toBe(10)

    // Se restauran para el resto de las pruebas.
    await testDb.insert(schema.fuelVehiclePersonalUsePeriods).values([
      { id: "fr-pu-a2", vehicleId: IDS.vA, startedOn: "2026-10-10", endedOn: "2026-10-19" },
      { id: "fr-pu-b2", vehicleId: IDS.vB, startedOn: "2026-10-25", endedOn: null },
    ])
  })
})

describe("cola de revisión", () => {
  it("marca las cargas por decidir que caen en un período, sin cambiar el total", async () => {
    const result = await getReviewQueue(globalSession(), filtersFor({ meses: "10" }), parseReviewTab(undefined))

    expect(result.total).toBe(1)
    expect(result.rows).toHaveLength(1)
    expect(result.rows[0]).toMatchObject({ id: "fr-l-tIn", personalUse: true })
  })
})
