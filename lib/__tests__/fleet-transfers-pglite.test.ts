import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { and, eq, sql } from "drizzle-orm"
import { beforeAll, describe, expect, it, vi } from "vitest"
import * as schema from "@/db/schema"
import type { DB } from "@/db"
import { migratePGlite } from "@/lib/testing/pglite-migrate"
import { setVehicleWorksiteForTest } from "@/lib/testing/fleet-stays"

/**
 * El servicio de traslado contra Postgres de verdad: la única puerta que cambia la
 * faena de un equipo, con sus estadías, asignaciones de proveedor, GPS, historial de
 * Mantención y auditoría, todo en una transacción.
 */

const pg = new PGlite()
const testDb = drizzle(pg, { schema }) as unknown as DB
const g = globalThis as typeof globalThis & { __db?: DB }
g.__db = testDb
vi.mock("@/db", () => ({ get db() { return g.__db } }))
vi.mock("server-only", () => ({}))
const recheck = vi.fn(async (month: string) => { void month; return { requested: true } })
vi.mock("@/lib/combustibles/copec-sync", () => ({ requestCopecRecheckFrom: (month: string) => recheck(month) }))

const {
  transferVehicles, transferVehiclesTx, voidTransfer, listTransfers, listTransferCandidates,
} = await import("@/lib/services/fleet-transfers")

const TODAY = "2026-11-18"
const ALL = { userId: "u-t", email: "ana@example.com", scope: "all" as const }
const ONLY_A = { userId: "u-t", email: "ana@example.com", scope: ["ws-a"] }

let seq = 0
async function newVehicle(opts: { worksiteId?: string; isActive?: boolean; code?: string } = {}): Promise<string> {
  seq += 1
  const id = `v-t-${seq}`
  await testDb.insert(schema.fuelVehicles).values({
    id, plate: `TR-${seq}`, code: opts.code ?? `KA-${seq}`, type: "Camión", equipmentTypeId: "fet-t",
    worksiteId: opts.worksiteId ?? "ws-a", isActive: opts.isActive ?? true,
  })
  return id
}

function input(vehicleIds: string[], overrides: Partial<{ toWorksiteId: string; effectiveDate: string; reason: string; authorizedBy: string }> = {}) {
  return {
    toWorksiteId: "ws-b",
    effectiveDate: "2026-11-15",
    reason: "Refuerzo de la faena Mininco",
    authorizedBy: "Gerencia",
    vehicleIds,
    ...overrides,
  }
}

async function staysOf(vehicleId: string) {
  return testDb.select({
    worksiteId: schema.fuelVehicleWorksiteIntervals.worksiteId,
    startedOn: schema.fuelVehicleWorksiteIntervals.startedOn,
    endedOn: schema.fuelVehicleWorksiteIntervals.endedOn,
  }).from(schema.fuelVehicleWorksiteIntervals)
    .where(eq(schema.fuelVehicleWorksiteIntervals.vehicleId, vehicleId))
    .orderBy(sql`${schema.fuelVehicleWorksiteIntervals.startedOn} ASC NULLS FIRST`)
}

async function worksiteOf(vehicleId: string): Promise<string> {
  const [row] = await testDb.select({ worksiteId: schema.fuelVehicles.worksiteId }).from(schema.fuelVehicles).where(eq(schema.fuelVehicles.id, vehicleId))
  return row?.worksiteId ?? ""
}

async function addMapping(vehicleId: string, worksiteId: string, effectiveFrom: string): Promise<string> {
  const id = `map-${vehicleId}`
  await testDb.insert(schema.fuelProviderMappings).values({
    id, provider: "copec", sourceAccount: "tct", externalKey: `KEY-${vehicleId}`, normalizedValue: `KEY${vehicleId}`,
    worksiteId, vehicleId, decidedBy: "u-t", reason: "Alta", effectiveFrom,
  })
  return id
}

