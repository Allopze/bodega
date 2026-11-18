import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { beforeAll, describe, expect, it, vi } from "vitest"
import * as schema from "@/db/schema"
import type { DB } from "@/db"
import { migratePGlite } from "@/lib/testing/pglite-migrate"
import { loadStayEvidence } from "@/lib/fleet/stay-evidence"

/**
 * Evidencia de dónde estuvo un equipo, contra Postgres de verdad: sólo las fuentes
 * admitidas, sin lo anulado/cancelado/fuera de faena, y con el día CIVIL chileno de
 * cada instante (una carga de las 23:30 del 3-mar es del 3, no del 4).
 */

const pg = new PGlite()
const testDb = drizzle(pg, { schema }) as unknown as DB
const g = globalThis as typeof globalThis & { __db?: DB }
g.__db = testDb
vi.mock("@/db", () => ({ get db() { return g.__db } }))
vi.mock("server-only", () => ({}))

const WS = { a: "ws-ev-a", b: "ws-ev-b" } as const
const V = "veh-ev-1"
const V2 = "veh-ev-2"

const snapshot = { code: "KA-1", plate: "EV-0001", noPlate: false, type: "Camión", brand: "X", model: "Y", year: 2020, worksite: "Faena A", unit: "km" as const }

function submission(id: string, worksiteId: string, loadedAt: string, status = "submitted", vehicleId: string | null = V) {
  return {
    id, clientSubmissionId: `c-${id}`, publicResultToken: `t-${id}`, worksiteId, vehicleId, productId: "prod-ev",
    equipmentCodeSnapshot: "KA-1", loadedAt, submittedAt: loadedAt, driverNameSnapshot: "Cond", supervisorNameSnapshot: "Sup",
    meterType: "hour_meter", liters: 10, status,
  } as typeof schema.fuelTaeSubmissions.$inferInsert
}

function equipmentLoad(id: string, submissionId: string, source: "field" | "legacy_tae", worksiteId: string, occurredAt: string, voidedAt: string | null = null) {
  return {
    id, source, taeSubmissionId: submissionId, vehicleId: V, worksiteId, occurredAt, month: occurredAt.slice(0, 7), liters: 10,
    ...(voidedAt ? { voidedAt } : {}),
  } as typeof schema.fuelEquipmentLoads.$inferInsert
}

function record(id: string, worksiteId: string, workDate: string, extra: Partial<typeof schema.mantRecords.$inferInsert> = {}) {
  return {
    id, kind: "C", vehicleId: V, equipmentSnapshot: snapshot, worksiteId, reading: 1000, unit: "km", workDate,
    registeredBy: "u-ev", executorKind: "yo", executorUserId: "u-ev", executorName: "Mecánico", signedAt: new Date().toISOString(),
    ...extra,
  } as typeof schema.mantRecords.$inferInsert
}

function workOrder(id: string, worksiteId: string, requestDate: string, status: string) {
  return {
    id, folio: `OT-${id}`, vehicleId: V, worksiteId, equipmentSnapshot: snapshot, requestDate, status,
    requestedByUserId: "u-ev", requesterName: "Solicitante", repair: true, repairDescription: "Falla",
    ...(status === "anulada" ? { voidedByUserId: "u-ev", voidedAt: new Date().toISOString(), voidReason: "Duplicada" } : {}),
  } as typeof schema.mantWorkOrders.$inferInsert
}

