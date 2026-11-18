import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { eq, sql } from "drizzle-orm"
import { beforeAll, describe, expect, it, vi } from "vitest"
import * as schema from "@/db/schema"
import type { DB } from "@/db"
import { migratePGlite } from "@/lib/testing/pglite-migrate"
import { runStayReconstruction, STAY_AUDIT_REASON } from "@/lib/fleet/stay-reconstruction-run"
import { buildStayReportWorkbook, STAY_REPORT_SHEETS } from "@/lib/fleet/stay-reconstruction-report"

/**
 * El orquestador de la reconstrucción contra Postgres de verdad: en seco no escribe
 * nada; con `apply` escribe la cadena confiable (con su auditoría), deja lo dudoso en
 * «Por confirmar» y salta al equipo que ya tiene un traslado; y re-ejecutarlo no
 * cambia nada.
 */

const pg = new PGlite()
const testDb = drizzle(pg, { schema }) as unknown as DB
const g = globalThis as typeof globalThis & { __db?: DB }
g.__db = testDb
vi.mock("@/db", () => ({ get db() { return g.__db } }))
vi.mock("server-only", () => ({}))

const WS = { a: "ws-rr-a", b: "ws-rr-b" } as const
const V = {
  move: "veh-rr-move",       // A → B el 8-mar: confiable
  quiet: "veh-rr-quiet",     // sin evidencia
  wide: "veh-rr-wide",       // A → B con 61 días sin evidencia: por confirmar
  transfer: "veh-rr-transfer", // ya tiene un traslado
} as const

let loadSeq = 0
async function carga(vehicleId: string, day: string, worksiteId: string) {
  loadSeq += 1
  await testDb.insert(schema.fuelLoads).values({
    id: `fl-rr-${loadSeq}`, loadDate: day, month: day.slice(0, 7), serviceType: "TCT", vehicleId, fuelSupplierId: "sup-rr",
    worksiteId, product: "PETROLEO DIESEL", productId: "prod-rr", liters: 100, baseAmount: 1000, totalAmount: 1190, createdBy: "u-rr",
  })
}

const stayRows = (vehicleId: string) => testDb.select().from(schema.fuelVehicleWorksiteIntervals)
  .where(eq(schema.fuelVehicleWorksiteIntervals.vehicleId, vehicleId))
  .orderBy(sql`${schema.fuelVehicleWorksiteIntervals.startedOn} nulls first`)
const auditRows = () => testDb.select().from(schema.auditLog).where(eq(schema.auditLog.entityType, "fuel_vehicle_worksite_intervals"))
const reconstructionCount = async () =>
  (await testDb.select().from(schema.fuelVehicleWorksiteIntervals).where(eq(schema.fuelVehicleWorksiteIntervals.source, "reconstruccion"))).length

beforeAll(async () => {
  await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))
  const now = new Date().toISOString()
  await testDb.insert(schema.users).values({ id: "u-rr", name: "Ana Pérez", email: "rr@example.com", hashedPassword: "x" })
  await testDb.insert(schema.worksites).values([
    { id: WS.a, name: "Faena Ñandú", code: "RR-A", isActive: true, createdAt: now, updatedAt: now },
    { id: WS.b, name: "Faena B", code: "RR-B", isActive: true, createdAt: now, updatedAt: now },
  ])
  await testDb.insert(schema.fuelProducts).values({ id: "prod-rr", code: "rr-diesel", name: "Diésel", category: "diesel" })
  await testDb.insert(schema.fuelSuppliers).values({ id: "sup-rr", name: "Copec" })
  await testDb.insert(schema.fuelEquipmentTypes).values({ id: "fet-rr", slug: "t-rr", name: "Camión", category: "truck", defaultMeterType: "odometer" })
  const vehicle = (id: string, plate: string, code: string, worksiteId: string) => ({
    id, plate, code, type: "Camión", equipmentTypeId: "fet-rr", worksiteId, fileName: "x", filePath: "x",
  })
  await testDb.insert(schema.fuelVehicles).values([
    vehicle(V.move, "RR-0001", "KA-1", WS.b),
    vehicle(V.quiet, "RR-0002", "KA-2", WS.a),
    vehicle(V.wide, "RR-0003", "KA-3", WS.b),
    vehicle(V.transfer, "RR-0004", "KA-4", WS.a),
  ])

  await carga(V.move, "2026-03-01", WS.a)
  await carga(V.move, "2026-03-05", WS.a)
  await carga(V.move, "2026-03-08", WS.b)
  await carga(V.move, "2026-03-20", WS.b)
  await carga(V.wide, "2026-03-01", WS.a)
  await carga(V.wide, "2026-05-01", WS.b)
  await carga(V.transfer, "2026-03-02", WS.a)

  // El equipo `transfer` pasó a B el 15-mar por un traslado de verdad.
  await testDb.insert(schema.fleetTransfers).values({
    id: "tr-rr", folio: "TR-9001", effectiveDate: "2026-03-15", toWorksiteId: WS.b, reason: "Refuerzo de la faena B", authorizedBy: "Gerencia", createdBy: "u-rr",
  })
  await testDb.insert(schema.fleetTransferItems).values({ id: "tri-rr", transferId: "tr-rr", vehicleId: V.transfer, fromWorksiteId: WS.a })
  await testDb.transaction(async (tx) => {
    await tx.update(schema.fuelVehicleWorksiteIntervals).set({ endedOn: "2026-03-14" })
      .where(sql`${schema.fuelVehicleWorksiteIntervals.vehicleId} = ${V.transfer} AND ${schema.fuelVehicleWorksiteIntervals.endedOn} IS NULL`)
    await tx.insert(schema.fuelVehicleWorksiteIntervals).values({
      id: "st-rr-tr", vehicleId: V.transfer, worksiteId: WS.b, startedOn: "2026-03-15", source: "traslado", transferId: "tr-rr",
    })
    await tx.update(schema.fuelVehicles).set({ worksiteId: WS.b }).where(eq(schema.fuelVehicles.id, V.transfer))
  })
}, 60_000)