async function addGps(vehicleId: string, worksiteId: string) {
  await testDb.insert(schema.fleetGpsSyncRuns).values({ id: `run-${vehicleId}`, provider: "onway", trigger: "manual", status: "success" })
  await testDb.insert(schema.fleetGpsTrips).values([
    { id: `trip-a-${vehicleId}`, externalDeviceId: `d-${vehicleId}`, externalTripKey: "a", vehicleId, worksiteId, startedAt: "2026-11-15T02:30:00Z", endedAt: "2026-11-15T03:00:00Z", distanceKm: 5 },
    { id: `trip-b-${vehicleId}`, externalDeviceId: `d-${vehicleId}`, externalTripKey: "b", vehicleId, worksiteId, startedAt: "2026-11-15T04:00:00Z", endedAt: "2026-11-15T05:00:00Z", distanceKm: 7 },
  ])
  await testDb.insert(schema.fleetGpsLatestPositions).values({
    id: `lat-${vehicleId}`, externalDeviceId: `d-${vehicleId}`, externalGroupId: "g", vehicleId, worksiteId,
    sourcePlate: "X", normalizedPlate: "X", latitude: -37, longitude: -72, speedKph: 0, headingDegrees: 0, ignition: false,
    observedAt: "2026-11-17T12:00:00Z", syncRunId: `run-${vehicleId}`,
  })
}

async function tripWorksites(vehicleId: string): Promise<Record<string, string | null>> {
  const rows = await testDb.select({ key: schema.fleetGpsTrips.externalTripKey, worksiteId: schema.fleetGpsTrips.worksiteId })
    .from(schema.fleetGpsTrips).where(eq(schema.fleetGpsTrips.vehicleId, vehicleId))
  return Object.fromEntries(rows.map((row) => [row.key, row.worksiteId]))
}

beforeAll(async () => {
  await migratePGlite(pg, "db/migrations")
  const now = new Date().toISOString()
  await testDb.insert(schema.worksites).values([
    { id: "ws-a", name: "Santa Fe", code: "FN-A", isActive: true, createdAt: now, updatedAt: now },
    { id: "ws-b", name: "Mininco", code: "FN-B", isActive: true, createdAt: now, updatedAt: now },
    { id: "ws-c", name: "Cerrada", code: "FN-C", isActive: false, createdAt: now, updatedAt: now },
  ])
  await testDb.insert(schema.fuelEquipmentTypes).values({ id: "fet-t", slug: "t-t", name: "Camión", category: "truck", defaultMeterType: "odometer" })
  await testDb.insert(schema.users).values({ id: "u-t", name: "Ana Pérez", email: "ana@example.com", hashedPassword: "x" })
  await testDb.insert(schema.mantBrands).values({ id: "br-t", name: "Volvo", nameKey: "volvo" })
})

