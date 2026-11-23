import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { beforeAll, describe, expect, it, vi } from "vitest"
import * as schema from "@/db/schema"
import type { DB } from "@/db"
import { resolveIndicatorPeriod } from "@/lib/indicators/period"
import { migratePGlite } from "@/lib/testing/pglite-migrate"
import type { MantViewer } from "@/lib/services/mantencion/access"

/**
 * «Trabajos de mantención» y el corte de los formularios (2026-12-01) contra Postgres de verdad:
 * - una OT cuenta sólo si ya entró a taller, fechada por el ingreso (hora de Chile);
 * - el historial de formularios cuenta hasta el 30-11-2026 y no desde el 01-12-2026;
 * - los registros de la plataforma cuentan desde el 01-12-2026, vigentes y sin OT, con la visibilidad de la lista;
 * - «¿hubo trabajo después del hallazgo?» es un hecho del equipo: suma los registros sin corte.
 */

const pg = new PGlite()
const testDb = drizzle(pg, { schema }) as unknown as DB
const testGlobal = globalThis as typeof globalThis & { __corteDb?: DB }
testGlobal.__corteDb = testDb
vi.mock("@/db", () => ({ get db() { return testGlobal.__corteDb }, get Tx() { return undefined } }))

const { loadFindingsWithoutWork, loadMaintenanceWork, summarizeMaintenanceWork } = await import("@/lib/services/mantencion/maintenance-work")

const TODAY = "2026-12-20"
const period = resolveIndicatorPeriod({ desde: "2026-11-01", hasta: "2026-12-31" }, TODAY)
const QUERY = { from: period.from, to: period.to, today: TODAY }

const WS = { a: "ws-cut-a", b: "ws-cut-b" } as const
const V = { a1: "v-cut-a1", a2: "v-cut-a2", a3: "v-cut-a3" } as const
const U = { actor: "u-cut-actor", mech: "u-cut-mech" } as const

const GLOBAL: MantViewer = { userId: "u-cut-viewer", email: null, permissions: ["mant:records:view_all", "mant:ot:view_all"], worksiteIds: [], isGlobal: true }
const SCOPED_A: MantViewer = { userId: "u-cut-viewer", email: null, permissions: ["mant:records:view_worksite", "mant:ot:view_worksite"], worksiteIds: [WS.a], isGlobal: false }
const SCOPED_B: MantViewer = { userId: "u-cut-viewer", email: null, permissions: ["mant:records:view_worksite", "mant:ot:view_worksite"], worksiteIds: [WS.b], isGlobal: false }

const snapshot = (code: string, plate: string) => ({ code, plate, noPlate: false, type: "Camión", brand: "Scania", model: "R450", year: 2021, worksite: "Faena A", unit: "km" as const })
const SNAP = { [V.a1]: snapshot("KA-C1", "CCCC-01"), [V.a2]: snapshot("KA-C2", "CCCC-02"), [V.a3]: snapshot("KA-C3", "CCCC-03") }

async function insertOt(id: string, vehicleId: keyof typeof SNAP | string, requestDate: string, entryAt?: string) {
  await testDb.insert(schema.mantWorkOrders).values({
    id, folio: `OT-${id}`, vehicleId, worksiteId: WS.a, equipmentSnapshot: SNAP[vehicleId as keyof typeof SNAP],
    repair: true, maintenance: false, requestDate, requestedByUserId: U.actor, requesterName: "Solicitante de Prueba",
    repairDescription: "Reparación de prueba",
    status: entryAt ? "en_ejecucion" : "solicitada",
    assignedToUserId: entryAt ? U.mech : null, assignedByUserId: entryAt ? U.mech : null, assignedAt: entryAt ?? null,
    ...(entryAt ? { workshopKind: "interno", workshopEntryAt: entryAt, estimatedDeliveryDate: "2026-12-30", startedAt: entryAt, startedByUserId: U.mech } : {}),
  })
}

async function insertHistorical(id: string, vehicleId: string, entry: string) {
  await testDb.insert(schema.mantHistoricalRecords).values({
    sourceKey: `h-${id}`, fingerprint: `fp-${id}`, sourceFile: "consolidado.xlsx", sourceSheet: "MANTENCIONES", sourceRow: 2,
    submittedAt: `${entry} 10:00:00`, worksiteText: "faena", worksiteId: WS.a, equipmentText: "KA", vehicleId, equipmentMatch: "linked",
    orderText: "", kindText: "", readingText: "", description: "Trabajo histórico", entryDate: entry, exitDate: null, hoursText: "",
    fields: [], importedBy: U.actor, sourceRecordId: `MT-${id}`, actionType: "correctiva", laborHours: null, isTest: false,
  })
}

interface RecordInput {
  id: string; kind: "P" | "C"; vehicleId: string; workDate: string; status?: "vigente" | "anulado"; workOrderId?: string
  hours?: number; external?: boolean; inWorkshop?: { entry: string; exit?: string }
}