describe("runStayReconstruction", () => {
  const snapshots = [
    { date: "2026-03-02", plate: "rr 0001", worksiteName: "faena ñandu" }, // calza (patente y faena normalizadas) y confirma
    { date: "2026-03-02", plate: "ZZ-9999", worksiteName: "Faena B" },      // sin equipo
    { date: "2026-03-02", code: "KA-1", worksiteName: "Faena inexistente" }, // sin faena
  ]

  it("en seco clasifica a cada equipo y no escribe nada", async () => {
    const beforeStays = (await testDb.select().from(schema.fuelVehicleWorksiteIntervals)).length
    const result = await runStayReconstruction(testDb, { snapshots })

    expect(result.dryRun).toBe(true)
    expect(result.vehicles).toBe(4)
    expect(result.applied.map((v) => v.code)).toEqual(["KA-1"])
    expect(result.applied[0]!.stays).toEqual([
      expect.objectContaining({ worksite: "Faena Ñandú", startedOn: null, endedOn: "2026-03-07" }),
      expect.objectContaining({ worksite: "Faena B", startedOn: "2026-03-08", endedOn: null }),
    ])
    expect(result.toConfirm.map((v) => v.code)).toEqual(["KA-3"])
    expect(result.toConfirm[0]!.pending[0]).toMatchObject({ reason: "ventana_amplia", fromWorksite: "Faena Ñandú", toWorksite: "Faena B", gapDays: 61 })
    // El detalle sale con nombres de faena, no con ids.
    expect(result.toConfirm[0]!.pending[0]!.detail).toContain("Faena Ñandú")
    expect(result.toConfirm[0]!.pending[0]!.detail).not.toContain(WS.a)
    expect(result.noEvidence.map((v) => v.code)).toEqual(["KA-2"])
    expect(result.skippedTransfers.map((v) => v.code)).toEqual(["KA-4"])
    expect(result.unmatched.map((row) => row.why)).toEqual(["No hay equipo con esa patente ni ese código", "La faena no existe"])
    expect(result.unchanged).toBe(1) // KA-2: ya tiene su única estadía
    expect(result.written).toBe(0)

    expect((await testDb.select().from(schema.fuelVehicleWorksiteIntervals)).length).toBe(beforeStays)
    expect(await reconstructionCount()).toBe(0)
    expect(await auditRows()).toHaveLength(0)
  })

  it("el informe tiene las hojas pedidas, con fechas de Excel", async () => {
    const workbook = buildStayReportWorkbook(await runStayReconstruction(testDb, { snapshots }))
    expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual([
      STAY_REPORT_SHEETS.applied, STAY_REPORT_SHEETS.toConfirm, STAY_REPORT_SHEETS.noEvidence, STAY_REPORT_SHEETS.skipped, STAY_REPORT_SHEETS.unmatched,
    ])
    const applied = workbook.getWorksheet("Se aplica")!
    expect(applied.rowCount).toBe(3) // encabezado + 2 estadías
    expect(applied.getRow(3).getCell(5).value).toEqual(new Date("2026-03-08T00:00:00Z"))
    expect(workbook.getWorksheet("Por confirmar")!.rowCount).toBe(2)
    expect(workbook.getWorksheet("Saltados (con traslado)")!.rowCount).toBe(2)
  })

  it("con apply escribe la cadena confiable con su auditoría, y deja lo demás intacto", async () => {
    const result = await runStayReconstruction(testDb, { apply: true, snapshots, actor: { userId: "u-rr", email: "rr@example.com" } })
    expect(result.dryRun).toBe(false)
    expect(result.written).toBe(1)
    expect(result.failed).toEqual([])

    const moved = await stayRows(V.move)
    expect(moved.map((row) => [row.worksiteId, row.startedOn, row.endedOn, row.source])).toEqual([
      [WS.a, null, "2026-03-07", "reconstruccion"],
      [WS.b, "2026-03-08", null, "reconstruccion"],
    ])
    expect(moved[1]!.evidence).toContain("carga")

    const [vehicle] = await testDb.select().from(schema.fuelVehicles).where(eq(schema.fuelVehicles.id, V.move))
    expect(vehicle!.worksiteId).toBe(WS.b)

    const audits = await auditRows()
    expect(audits).toHaveLength(1)
    expect(audits[0]).toMatchObject({ action: "update", entityId: V.move, reason: STAY_AUDIT_REASON, userId: "u-rr", worksiteId: WS.b })
    expect(JSON.parse(audits[0]!.newState!).stays).toHaveLength(2)
    expect(JSON.parse(audits[0]!.oldState!).stays).toHaveLength(1)

    // Por confirmar: sigue con su única estadía de alta. Con traslado: no se tocó.
    expect((await stayRows(V.wide)).map((row) => row.source)).toEqual(["alta"])
    expect((await stayRows(V.transfer)).map((row) => [row.worksiteId, row.startedOn, row.endedOn, row.source])).toEqual([
      [WS.a, null, "2026-03-14", "alta"],
      [WS.b, "2026-03-15", null, "traslado"],
    ])
  })

  it("re-ejecutarlo no cambia nada ni duplica la auditoría", async () => {
    const again = await runStayReconstruction(testDb, { apply: true, snapshots })
    expect(again.written).toBe(0)
    expect(again.applied).toEqual([])
    expect(again.unchanged).toBe(2) // KA-1 (ya reconstruido) y KA-2
    expect(await auditRows()).toHaveLength(1)
    expect(await reconstructionCount()).toBe(2)
  })

  it("acotado a un equipo, sólo ve ese equipo", async () => {
    const result = await runStayReconstruction(testDb, { vehicleIds: [V.quiet] })
    expect(result.vehicles).toBe(1)
    expect(result.noEvidence.map((v) => v.code)).toEqual(["KA-2"])
  })
})