describe("traslado de equipos", () => {
  it("traslada dos equipos y deja recorrido, faena y folio", async () => {
    const a = await newVehicle()
    const b = await newVehicle()
    const result = await transferVehicles(ALL, input([a, b]), TODAY)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data.folio).toBe("TR-0001")
    expect(result.data.moved).toBe(2)
    expect(result.message).toBe("TR-0001: 2 equipos pasan a Mininco desde el 15-11-2026.")
    for (const id of [a, b]) {
      expect(await staysOf(id)).toEqual([
        { worksiteId: "ws-a", startedOn: null, endedOn: "2026-11-14" },
        { worksiteId: "ws-b", startedOn: "2026-11-15", endedOn: null },
      ])
      expect(await worksiteOf(id)).toBe("ws-b")
    }
  })

  it("todo o nada: un equipo inválido no mueve a ninguno", async () => {
    const before = (await testDb.select().from(schema.fleetTransfers)).length
    const ok = await newVehicle()
    const baja = await newVehicle({ isActive: false })
    const result = await transferVehicles(ALL, input([ok, baja]), TODAY)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.message).toBe("Revisa los equipos marcados.")
    expect(result.rowErrors).toEqual({ [baja]: "Está dado de baja." })
    expect(await worksiteOf(ok)).toBe("ws-a")
    expect(await staysOf(ok)).toHaveLength(1)
    expect((await testDb.select().from(schema.fleetTransfers)).length).toBe(before)
  })

  it("rechaza destino inactivo y fuera de alcance", async () => {
    const v = await newVehicle()
    const inactive = await transferVehicles(ALL, input([v], { toWorksiteId: "ws-c" }), TODAY)
    expect(inactive.ok === false && inactive.fieldErrors?.toWorksiteId).toBe("Esa faena no existe o está inactiva.")
    const missing = await transferVehicles(ALL, input([v], { toWorksiteId: "nope" }), TODAY)
    expect(missing.ok === false && missing.fieldErrors?.toWorksiteId).toBe("Esa faena no existe o está inactiva.")
    const outOfScope = await transferVehicles(ONLY_A, input([v]), TODAY)
    expect(outOfScope.ok === false && outOfScope.fieldErrors?.toWorksiteId).toBe("No administras la faena de destino.")
    expect(await worksiteOf(v)).toBe("ws-a")
  })

  it("rechaza equipos fuera de alcance, texto corto y lista vacía o excesiva", async () => {
    const inB = await newVehicle({ worksiteId: "ws-b" })
    const scoped = await transferVehicles({ ...ALL, scope: ["ws-a", "ws-c"] }, input([inB], { toWorksiteId: "ws-a" }), TODAY)
    expect(scoped.ok === false && scoped.rowErrors?.[inB]).toBe("Es de Mininco, una faena que no administras.")
    const short = await transferVehicles(ALL, input([inB], { reason: "corto", authorizedBy: "ab" }), TODAY)
    expect(short.ok).toBe(false)
    if (!short.ok) expect(Object.keys(short.fieldErrors ?? {}).sort()).toEqual(["authorizedBy", "reason"])
    const empty = await transferVehicles(ALL, input([]), TODAY)
    expect(empty.ok === false && empty.fieldErrors?.vehicleIds).toBe("Marca al menos un equipo.")
    const many = await transferVehicles(ALL, input(Array.from({ length: 101 }, (_, i) => `x-${i}`)), TODAY)
    expect(many.ok === false && many.fieldErrors?.vehicleIds).toBe("Máximo 100 equipos por traslado.")
  })

  it("rechaza fecha anterior al 1 del mes anterior y anterior a la llegada", async () => {
    const v = await newVehicle()
    const tooOld = await transferVehicles(ALL, input([v], { effectiveDate: "2026-09-30" }), TODAY)
    expect(tooOld.ok === false && tooOld.fieldErrors?.effectiveDate).toBe("La fecha no puede ser anterior al 01-10-2026.")
    const future = await transferVehicles(ALL, input([v], { effectiveDate: "2026-11-19" }), TODAY)
    expect(future.ok === false && future.fieldErrors?.effectiveDate).toBe("La fecha no puede ser posterior a hoy.")

    const arrived = await newVehicle()
    await setVehicleWorksiteForTest(testDb, arrived, "ws-a", "2026-11-10")
    const before = await transferVehicles(ALL, input([arrived], { effectiveDate: "2026-11-10" }), TODAY)
    expect(before.ok === false && before.rowErrors?.[arrived]).toBe("Llegó a su faena actual el 10-11-2026: la fecha debe ser posterior.")
    expect(await worksiteOf(arrived)).toBe("ws-a")
  })

  it("stale candidate: un segundo traslado del mismo equipo ve su estado nuevo", async () => {
    const v = await newVehicle()
    const first = await transferVehicles(ALL, input([v]), TODAY)
    expect(first.ok).toBe(true)
    // La segunda persona todavía ve el equipo en Santa Fe.
    const second = await transferVehicles(ALL, input([v]), TODAY)
    expect(second.ok).toBe(false)
    if (!second.ok) {
      expect(second.message).toBe("Revisa los equipos marcados.")
      expect(second.rowErrors?.[v]).toBe("Ya está en Mininco.")
    }
    const back = await transferVehicles(ALL, input([v], { toWorksiteId: "ws-a", effectiveDate: "2026-11-15" }), TODAY)
    expect(back.ok === false && back.rowErrors?.[v]).toMatch(/la fecha debe ser posterior\.$/)
    expect(await worksiteOf(v)).toBe("ws-b")
    expect(await staysOf(v)).toHaveLength(2)
  })

  it("dos traslados concurrentes del mismo equipo: uno gana y el otro ve un error legible", async () => {
    const v = await newVehicle()
    const [r1, r2] = await Promise.all([
      transferVehicles(ALL, input([v]), TODAY),
      transferVehicles(ALL, input([v], { toWorksiteId: "ws-b", effectiveDate: "2026-11-16" }), TODAY),
    ])
    const outcomes = [r1, r2]
    expect(outcomes.filter((r) => r.ok)).toHaveLength(1)
    const loser = outcomes.find((r) => !r.ok)
    expect(loser && !loser.ok && loser.message).toBeTruthy()
    expect(loser && !loser.ok && loser.message).not.toMatch(/FLEET_STAY|Failed query/)
    expect(await worksiteOf(v)).toBe("ws-b")
  })

  it("mueve las asignaciones de proveedor desde la fecha", async () => {
    const v = await newVehicle()
    const mappingId = await addMapping(v, "ws-a", "2026-01-01")
    expect((await transferVehicles(ALL, input([v]), TODAY)).ok).toBe(true)
    const rows = await testDb.select().from(schema.fuelProviderMappings).where(eq(schema.fuelProviderMappings.vehicleId, v))
    const old = rows.find((r) => r.id === mappingId)!
    expect(old).toMatchObject({ worksiteId: "ws-a", isActive: false, effectiveTo: "2026-11-14" })
    const next = rows.find((r) => r.isActive)!
    expect(next).toMatchObject({ worksiteId: "ws-b", effectiveFrom: "2026-11-15" })
  })

  it("re-estampa GPS desde la medianoche chilena", async () => {
    const v = await newVehicle()
    await addGps(v, "ws-a")
    expect((await transferVehicles(ALL, input([v]), TODAY)).ok).toBe(true)
    // 23:30 del 14 en Chile sigue en la faena vieja; 01:00 del 15 pasa a la nueva.
    expect(await tripWorksites(v)).toEqual({ a: "ws-a", b: "ws-b" })
    const [latest] = await testDb.select({ worksiteId: schema.fleetGpsLatestPositions.worksiteId }).from(schema.fleetGpsLatestPositions).where(eq(schema.fleetGpsLatestPositions.vehicleId, v))
    expect(latest?.worksiteId).toBe("ws-b")
  })

  it("equipo sin ficha de Mantención no escribe historial y no falla", async () => {
    const v = await newVehicle()
    const result = await transferVehicles(ALL, input([v]), TODAY)
    expect(result.ok).toBe(true)
    expect(await testDb.select().from(schema.mantEquipmentHistory).where(eq(schema.mantEquipmentHistory.vehicleId, v))).toHaveLength(0)
  })

  it("equipo con ficha escribe «Trasladado a Mininco…»", async () => {
    const v = await newVehicle()
    await testDb.insert(schema.mantEquipmentProfiles).values({ vehicleId: v, brandId: "br-t" })
    const result = await transferVehicles(ALL, input([v]), TODAY)
    expect(result.ok).toBe(true)
    const history = await testDb.select().from(schema.mantEquipmentHistory).where(eq(schema.mantEquipmentHistory.vehicleId, v))
    expect(history).toHaveLength(1)
    expect(history[0]).toMatchObject({
      action: "update",
      summary: "Trasladado a Mininco desde el 15-11-2026 (TR-" + (result.ok ? result.data.folio.slice(3) : "") + ")",
      changes: { Faena: { from: "Santa Fe", to: "Mininco" } },
    })
  })

  it("auditoría: una fila por equipo y una del traslado", async () => {
    const v = await newVehicle()
    const result = await transferVehicles(ALL, input([v]), TODAY)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const vehicleAudit = await testDb.select().from(schema.auditLog).where(and(eq(schema.auditLog.entityType, "fuel_vehicle"), eq(schema.auditLog.entityId, v)))
    expect(vehicleAudit).toHaveLength(1)
    expect(vehicleAudit[0]).toMatchObject({ action: "update", reason: "Refuerzo de la faena Mininco", worksiteId: "ws-b" })
    expect(JSON.parse(vehicleAudit[0]?.oldState ?? "null")).toMatchObject({ worksiteId: "ws-a" })
    expect(JSON.parse(vehicleAudit[0]?.newState ?? "null")).toMatchObject({ worksiteId: "ws-b" })
    const transferAudit = await testDb.select().from(schema.auditLog).where(and(eq(schema.auditLog.entityType, "fleet_transfer"), eq(schema.auditLog.entityId, result.data.transferId)))
    expect(transferAudit).toHaveLength(1)
    expect(transferAudit[0]).toMatchObject({ action: "create", entityCode: result.data.folio })
  })

  it("copecRecheckFrom sólo si la fecha es del mes anterior, y pide la revisión sin fallar si ésta falla", async () => {
    recheck.mockClear()
    const old = await newVehicle()
    const r1 = await transferVehicles(ALL, input([old], { effectiveDate: "2026-10-20" }), TODAY)
    expect(r1.ok && r1.data.copecRecheckFrom).toBe("2026-10-01")
    expect(recheck).toHaveBeenCalledWith("2026-10-01")
    const current = await newVehicle()
    const r2 = await transferVehicles(ALL, input([current], { effectiveDate: "2026-11-15" }), TODAY)
    expect(r2.ok && r2.data.copecRecheckFrom).toBeNull()
    expect(recheck).toHaveBeenCalledTimes(1)
    recheck.mockRejectedValueOnce(new Error("Copec caído"))
    const failing = await newVehicle()
    const r3 = await transferVehicles(ALL, input([failing], { effectiveDate: "2026-10-25" }), TODAY)
    expect(r3.ok).toBe(true)
  })

  it("avisa de los consumos importados a mano posteriores a la fecha, no de los de Copec", async () => {
    const v = await newVehicle()
    const now = new Date().toISOString()
    await testDb.insert(schema.fuelImportBatches).values([
      { id: `b-man-${v}`, worksiteId: "ws-a", fuente: "Planilla manual", periodoDesde: "2026-11-01", periodoHasta: "2026-11-30", archivoNombre: "x", hashArchivo: `h1-${v}`, importadoPor: "u-t", createdAt: now, updatedAt: now },
      { id: `b-cop-${v}`, worksiteId: "ws-a", fuente: "Copec TCT Diesel", periodoDesde: "2026-11-01", periodoHasta: "2026-11-30", archivoNombre: "y", hashArchivo: `h2-${v}`, importadoPor: "u-t", createdAt: now, updatedAt: now },
    ])
    const base = { worksiteId: "ws-a", vehicleId: v, patente: "X", cantidadUnidad: 10, monto: 1000, periodoDesde: "2026-11-01", periodoHasta: "2026-11-30" }
    await testDb.insert(schema.fuelConsumptionRecords).values([
      { id: `r1-${v}`, batchId: `b-man-${v}`, ...base },
      { id: `r2-${v}`, batchId: `b-cop-${v}`, ...base },
      { id: `r3-${v}`, batchId: `b-man-${v}`, ...base, periodoDesde: "2026-10-01", periodoHasta: "2026-10-31" },
    ])
    const result = await transferVehicles(ALL, input([v]), TODAY)
    expect(result.ok && result.data.manualImportNotice).toBe("1 consumo importado a mano posterior al 15-11-2026 sigue en Santa Fe: revisa ese lote.")
    const clean = await newVehicle()
    const r2 = await transferVehicles(ALL, input([clean]), TODAY)
    expect(r2.ok && r2.data.manualImportNotice).toBeNull()
  })

  it("lista candidatos con estadía, OT abierta y asignaciones, dentro del alcance", async () => {
    const v = await newVehicle({ worksiteId: "ws-b", code: "CAND-1" })
    await addMapping(v, "ws-b", "2026-01-01")
    const now = new Date().toISOString()
    const wo = { vehicleId: v, worksiteId: "ws-b", equipmentSnapshot: {} as never, repair: true, repairDescription: "Falla del motor", requestDate: "2026-11-01", requestedByUserId: "u-t", requesterName: "Ana", createdAt: now, updatedAt: now }
    // La OT abierta más reciente: la anulada, aunque sea más nueva, no cuenta.
    await testDb.insert(schema.mantWorkOrders).values([
      { id: `wo1-${v}`, folio: `OT-1-${v}`, status: "solicitada", ...wo, createdAt: "2026-11-02T00:00:00Z" },
      { id: `wo2-${v}`, folio: `OT-2-${v}`, status: "asignada", assignedToUserId: "u-t", ...wo, createdAt: "2026-11-10T00:00:00Z" },
      { id: `wo3-${v}`, folio: `OT-3-${v}`, status: "anulada", voidedAt: now, voidedByUserId: "u-t", voidReason: "Duplicada", ...wo, createdAt: "2026-11-12T00:00:00Z" },
    ])
    const candidates = await listTransferCandidates("all")
    const mine = candidates.find((c) => c.vehicleId === v)
    expect(mine).toMatchObject({
      code: "CAND-1", typeName: "Camión", worksiteId: "ws-b", worksiteName: "Mininco",
      stayStartedOn: null, openWorkOrderFolio: `OT-2-${v}`, providerMappingCount: 1,
    })
    const baja = await newVehicle({ isActive: false })
    expect((await listTransferCandidates("all")).some((c) => c.vehicleId === baja)).toBe(false)
    expect((await listTransferCandidates(["ws-a"])).some((c) => c.vehicleId === v)).toBe(false)
    expect(await listTransferCandidates([])).toEqual([])
  })

  it("el traslado dentro de la transacción de otro revierte con ella", async () => {
    const v = await newVehicle()
    await expect(testDb.transaction(async (tx) => {
      const out = await transferVehiclesTx(tx, ALL, input([v]), TODAY)
      expect(out.ok).toBe(true)
      throw new Error("rollback")
    })).rejects.toThrow("rollback")
    expect(await worksiteOf(v)).toBe("ws-a")
    expect(await staysOf(v)).toHaveLength(1)
  })
})