async function insertRecord(input: RecordInput) {
  const preventive = input.kind === "P"
  await testDb.insert(schema.mantRecords).values({
    id: input.id, folio: `MR-${input.id}`, kind: input.kind, vehicleId: input.vehicleId, equipmentSnapshot: SNAP[input.vehicleId as keyof typeof SNAP],
    worksiteId: WS.a, reading: 10_000, unit: "km", workDate: input.workDate, registeredBy: U.mech,
    ...(input.external
      ? { executorKind: "externo", executorWorkshopId: "wk-cut", executorName: "Taller Externo" }
      : { executorKind: "yo", executorUserId: U.mech, executorName: "Mecánico" }),
    signedAt: `${input.workDate}T15:00:00Z`, receivedAt: `${input.workDate}T15:00:00Z`, status: input.status ?? "vigente",
    ...(input.workOrderId ? { workOrderId: input.workOrderId } : {}),
    ...(preventive ? { scheduleVersion: 1, scheduleNameSnapshot: "40.000 km", intervalValue: 40_000, suggestedIntervalValue: 40_000, notes: "Preventiva de prueba" } : {}),
  })
  if (!preventive) {
    await testDb.insert(schema.mantRecordCorrectives).values({
      recordId: input.id, workTypes: ["Motor"], oils: [], description: "Correctiva de prueba", hours: input.hours ?? 2,
      inWorkshop: !!input.inWorkshop, workshopEntryDate: input.inWorkshop?.entry ?? null, workshopReason: input.inWorkshop ? "Espera de repuestos" : null,
    })
    if (input.inWorkshop?.exit) {
      await testDb.insert(schema.mantWorkshopUpdates).values({
        id: `wu-${input.id}`, recordId: input.id, kind: "salio", exitDate: input.inWorkshop.exit, userId: U.mech, createdAt: `${input.inWorkshop.exit}T15:00:00Z`,
      })
    }
  }
}

async function insertFinding(id: string, vehicleId: string, foundOn: string) {
  await testDb.insert(schema.mantHistoricalInspections).values({
    sourceKey: `i-${id}`, fingerprint: `fp-i-${id}`, sourceFile: "consolidado.xlsx", sourceSheet: "INSPECCIONES", sourceRow: 2,
    submittedAt: `${foundOn} 08:00:00`, inspectionDate: foundOn, formKind: "CAMION", unitKind: "CAMION", equipmentText: "KA", vehicleId,
    equipmentMatch: "linked", worksiteText: "faena", worksiteId: WS.a, fields: [], importedBy: U.actor,
  })
  await testDb.insert(schema.mantHistoricalFindings).values({
    sourceKey: `f-${id}`, inspectionSourceKey: `i-${id}`, sourceRow: 2, foundOn, section: "Frenos", item: `Ítem ${id}`, condition: "mal",
  })
}

beforeAll(async () => {
  await migratePGlite(pg, "db/migrations")
  const now = new Date().toISOString()
  await testDb.insert(schema.users).values(
    Object.values(U).map((id) => ({ id, name: id, email: `${id}@chome.test`, hashedPassword: "hash", isActive: true, createdAt: now, updatedAt: now })),
  )
  const worksite = (id: string, name: string) => ({ id, name, code: id.toUpperCase(), isActive: true, createdAt: now, updatedAt: now })
  await testDb.insert(schema.worksites).values([worksite(WS.a, "Faena A"), worksite(WS.b, "Faena B")])
  await testDb.insert(schema.mantWorksiteSettings).values([{ worksiteId: WS.a, folioCode: "AAA" }, { worksiteId: WS.b, folioCode: "BBB" }])
  await testDb.insert(schema.fuelEquipmentTypes).values({ id: "fet-cut", slug: "cut-km", name: "Camión", category: "truck", defaultMeterType: "odometer", defaultPerformanceUnit: "km_per_liter" })
  const vehicle = (id: string, code: string, plate: string) => ({ id, code, plate, type: "Camión", equipmentTypeId: "fet-cut", worksiteId: WS.a, model: "R450", year: 2021, brand: "Scania" })
  await testDb.insert(schema.fuelVehicles).values([vehicle(V.a1, "KA-C1", "CCCC-01"), vehicle(V.a2, "KA-C2", "CCCC-02"), vehicle(V.a3, "KA-C3", "CCCC-03")])
  await testDb.insert(schema.mantWorkshops).values({ id: "wk-cut", name: "Taller Externo", nameKey: "taller externo" })
})