beforeAll(async () => {
  await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))
  const now = new Date().toISOString()
  await testDb.insert(schema.users).values({ id: "u-ev", name: "Ana", email: "ev@example.com", hashedPassword: "x" })
  await testDb.insert(schema.worksites).values([
    { id: WS.a, name: "Faena A", code: "EV-A", isActive: true, createdAt: now, updatedAt: now },
    { id: WS.b, name: "Faena B", code: "EV-B", isActive: true, createdAt: now, updatedAt: now },
  ])
  await testDb.insert(schema.fuelProducts).values({ id: "prod-ev", code: "ev-diesel", name: "Diésel", category: "diesel" })
  await testDb.insert(schema.fuelSuppliers).values({ id: "sup-ev", name: "Copec" })
  await testDb.insert(schema.fuelEquipmentTypes).values({ id: "fet-ev", slug: "t-ev", name: "Camión", category: "truck", defaultMeterType: "odometer" })
  await testDb.insert(schema.fuelVehicles).values([
    { id: V, plate: "EV-0001", code: "KA-1", type: "Camión", equipmentTypeId: "fet-ev", worksiteId: WS.a },
    { id: V2, plate: "EV-0002", code: "KA-2", type: "Camión", equipmentTypeId: "fet-ev", worksiteId: WS.a },
  ])

  // fuel_loads: la cancelada no cuenta.
  const load = (id: string, loadDate: string, worksiteId: string, status: string) => ({
    id, loadDate, month: loadDate.slice(0, 7), serviceType: "TCT", vehicleId: V, fuelSupplierId: "sup-ev", worksiteId,
    product: "PETROLEO DIESEL", productId: "prod-ev", liters: 100, baseAmount: 1000, totalAmount: 1190, createdBy: "u-ev", status,
  }) as typeof schema.fuelLoads.$inferInsert
  await testDb.insert(schema.fuelLoads).values([
    load("fl-cancelled", "2026-03-01", WS.b, "cancelled"),
    load("fl-ok", "2026-03-02", WS.a, "registered"),
  ])

  // TAE y cargas en terreno: 23:30 hora de Chile (UTC-3 en marzo) = 02:30Z del día siguiente.
  await testDb.insert(schema.fuelTaeSubmissions).values([
    submission("sub-ok", WS.a, "2026-03-04T02:30:00.000Z"),
    submission("sub-void", WS.b, "2026-03-05T15:00:00.000Z", "voided"),
    submission("sub-novehicle", WS.b, "2026-03-06T15:00:00.000Z", "submitted", null),
    submission("sub-load-ok", WS.a, "2026-03-07T15:00:00.000Z"),
    submission("sub-load-void", WS.b, "2026-03-08T15:00:00.000Z", "voided"),
    submission("sub-legacy", WS.b, "2026-03-09T15:00:00.000Z", "voided"),
  ])
  await testDb.insert(schema.fuelEquipmentLoads).values([
    equipmentLoad("el-ok", "sub-load-ok", "field", WS.a, "2026-03-10T02:30:00.000Z"),
    equipmentLoad("el-void", "sub-load-void", "field", WS.b, "2026-03-11T15:00:00.000Z", "2026-03-12T10:00:00.000Z"),
    equipmentLoad("el-legacy", "sub-legacy", "legacy_tae", WS.b, "2026-03-13T15:00:00.000Z"),
  ])

  // Registros de mantención: anulado y fuera de faena no cuentan.
  await testDb.insert(schema.mantRecords).values([
    record("mr-ok", WS.a, "2026-03-14"),
    record("mr-voided", WS.b, "2026-03-15", { status: "anulado" }),
    record("mr-out", WS.b, "2026-03-16", { outOfWorksite: true }),
  ])
  // OT: la anulada no cuenta.
  await testDb.insert(schema.mantWorkOrders).values([
    workOrder("ot-ok", WS.a, "2026-03-17", "solicitada"),
    workOrder("ot-void", WS.b, "2026-03-18", "anulada"),
  ])

  // Un consumo del proveedor (Copec) en la otra faena: NO es evidencia.
  await testDb.insert(schema.fuelImportBatches).values({
    id: "batch-ev", worksiteId: WS.b, fuente: "copec", periodoDesde: "2026-03-01", periodoHasta: "2026-03-31",
    archivoNombre: "a.xlsx", hashArchivo: "h-ev", importadoPor: "u-ev",
  })
  await testDb.insert(schema.fuelConsumptionRecords).values({
    id: "cr-ev", batchId: "batch-ev", worksiteId: WS.b, vehicleId: V, patente: "EV-0001", cantidadUnidad: 300, monto: 300000,
    periodoDesde: "2026-03-01", periodoHasta: "2026-03-31", fuente: "copec",
  })

  // Auditoría: sólo el cambio de faena cuenta, en la faena nueva y el día chileno del cambio.
  const audit = (id: string, entityType: string, oldW: string | null, newW: string | null, createdAt: string) => ({
    id, userId: "u-ev", action: "update", entityType, entityId: V,
    oldState: oldW ? JSON.stringify({ worksiteId: oldW, notes: "a" }) : JSON.stringify({ notes: "a" }),
    newState: newW ? JSON.stringify({ worksiteId: newW, notes: "b" }) : JSON.stringify({ notes: "b" }),
    createdAt,
  }) as typeof schema.auditLog.$inferInsert
  await testDb.insert(schema.auditLog).values([
    audit("au-move", "fuel_vehicle", WS.a, WS.b, "2026-03-20T02:30:00.000Z"),
    audit("au-same", "fuel_vehicle", WS.a, WS.a, "2026-03-21T15:00:00.000Z"),
    audit("au-other", "fuel_vehicle", null, null, "2026-03-22T15:00:00.000Z"),
    audit("au-mant", "mant_equipment", WS.b, WS.a, "2026-03-23T15:00:00.000Z"),
    audit("au-type", "worker", WS.a, WS.b, "2026-03-24T15:00:00.000Z"),
  ])
}, 60_000)

const summary = (items: Array<{ kind: string; day: string; worksiteId: string }>) =>
  items.map((item) => `${item.kind}|${item.day}|${item.worksiteId}`).sort()

describe("loadStayEvidence", () => {
  it("sólo trae evidencia válida, de las fuentes admitidas, con el día chileno", async () => {
    const evidence = await loadStayEvidence(testDb)
    expect(summary(evidence.get(V) ?? [])).toEqual([
      `auditoria|2026-03-19|${WS.b}`, // 23:30 de Chile del 19 (02:30Z del 20)
      `auditoria|2026-03-23|${WS.a}`,
      `carga|2026-03-02|${WS.a}`,
      `carga_terreno|2026-03-09|${WS.a}`,
      `ot|2026-03-17|${WS.a}`,
      `registro_mantencion|2026-03-14|${WS.a}`,
      `tae|2026-03-03|${WS.a}`, // 23:30 de Chile del 3 (02:30Z del 4)
      `tae|2026-03-07|${WS.a}`,
    ].sort())
  })

  it("no usa los consumos del proveedor ni las cargas legadas o anuladas", async () => {
    const evidence = (await loadStayEvidence(testDb)).get(V) ?? []
    const refs = evidence.map((item) => item.ref).join(" ")
    expect(refs).not.toContain("cr-ev")
    expect(refs).not.toContain("el-legacy")
    expect(refs).not.toContain("el-void")
    expect(refs).not.toContain("fl-cancelled")
    expect(refs).not.toContain("sub-void")
    expect(refs).not.toContain("sub-novehicle")
    expect(refs).not.toContain("mr-voided")
    expect(refs).not.toContain("mr-out")
    expect(refs).not.toContain("ot-void")
    expect(refs).not.toContain("au-same")
    expect(refs).not.toContain("au-other")
    expect(refs).not.toContain("au-type")
  })

  it("filtra por vehículos y no inventa entradas para los que no tienen evidencia", async () => {
    expect((await loadStayEvidence(testDb, [V2])).size).toBe(0)
    expect((await loadStayEvidence(testDb, [V])).get(V)?.length).toBeGreaterThan(0)
  })
})