describe("anular un traslado", () => {
  it("anular devuelve todo", async () => {
    const v = await newVehicle()
    await testDb.insert(schema.mantEquipmentProfiles).values({ vehicleId: v, brandId: "br-t" })
    await addMapping(v, "ws-a", "2026-01-01")
    await addGps(v, "ws-a")
    const made = await transferVehicles(ALL, input([v]), TODAY)
    expect(made.ok).toBe(true)
    if (!made.ok) return

    const voided = await voidTransfer(ALL, { transferId: made.data.transferId, reason: "Se registró por error" }, TODAY)
    expect(voided).toEqual({ ok: true, message: `${made.data.folio} anulado.` })

    expect(await worksiteOf(v)).toBe("ws-a")
    expect(await staysOf(v)).toEqual([{ worksiteId: "ws-a", startedOn: null, endedOn: null }])
    const mappings = await testDb.select().from(schema.fuelProviderMappings).where(and(eq(schema.fuelProviderMappings.vehicleId, v), eq(schema.fuelProviderMappings.isActive, true)))
    expect(mappings).toHaveLength(1)
    expect(mappings[0]?.worksiteId).toBe("ws-a")
    expect(await tripWorksites(v)).toEqual({ a: "ws-a", b: "ws-a" })
    const [latest] = await testDb.select({ worksiteId: schema.fleetGpsLatestPositions.worksiteId }).from(schema.fleetGpsLatestPositions).where(eq(schema.fleetGpsLatestPositions.vehicleId, v))
    expect(latest?.worksiteId).toBe("ws-a")

    const [row] = await testDb.select().from(schema.fleetTransfers).where(eq(schema.fleetTransfers.id, made.data.transferId))
    expect(row?.voidedAt).not.toBeNull()
    expect(row?.voidedBy).toBe("u-t")
    expect(row?.voidReason).toBe("Se registró por error")

    const history = await testDb.select().from(schema.mantEquipmentHistory).where(eq(schema.mantEquipmentHistory.vehicleId, v))
    expect(history.map((h) => h.summary)).toContain(`Traslado ${made.data.folio} anulado: vuelve a Santa Fe`)
    const audit = await testDb.select().from(schema.auditLog).where(and(eq(schema.auditLog.entityType, "fleet_transfer"), eq(schema.auditLog.entityId, made.data.transferId)))
    expect(audit.map((a) => a.action).sort()).toEqual(["cancel", "create"])
    expect(audit.find((a) => a.action === "cancel")?.reason).toBe("Se registró por error")

    // Ya anulado, y el equipo puede volver a trasladarse con otra fecha.
    expect(await voidTransfer(ALL, { transferId: made.data.transferId, reason: "Se registró por error" }, TODAY))
      .toEqual({ ok: false, message: "Ese traslado ya está anulado." })
    expect((await transferVehicles(ALL, input([v], { effectiveDate: "2026-11-16" }), TODAY)).ok).toBe(true)
  })

  it("exige motivo, existencia y alcance", async () => {
    const v = await newVehicle()
    const made = await transferVehicles(ALL, input([v]), TODAY)
    if (!made.ok) throw new Error("setup")
    expect(await voidTransfer(ALL, { transferId: made.data.transferId, reason: "corto" }, TODAY))
      .toEqual({ ok: false, message: "Explica el motivo en al menos 10 caracteres." })
    expect(await voidTransfer(ALL, { transferId: "nope", reason: "Motivo suficiente" }, TODAY))
      .toEqual({ ok: false, message: "Ese traslado no existe." })
    expect(await voidTransfer(ONLY_A, { transferId: made.data.transferId, reason: "Motivo suficiente" }, TODAY))
      .toEqual({ ok: false, message: "No administras todas las faenas de este traslado." })
    expect(await worksiteOf(v)).toBe("ws-b")
  })

  it("no anula si hubo un traslado posterior", async () => {
    const v = await newVehicle()
    const first = await transferVehicles(ALL, input([v], { effectiveDate: "2026-11-10" }), TODAY)
    const second = await transferVehicles(ALL, input([v], { toWorksiteId: "ws-a", effectiveDate: "2026-11-15" }), TODAY)
    if (!first.ok || !second.ok) throw new Error("setup")
    const result = await voidTransfer(ALL, { transferId: first.data.transferId, reason: "Quiero deshacerlo" }, TODAY)
    expect(result).toEqual({ ok: false, message: `No se puede anular: ${(await testDb.select().from(schema.fuelVehicles).where(eq(schema.fuelVehicles.id, v)))[0]?.code} se trasladó de nuevo después (${second.data.folio}).` })
    expect(await worksiteOf(v)).toBe("ws-a")

    const rows = await listTransfers("all", { from: "2026-11-01", to: "2026-11-30" })
    expect(rows.find((r) => r.id === first.data.transferId)?.voidable).toBe(false)
    expect(rows.find((r) => r.id === second.data.transferId)?.voidable).toBe(true)
  })
})