describe("OT: sólo las que se trabajaron", () => {
  it("una OT sin ingreso a taller no es un trabajo; con ingreso entra fechada por el ingreso en hora de Chile", async () => {
    await insertOt("ot-sin-ingreso", V.a1, "2026-11-10")
    // 02:30 UTC del 12-11 son las 23:30 del 11-11 en Chile (UTC-3): la fecha del trabajo es el 11, no la solicitud (10).
    await insertOt("ot-con-ingreso", V.a1, "2026-11-10", "2026-11-12T02:30:00Z")
    const { rows } = await loadMaintenanceWork(GLOBAL, QUERY)
    const ids = rows.map((row) => row.id)
    expect(ids).not.toContain("ot:ot-sin-ingreso")
    expect(rows.find((row) => row.id === "ot:ot-con-ingreso")).toMatchObject({ source: "ot", date: "2026-11-11", inWorkshop: true })
  })
})

describe("historial: sólo antes del corte", () => {
  it("el del 30-11-2026 cuenta y el del 01-12-2026 no", async () => {
    await insertHistorical("1", V.a2, "2026-11-30")
    await insertHistorical("2", V.a2, "2026-12-01")
    const ids = (await loadMaintenanceWork(GLOBAL, QUERY)).rows.map((row) => row.id)
    expect(ids).toContain("h:h-1")
    expect(ids).not.toContain("h:h-2")
  })
})

describe("registros de la plataforma: desde el corte, vigentes y sin OT", () => {
  beforeAll(async () => {
    await insertRecord({ id: "r-corr", kind: "C", vehicleId: V.a3, workDate: "2026-12-01", hours: 3.5, external: true, inWorkshop: { entry: "2026-12-01", exit: "2026-12-04" } })
    await insertRecord({ id: "r-prev", kind: "P", vehicleId: V.a3, workDate: "2026-12-02" })
    await insertRecord({ id: "r-nov", kind: "C", vehicleId: V.a3, workDate: "2026-11-30" })
    await insertRecord({ id: "r-anulado", kind: "C", vehicleId: V.a3, workDate: "2026-12-03", status: "anulado" })
    await insertOt("ot-del-registro", V.a3, "2026-12-05")
    await insertRecord({ id: "r-con-ot", kind: "C", vehicleId: V.a3, workDate: "2026-12-05", workOrderId: "ot-del-registro" })
  })

  it("el vigente sin OT del 01-12-2026 entra; el del 30-11, el anulado y el que tiene OT, no", async () => {
    const ids = (await loadMaintenanceWork(GLOBAL, QUERY)).rows.map((row) => row.id)
    expect(ids).toContain("r:r-corr")
    expect(ids).toContain("r:r-prev")
    expect(ids).not.toContain("r:r-nov")
    expect(ids).not.toContain("r:r-anulado")
    expect(ids).not.toContain("r:r-con-ot")
  })

  it("se mapea a la fila de trabajo: tipo, horas, externo y días en taller derivados de la salida", async () => {
    const { rows } = await loadMaintenanceWork(GLOBAL, QUERY)
    expect(rows.find((row) => row.id === "r:r-corr")).toMatchObject({
      source: "registro", reference: "MR-r-corr", date: "2026-12-01", actionType: "correctiva", laborHours: 3.5, external: true, workshopDays: 3, inWorkshop: false,
      equipmentLabel: "KA-C3 · CCCC-03", worksiteId: WS.a,
    })
    expect(rows.find((row) => row.id === "r:r-prev")).toMatchObject({ actionType: "preventiva", laborHours: null, workshopDays: null, inWorkshop: false, external: false })
  })

  it("el agregado cuenta cada fuente aparte", async () => {
    const { rows } = await loadMaintenanceWork(GLOBAL, QUERY)
    const summary = summarizeMaintenanceWork(rows, { ...QUERY, chart: period.chart })
    expect(summary.bySource).toEqual({ historial: 1, ot: 1, registro: 2 })
    expect(summary.total).toBe(4)
  })

  it("un supervisor de la faena los ve; el de otra faena, no", async () => {
    expect((await loadMaintenanceWork(SCOPED_A, QUERY)).rows.map((row) => row.id)).toContain("r:r-corr")
    const other = await loadMaintenanceWork(SCOPED_B, QUERY)
    expect(other.rows).toEqual([])
  })
})

describe("¿hubo trabajo después del hallazgo?: un hecho del equipo, sin corte", () => {
  it("un registro anterior al corte y uno con OT cubren el hallazgo; sin ninguno, queda sin trabajo", async () => {
    await insertFinding("f1", V.a3, "2026-11-28") // r-nov (30-11) lo cubre, aunque cae antes del corte
    await insertFinding("f2", V.a1, "2026-12-08") // sin trabajo del equipo en 7 días (la OT de a1 es del 11-11)
    const result = await loadFindingsWithoutWork(GLOBAL, { from: "2026-11-01", to: "2026-12-10", today: TODAY })
    expect(result).toMatchObject({ total: 2, withWork: 1, withoutWork: 1 })
    expect(result.byEquipment.map((row) => row.label)).toEqual(["KA-C1 · CCCC-01"])
  })
})