/**
 * Un traslado anulado no deja rastro en el recorrido (la anulación borra su
 * estadía), pero sí deja dos auditorías: la del traslado (A → B, fechada el día
 * en que se REGISTRÓ) y la de la anulación (B → A). Contadas como evidencia, la
 * reconstrucción inventaba una estadía en B. El equipo aparece en un traslado
 * registrado, así que se salta, y esas auditorías no son evidencia.
 */
describe("runStayReconstruction con un traslado anulado", () => {
  const VOIDED = "veh-rr-voided"
  const TODAY = "2026-11-18"
  const actor = { userId: "u-rr", email: "rr@example.com", scope: "all" as const }

  beforeAll(async () => {
    await testDb.insert(schema.fuelVehicles).values({
      id: VOIDED, plate: "RR-0005", code: "KA-5", type: "Camión", equipmentTypeId: "fet-rr", worksiteId: WS.a,
    })
    await carga(VOIDED, "2026-10-20", WS.a)
    await carga(VOIDED, "2026-11-05", WS.a)
    const { transferVehicles, voidTransfer } = await import("@/lib/services/fleet-transfers")
    const made = await transferVehicles(actor, {
      toWorksiteId: WS.b, effectiveDate: "2026-11-10", reason: "Refuerzo de la faena B", authorizedBy: "Gerencia", vehicleIds: [VOIDED],
    }, TODAY)
    if (!made.ok) throw new Error(`setup: ${made.message}`)
    const voided = await voidTransfer(actor, { transferId: made.data.transferId, reason: "Se registró por error" }, TODAY)
    if (!voided.ok) throw new Error(`setup: ${voided.message}`)
  })

  it("no cuenta las auditorías del servicio de traslados como evidencia", async () => {
    const { loadStayEvidence } = await import("@/lib/fleet/stay-evidence")
    const evidence = (await loadStayEvidence(testDb, [VOIDED])).get(VOIDED) ?? []
    expect(evidence.map((item) => item.kind)).toEqual(["carga", "carga"])
    expect(evidence.every((item) => item.worksiteId === WS.a)).toBe(true)
  })

  it("lo salta con --apply aunque ya no tenga estadías de traslado, y no le escribe nada", async () => {
    expect((await stayRows(VOIDED)).map((row) => [row.worksiteId, row.startedOn, row.endedOn, row.source])).toEqual([
      [WS.a, null, null, "alta"],
    ])
    const result = await runStayReconstruction(testDb, { apply: true, vehicleIds: [VOIDED] })
    expect(result.applied).toEqual([])
    expect(result.toConfirm).toEqual([])
    expect(result.written).toBe(0)
    expect(result.skippedTransfers).toEqual([expect.objectContaining({
      vehicleId: VOIDED,
      note: "Tiene 1 traslado registrado (anulado): su recorrido lo fija la pantalla de traslados, no se reconstruye",
    })])
    expect((await stayRows(VOIDED)).map((row) => [row.worksiteId, row.startedOn, row.endedOn, row.source])).toEqual([
      [WS.a, null, null, "alta"],
    ])
  })
})