describe("lista de traslados", () => {
  it("filtra por fecha, faena y alcance, con equipos y orígenes", async () => {
    const v = await newVehicle({ worksiteId: "ws-b" })
    const made = await transferVehicles(ALL, input([v], { toWorksiteId: "ws-a", effectiveDate: "2026-10-05" }), TODAY)
    if (!made.ok) throw new Error("setup")
    const inRange = await listTransfers("all", { from: "2026-10-01", to: "2026-10-31" })
    const row = inRange.find((r) => r.id === made.data.transferId)
    expect(row).toMatchObject({
      folio: made.data.folio, effectiveDate: "2026-10-05", toWorksiteName: "Santa Fe", reason: "Refuerzo de la faena Mininco",
      authorizedBy: "Gerencia", createdByName: "Ana Pérez", voidedAt: null, voidReason: null, voidable: true,
    })
    expect(row?.items).toEqual([{ vehicleId: v, code: expect.any(String), plate: expect.any(String), fromWorksiteId: "ws-b", fromWorksiteName: "Mininco" }])
    expect(inRange.every((r) => r.effectiveDate >= "2026-10-01" && r.effectiveDate <= "2026-10-31")).toBe(true)
    // Por faena: origen o destino.
    expect((await listTransfers("all", { from: "2026-10-01", to: "2026-10-31", worksiteId: "ws-b" })).some((r) => r.id === made.data.transferId)).toBe(true)
    expect((await listTransfers("all", { from: "2026-10-01", to: "2026-10-31", worksiteId: "ws-c" })).some((r) => r.id === made.data.transferId)).toBe(false)
    // Por alcance: visible si el destino o algún origen está en el alcance.
    expect((await listTransfers(["ws-b"], { from: "2026-10-01", to: "2026-10-31" })).some((r) => r.id === made.data.transferId)).toBe(true)
    expect((await listTransfers(["ws-c"], { from: "2026-10-01", to: "2026-10-31" })).some((r) => r.id === made.data.transferId)).toBe(false)
    expect(await listTransfers([], { from: "2026-10-01", to: "2026-10-31" })).toEqual([])
    // Fuera del rango de fechas.
    expect((await listTransfers("all", { from: "2026-11-01", to: "2026-11-30" })).some((r) => r.id === made.data.transferId)).toBe(false)
  })
})
