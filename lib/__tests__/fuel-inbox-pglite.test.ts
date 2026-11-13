/**
 * Bandeja «Por revisar» contra Postgres real (PGlite): une cargas por decidir,
 * casos, patentes sin vincular y pedidos de revisión; respeta el alcance por
 * faena y la ventana del período (pendientes = mes del dato ≤ fin del período);
 * ordena por fecha límite y luego por espera; y arma la evidencia de cada motivo.
 */

import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { eq } from "drizzle-orm"
import type { Session } from "next-auth"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
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
vi.mock("server-only", () => ({}))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }))
const mockAuth = vi.hoisted(() => vi.fn())
vi.mock("@/lib/auth/auth", () => ({ auth: mockAuth }))
const notifySafe = vi.hoisted(() => vi.fn())
vi.mock("@/lib/services/notifications", () => ({ notifyAfterCommit: (thunk: () => unknown) => { void thunk() }, notifySafe, notifyManyUser: vi.fn() }))
const linkConsumptionPlateAction = vi.hoisted(() => vi.fn())
vi.mock("@/app/(app)/combustibles/actions-consumos", () => ({ linkConsumptionPlateAction }))

await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))

import type { Tx } from "@/db"
import { getAnomalyCases, takeAnomalyCase } from "@/lib/combustibles/anomaly-cases"
import { projectTaeSubmissions } from "@/lib/combustibles/control/projection"
import { resolveReviewRequest } from "@/lib/combustibles/control/review"
import { linkInboxPlateAction, resolveReviewRequestAction, takeAnomalyCaseAction } from "@/app/(app)/combustibles/revisar/actions"
import { decideFlaggedLoad } from "@/lib/combustibles/control/review"
import { countFuelInboxDecided, countFuelInboxPending, getFuelInbox, getFuelInboxItem, getFuelInboxPendingByKind, getFuelInboxPendingForSession, getLastDetectionRun, summarizeFuelInbox } from "@/lib/combustibles/inbox/queries"
import { describeFuelPeriod, resolveFuelPeriod } from "@/lib/combustibles/period/parse"
import { fuelReviewTile } from "@/app/(app)/control-operacional/attention-tiles"
import type { FuelInboxQueryFilters } from "@/lib/combustibles/inbox/detail-types"

const tx = inMemoryDb as unknown as Tx
const MARCH = resolveFuelPeriod({ searchParams: { periodo: "2026-03" }, fallback: { kind: "month", year: 2026, month: 3 }, today: "2026-10-31" })
const APRIL = resolveFuelPeriod({ searchParams: { periodo: "2026-04" }, fallback: { kind: "month", year: 2026, month: 3 }, today: "2026-10-31" })
const FEBRUARY = resolveFuelPeriod({ searchParams: { periodo: "2026-02" }, fallback: { kind: "month", year: 2026, month: 3 }, today: "2026-10-31" })

const ALL_PERMISSIONS = [
  "combustibles:view", "combustibles:approve_flagged", "combustibles:review_anomalies", "combustibles:resolve_anomalies",
  "combustibles:manage_vehicles", "combustibles:tae_review",
]

function globalSession(permissions: string[] = ALL_PERMISSIONS): Session {
  return {
    user: { id: "reviewer", name: "Jefa", email: "jefa@example.com", roles: ["jefa_chome"], permissions, worksiteIds: [], primaryWorksiteId: null, avatarColor: null, isActive: true, isGlobal: true },
    expires: "2099-01-01T00:00:00.000Z",
  } as Session
}

function scopedSession(worksiteIds: string[], permissions: string[] = ALL_PERMISSIONS): Session {
  return {
    user: { id: "scoped", name: "Faena", email: "f@example.com", roles: ["solicitante_faena"], permissions, worksiteIds, primaryWorksiteId: worksiteIds[0] ?? null, avatarColor: null, isActive: true, isGlobal: false },
    expires: "2099-01-01T00:00:00.000Z",
  } as Session
}

const pending = (overrides: Partial<FuelInboxQueryFilters> = {}): FuelInboxQueryFilters => ({ view: "pendientes", page: 1, ...overrides })
const decided = (overrides: Partial<FuelInboxQueryFilters> = {}): FuelInboxQueryFilters => ({ view: "decididas", page: 1, ...overrides })

let seq = 0
async function submission(vehicleId: string | null, loadedAt: string, meterReading: number, liters = 50, extra: Partial<typeof schema.fuelTaeSubmissions.$inferInsert> = {}) {
  seq += 1
  const id = `sub-i-${seq}`
  await inMemoryDb.insert(schema.fuelTaeSubmissions).values({
    id, clientSubmissionId: `c-${id}`, publicResultToken: `t-${id}`, worksiteId: "ws-a", vehicleId,
    productId: "prod-diesel", equipmentCodeSnapshot: "CAM-01", loadedAt, submittedAt: loadedAt,
    driverNameSnapshot: "Conductor", supervisorNameSnapshot: "Supervisor", meterType: "odometer", meterReading, liters, ...extra,
  })
  return id
}

const loads = () => inMemoryDb.select().from(schema.fuelEquipmentLoads)

// A nivel de archivo: las dos suites comparten la misma base y ésta se cierra al terminar ambas.
afterAll(async () => {
  delete testGlobal.__db
  await pg.close()
})

describe("bandeja Por revisar", () => {
  beforeAll(async () => {
    await inMemoryDb.insert(schema.worksites).values([
      { id: "ws-a", name: "Faena A", code: "FN-A" },
      { id: "ws-b", name: "Faena B", code: "FN-B" },
    ])
    await inMemoryDb.insert(schema.users).values([
      { id: "reviewer", name: "Jefa", email: "jefa@example.com", hashedPassword: "x" },
      { id: "asker", name: "R. Pino", email: "pino@example.com", hashedPassword: "x" },
      { id: "scoped", name: "Faena", email: "f@example.com", hashedPassword: "x" },
    ])
    await inMemoryDb.insert(schema.fuelProducts).values({ id: "prod-diesel", code: "DIESEL-R", name: "Diésel prueba", category: "diesel" }).onConflictDoNothing()
    await inMemoryDb.insert(schema.fuelEquipmentTypes).values({ id: "fet-test", slug: "camion-test", name: "Camión prueba" }).onConflictDoNothing()
    const vehicle = (id: string, plate: string, code: string, worksiteId: string, extra: Partial<typeof schema.fuelVehicles.$inferInsert> = {}) => ({
      id, plate, code, type: "camion", equipmentTypeId: "fet-test", worksiteId, meterType: "odometer", performanceUnit: "km_per_liter", ...extra,
    })
    await inMemoryDb.insert(schema.fuelVehicles).values([
      vehicle("veh-1", "AAAA11", "CAM-01", "ws-a"),
      vehicle("veh-2", "BBBB22", "CAM-02", "ws-b"),
      vehicle("veh-3", "CCCC33", "CAM-03", "ws-a"),
      vehicle("veh-4", "DDDD44", "CAM-04", "ws-a", { tankCapacityLiters: 100 }),
    ])

    // Cargas por decidir. veh-1 (marzo): retroceso de lectura y una duplicada.
    const march = [
      await submission("veh-1", "2026-03-01T12:00:00.000Z", 1000),
      await submission("veh-1", "2026-03-02T12:00:00.000Z", 900, 30),
      await submission("veh-1", "2026-03-04T12:00:00.000Z", 1600, 50),
      await submission("veh-1", "2026-03-04T12:05:00.000Z", 1700, 50, { source: "legacy_xlsx" }),
      // veh-4 (marzo): 150 L en un estanque de 100 L.
      await submission("veh-4", "2026-03-06T12:00:00.000Z", 100, 150),
      // veh-3: una de febrero (vencida frente a marzo) y una de abril (todavía no vence frente a marzo).
      await submission("veh-3", "2026-02-10T12:00:00.000Z", 5000),
      await submission("veh-3", "2026-02-11T12:00:00.000Z", 4900, 20),
      await submission("veh-3", "2026-04-02T12:00:00.000Z", 6000),
      await submission("veh-3", "2026-04-03T12:00:00.000Z", 5800, 20),
      // veh-2 (faena B): un retroceso en marzo.
      await submission("veh-2", "2026-03-02T12:00:00.000Z", 1000, 50, { worksiteId: "ws-b" }),
      await submission("veh-2", "2026-03-03T12:00:00.000Z", 800, 40, { worksiteId: "ws-b" }),
    ]
    await projectTaeSubmissions(tx, march)
    // Las cargas se crean «ahora» en la prueba; en la vida real se registran cuando ocurren. Sin esto,
    // todas parecerían detectadas hoy con su mes ya cerrado y vencerían a hoy + 7 días.
    await pg.query(`update fuel_equipment_loads set created_at = occurred_at`)

    // Casos de anomalía.
    await inMemoryDb.insert(schema.fuelAnomalyRules).values({ id: "rule-1", code: "sello_repetido", name: "Sello repetido", severity: "high" })
    const refSubmission = await submission("veh-1", "2026-03-05T09:00:00.000Z", 1300, 20, { equipmentCodeSnapshot: "CAM-01" })
    const caseBase = { ruleId: "rule-1", ruleCode: "sello_repetido", severity: "high", description: "El sello 004530 ya se puso el 14 de octubre" }
    await inMemoryDb.insert(schema.fuelAnomalyCases).values([
      // Detectado en abril, pero habla de una carga de marzo (mes ya cerrado): vence a la detección + 7 días.
      { ...caseBase, id: "case-ref", worksiteId: "ws-a", vehicleId: "veh-1", referenceEntityType: "fuel_tae_submission", referenceEntityId: refSubmission, status: "open", detectedAt: "2026-04-02T06:00:00.000Z" },
      { ...caseBase, id: "case-taken", worksiteId: "ws-a", vehicleId: "veh-3", status: "in_review", assigneeId: "reviewer", detectedAt: "2026-02-20T06:00:00.000Z" },
      { ...caseBase, id: "case-closed", worksiteId: "ws-a", vehicleId: "veh-1", status: "dismissed", resolution: "No era un problema", resolvedById: "reviewer", resolvedAt: "2026-03-10T15:00:00.000Z", detectedAt: "2026-03-08T06:00:00.000Z" },
      { ...caseBase, id: "case-b", worksiteId: "ws-b", vehicleId: "veh-2", status: "open", detectedAt: "2026-03-02T06:00:00.000Z" },
      { ...caseBase, id: "case-may", worksiteId: "ws-a", vehicleId: "veh-1", status: "open", detectedAt: "2026-05-10T06:00:00.000Z" },
    ])
    await inMemoryDb.insert(schema.fuelAnomalyComments).values({ id: "cm-1", caseId: "case-taken", userId: "reviewer", body: "El sello venía de otra faena, lo estoy averiguando" })
    await inMemoryDb.insert(schema.fuelAnomalyExecutions).values([
      { id: "ex-1", ruleId: "rule-1", startedAt: "2026-10-30T09:00:00.000Z", completedAt: "2026-10-30T09:01:00.000Z", status: "completed", casesCreated: 2 },
      { id: "ex-2", ruleId: "rule-1", startedAt: "2026-10-29T09:00:00.000Z", completedAt: "2026-10-29T09:01:00.000Z", status: "completed", casesCreated: 1 },
    ])

    // Patentes sin vincular (reporte de tarjeta).
    const batch = (id: string, worksiteId: string, from: string, to: string, estado = "importado") => ({
      id, worksiteId, fuente: "Copec TCT Diesel", periodoDesde: from, periodoHasta: to, archivoNombre: `${id}.xlsx`, hashArchivo: `h-${id}`, importadoPor: "reviewer", estado,
    })
    await inMemoryDb.insert(schema.fuelImportBatches).values([
      batch("batch-a", "ws-a", "2026-03-01", "2026-03-31"),
      batch("batch-rev", "ws-a", "2026-03-01", "2026-03-31", "revertido"),
      batch("batch-b", "ws-b", "2026-03-01", "2026-03-31"),
      batch("batch-abr", "ws-a", "2026-04-01", "2026-04-30"),
    ])
    const record = (id: string, batchId: string, worksiteId: string, plate: string, liters: number, vehicleId: string | null = null) => ({
      id, batchId, worksiteId, vehicleId, patente: plate, cantidadUnidad: liters, monto: liters * 1000, periodoDesde: "2026-03-01", periodoHasta: "2026-03-31",
    })
    await inMemoryDb.insert(schema.fuelConsumptionRecords).values([
      record("r1", "batch-a", "ws-a", "ZZZZ99", 640),
      record("r2", "batch-a", "ws-a", "YYYY88", 180),
      record("r3", "batch-a", "ws-a", "AAAA11", 300, "veh-1"),
      record("r4", "batch-rev", "ws-a", "XXXX77", 10),
      record("r5", "batch-b", "ws-b", "WWWW66", 20),
      record("r6", "batch-abr", "ws-a", "VVVV55", 30),
    ])
    await pg.query(`update fuel_consumption_records set created_at = (periodo_desde::date + 10)::timestamptz`)
    await inMemoryDb.insert(schema.fuelProviderMappings).values({
      id: "map-1", provider: "copec", sourceAccount: "tct:diesel", externalKey: "UUUU44", normalizedValue: "UUUU44", worksiteId: "ws-a", vehicleId: "veh-3",
      decidedBy: "reviewer", reason: "Vínculo manual desde el detalle de una importación de combustible", effectiveFrom: "2026-03-01", createdAt: "2026-03-12T10:00:00.000Z",
    })

    // Pedidos de revisión.
    const requested = await submission("veh-3", "2026-03-09T10:00:00.000Z", 5100, 25)
    const resolvedMark = await submission("veh-3", "2026-03-11T10:00:00.000Z", 5200, 25)
    await inMemoryDb.insert(schema.fuelReviewMarks).values([
      { id: "mark-open", entityType: "fuel_tae_submission", entityId: requested, worksiteId: "ws-a", markedBy: "asker", notes: "El operador dice que cargó en dos partes", status: "open", createdAt: "2026-03-20T10:00:00.000Z" },
      { id: "mark-b", entityType: "fuel_tae_submission", entityId: "otra-faena", worksiteId: "ws-b", markedBy: "asker", notes: "De otra faena", status: "open", createdAt: "2026-03-20T10:00:00.000Z" },
      { id: "mark-done", entityType: "fuel_tae_submission", entityId: resolvedMark, worksiteId: "ws-a", markedBy: "asker", notes: "Revisar litros", status: "resolved", resolvedBy: "reviewer", resolvedAt: "2026-03-12T15:00:00.000Z", resolutionNote: "Confirmado con el supervisor", createdAt: "2026-03-10T10:00:00.000Z" },
      { id: "mark-sin-faena", entityType: "fuel_load", entityId: "factura-x", worksiteId: null, markedBy: "asker", notes: "Marca antigua", status: "open", createdAt: "2026-03-21T10:00:00.000Z" },
    ])
  })

  it("une los cuatro tipos de pendiente de marzo, con lo vencido de febrero y sin lo de abril ni mayo", async () => {
    const page = await getFuelInbox(globalSession(), MARCH, pending())
    const keysByKind = (kind: string) => page.rows.filter((row) => row.kind === kind).map((row) => row.id)
    // Cargas: veh-1 (retroceso y duplicada), veh-4 (sobre capacidad), veh-2 de la faena B y la de febrero de veh-3.
    expect(page.rows.filter((row) => row.kind === "carga").map((row) => row.reasonCodes.join(","))).toEqual(
      expect.arrayContaining(["meter_regression", "duplicate", "over_capacity"]),
    )
    expect(keysByKind("carga")).toHaveLength(5)
    // Casos: el de febrero (tomado), el de marzo que referencia una carga de marzo aunque se detectó en abril, y el de la faena B.
    expect(keysByKind("caso").sort()).toEqual(["case-b", "case-ref", "case-taken"])
    // Patentes: sólo las del lote importado de marzo (nada del lote revertido, de abril ni de las cargas ya vinculadas).
    expect(page.rows.filter((row) => row.kind === "patente").map((row) => row.equipmentLabel).sort()).toEqual(["WWWW66", "YYYY88", "ZZZZ99"])
    // Pedidos: los abiertos (el que no tiene faena sólo lo ven los roles globales).
    expect(keysByKind("pedido").sort()).toEqual(["mark-b", "mark-open", "mark-sin-faena"])
    expect(page.total).toBe(page.rows.length)
  })

  it("cada fila trae su fecha límite (fin del mes del dato) y el dato que la explica", async () => {
    const page = await getFuelInbox(globalSession(), MARCH, pending({ worksiteId: "ws-a" }))
    const regression = page.rows.find((row) => row.kind === "carga" && row.reasonCodes.includes("meter_regression") && row.dataMonth === "2026-03")!
    expect(regression).toMatchObject({ dueDate: "2026-03-31", equipmentLabel: "CAM-01 · AAAA11", worksiteName: "Faena A", canAct: true })
    expect(regression.datum).toBe("900 km; la carga anterior marcó 1.000 km")
    expect(regression.href).toMatch(/^\/combustibles\/cargas\/terreno\//)
    const capacity = page.rows.find((row) => row.reasonCodes.includes("over_capacity"))!
    expect(capacity.datum).toBe("150 L en un estanque de 100 L")
    const febrero = page.rows.find((row) => row.dataMonth === "2026-02" && row.kind === "carga")!
    expect(febrero.dueDate).toBe("2026-02-28")
    const caseRef = page.rows.find((row) => row.id === "case-ref")!
    expect(caseRef).toMatchObject({ dataMonth: "2026-03", dueDate: "2026-04-09", severity: "high", title: "Caso · Sello repetido" })
    const plate = page.rows.find((row) => row.equipmentLabel === "ZZZZ99")!
    expect(plate).toMatchObject({ dataMonth: "2026-03", datum: "640 L de marzo no cuentan en ningún equipo (Copec TCT Diesel)", canAct: true })
    expect(plate.href).toBe("/combustibles/fuentes/archivos/tarjeta/batch-a")
    expect(page.rows.find((row) => row.id === "mark-open")!.datum).toBe("R. Pino: «El operador dice que cargó en dos partes»")
  })

  it("ordena por fecha límite y, a igual fecha, por lo que lleva más tiempo esperando", async () => {
    const page = await getFuelInbox(globalSession(), MARCH, pending({ worksiteId: "ws-a" }))
    const due = page.rows.map((row) => row.dueDate)
    expect(due).toEqual([...due].sort())
    expect(due[0]).toBe("2026-02-28")
    for (let i = 1; i < page.rows.length; i += 1) {
      const [prev, row] = [page.rows[i - 1]!, page.rows[i]!]
      if (prev.dueDate === row.dueDate) expect(prev.waitingSince <= row.waitingSince).toBe(true)
    }
  })

  it("un caso histórico detectado tarde no encabeza la bandeja: la carga del mes que vence antes va primero", async () => {
    // Datos de enero detectados el 28 de febrero (mes cerrado): vence el 7 de marzo.
    // Una carga de febrero registrada en febrero vence el 28: va antes.
    await inMemoryDb.insert(schema.fuelAnomalyCases).values({
      id: "case-historico", ruleId: "rule-1", ruleCode: "sello_repetido", severity: "high", description: "Histórico", worksiteId: "ws-a", vehicleId: "veh-3",
      status: "open", detectedAt: "2026-02-28T15:00:00.000Z", referenceEntityType: "fuel_consumption_record", referenceEntityId: "reg:2026-01-15",
    })
    try {
      const page = await getFuelInbox(globalSession(), MARCH, pending({ worksiteId: "ws-a", pageSize: 100 }))
      const historic = page.rows.find((row) => row.id === "case-historico")!
      expect(historic).toMatchObject({ dataMonth: "2026-01", dueDate: "2026-03-07" })
      const febLoad = page.rows.find((row) => row.kind === "carga" && row.dataMonth === "2026-02")!
      expect(febLoad.dueDate).toBe("2026-02-28")
      const keys = page.rows.map((row) => row.key)
      expect(keys.indexOf(febLoad.key)).toBeLessThan(keys.indexOf(historic.key))
      // La paginación por tipo coincide con el orden unido: el histórico queda donde dice su fecha límite.
      const due = page.rows.map((row) => row.dueDate)
      expect(due).toEqual([...due].sort())
      const onlyCases = await getFuelInbox(globalSession(), MARCH, pending({ worksiteId: "ws-a", kind: "caso", pageSize: 100 }))
      const caseDue = onlyCases.rows.map((row) => row.dueDate)
      expect(caseDue).toEqual([...caseDue].sort())
    } finally {
      await inMemoryDb.delete(schema.fuelAnomalyCases).where(eq(schema.fuelAnomalyCases.id, "case-historico"))
    }
  })

  it("el período manda: con abril entra lo de abril, con febrero sólo lo de febrero", async () => {
    const april = await getFuelInbox(globalSession(), APRIL, pending({ worksiteId: "ws-a", kind: "carga" }))
    expect(april.rows.some((row) => row.dataMonth === "2026-04")).toBe(true)
    const february = await getFuelInbox(globalSession(), FEBRUARY, pending({ worksiteId: "ws-a" }))
    expect(february.rows.every((row) => row.dataMonth <= "2026-02")).toBe(true)
    expect(february.rows.map((row) => row.kind).sort()).toEqual(["carga", "caso"])
  })

  it("respeta el alcance por faena: lo de otra faena no aparece ni se cuenta", async () => {
    const scoped = await getFuelInbox(scopedSession(["ws-a"]), MARCH, pending())
    expect(scoped.rows.every((row) => row.worksiteId === "ws-a")).toBe(true)
    expect(scoped.rows.map((row) => row.id)).not.toContain("case-b")
    expect(scoped.rows.map((row) => row.id)).not.toContain("mark-b")
    expect(scoped.rows.map((row) => row.id)).not.toContain("mark-sin-faena")
    const summary = await summarizeFuelInbox(scopedSession(["ws-a"]), MARCH)
    expect(summary.byKind).toEqual({ carga: 4, caso: 2, patente: 2, pedido: 1 })
    expect(summary.total).toBe(9)

    const none = await getFuelInbox(scopedSession([]), MARCH, pending())
    expect(none).toMatchObject({ rows: [], total: 0 })
    expect((await summarizeFuelInbox(scopedSession([]), MARCH)).total).toBe(0)
    // Pedir una faena fuera de tu alcance no la abre: se cruza con el alcance, no lo reemplaza.
    const forced = await getFuelInbox(scopedSession(["ws-a"]), MARCH, pending({ worksiteId: "ws-b" }))
    expect(forced.rows).toEqual([])
  })

  it("el resumen cuenta con el mismo criterio que la lista y da la espera más antigua", async () => {
    const summary = await summarizeFuelInbox(globalSession(), MARCH)
    const list = await getFuelInbox(globalSession(), MARCH, pending({ pageSize: 100 }))
    expect(summary.total).toBe(list.total)
    for (const kind of ["carga", "caso", "patente", "pedido"] as const) {
      expect(summary.byKind[kind]).toBe(list.rows.filter((row) => row.kind === kind).length)
    }
    expect(summary.oldestWaitingSince).toBe([...list.rows].map((row) => row.waitingSince).sort()[0])
    const onlyB = await summarizeFuelInbox(globalSession(), MARCH, { worksiteId: "ws-b" })
    expect(onlyB.byKind).toEqual({ carga: 1, caso: 1, patente: 1, pedido: 1 })
  })

  it("filtra por tipo y pagina sin perder ni repetir filas", async () => {
    const onlyCases = await getFuelInbox(globalSession(), MARCH, pending({ kind: "caso" }))
    expect(onlyCases.rows.every((row) => row.kind === "caso")).toBe(true)
    expect(onlyCases.total).toBe(3)

    const all = await getFuelInbox(globalSession(), MARCH, pending({ pageSize: 100 }))
    const seen: string[] = []
    for (let page = 1; page <= 10; page += 1) {
      const result = await getFuelInbox(globalSession(), MARCH, pending({ page, pageSize: 4 }))
      expect(result.total).toBe(all.total)
      seen.push(...result.rows.map((row) => row.key))
      if (result.rows.length < 4) break
    }
    expect(seen).toEqual(all.rows.map((row) => row.key))
    // Una página que no existe se acomoda a la última.
    const beyond = await getFuelInbox(globalSession(), MARCH, pending({ page: 99, pageSize: 4 }))
    expect(beyond.page).toBe(Math.ceil(all.total / 4))
    expect(beyond.rows.length).toBeGreaterThan(0)
  })

  it("el filtro de gravedad, estado y registro de origen de los casos viene de los enlaces antiguos", async () => {
    const reference = await getFuelInbox(globalSession(), MARCH, pending({ kind: "caso", caseReference: { type: "fuel_tae_submission", id: (await loadsRefId()) } }))
    expect(reference.rows.map((row) => row.id)).toEqual(["case-ref"])
    expect((await getFuelInbox(globalSession(), MARCH, pending({ kind: "caso", caseState: "in_review" }))).rows.map((row) => row.id)).toEqual(["case-taken"])
    expect((await getFuelInbox(globalSession(), MARCH, pending({ kind: "caso", caseSeverity: "low" }))).total).toBe(0)
  })

  it("Decididas: lo decidido dentro del período, con la decisión, quién y la nota", async () => {
    // Las dos cargas marcadas de veh-3: la de febrero se aprueba y la de abril se rechaza.
    const flaggedOfVeh3 = (await loads()).filter((row) => row.reviewStatus === "flagged" && row.vehicleId === "veh-3").sort((a, b) => a.month.localeCompare(b.month))
    const [toApprove, toReject] = flaggedOfVeh3
    expect([toApprove!.month, toReject!.month]).toEqual(["2026-02", "2026-04"])
    await decideFlaggedLoad(globalSession(), { loadId: toApprove!.id, decision: "approve", note: "Cambio de tablero confirmado" })
    await decideFlaggedLoad(globalSession(), { loadId: toReject!.id, decision: "reject", note: "Lectura mal digitada en terreno" })
    // Las decisiones quedaron «hoy»: se llevan a marzo y a abril para probar la ventana del período.
    await inMemoryDb.update(schema.fuelEquipmentLoads).set({ reviewedAt: "2026-03-15T12:00:00.000Z" }).where(eq(schema.fuelEquipmentLoads.id, toApprove!.id))
    await inMemoryDb.update(schema.fuelEquipmentLoads).set({ reviewedAt: "2026-04-15T12:00:00.000Z" }).where(eq(schema.fuelEquipmentLoads.id, toReject!.id))

    const march = await getFuelInbox(globalSession(), MARCH, decided())
    const byKind = (kind: string) => march.rows.filter((row) => row.kind === kind)
    expect(byKind("carga")).toHaveLength(1)
    expect(byKind("carga")[0]!.decided).toMatchObject({ outcome: "Cuenta", byName: "Jefa", note: "Cambio de tablero confirmado" })
    expect(byKind("caso").map((row) => row.id)).toEqual(["case-closed"])
    expect(byKind("caso")[0]!.decided).toMatchObject({ outcome: "Descartado", note: "No era un problema", byName: "Jefa" })
    expect(byKind("pedido").map((row) => row.id)).toEqual(["mark-done"])
    expect(byKind("pedido")[0]!.decided).toMatchObject({ outcome: "Revisado", note: "Confirmado con el supervisor" })
    expect(byKind("patente")[0]!.decided).toMatchObject({ outcome: "Vinculada", byName: "Jefa" })
    expect(byKind("patente")[0]!.datum).toContain("CAM-03 · CCCC33")
    // Ordenado por lo más reciente decidido.
    const times = march.rows.map((row) => row.decided!.at)
    expect(times).toEqual([...times].sort().reverse())

    const april = await getFuelInbox(globalSession(), APRIL, decided())
    expect(april.rows.map((row) => row.decided!.outcome)).toEqual(["No cuenta"])

    // La decisión filtra por tipo: «cuenta» sólo existe para las cargas y «descartado» para los casos.
    expect((await getFuelInbox(globalSession(), MARCH, decided({ decision: "cuenta" }))).rows.map((row) => row.kind)).toEqual(["carga"])
    expect((await getFuelInbox(globalSession(), MARCH, decided({ decision: "no-cuenta" }))).total).toBe(0)
    expect((await getFuelInbox(globalSession(), MARCH, decided({ decision: "descartado" }))).rows.map((row) => row.id)).toEqual(["case-closed"])
    expect((await getFuelInbox(globalSession(), MARCH, decided({ decision: "resuelto" }))).total).toBe(0)
    expect(await countFuelInboxDecided(globalSession(), MARCH, decided())).toEqual({ carga: 1, caso: 1, patente: 1, pedido: 1 })
    // Y lo decidido ya no está entre los pendientes.
    expect((await getFuelInbox(globalSession(), MARCH, pending({ kind: "carga", worksiteId: "ws-a" }))).rows.map((row) => row.id)).not.toContain(toApprove!.id)
  })

  it("sin el permiso de aprobar la fila se ve pero no se puede decidir", async () => {
    const page = await getFuelInbox(globalSession(["combustibles:view"]), MARCH, pending({ worksiteId: "ws-a" }))
    expect(page.rows.length).toBeGreaterThan(0)
    expect(page.rows.every((row) => row.canAct === false)).toBe(true)
  })

  it("el contador del menú cuenta todo lo pendiente dentro del alcance, sin período", async () => {
    const all = await countFuelInboxPending("all")
    const inA = await countFuelInboxPending(["ws-a"])
    const inB = await countFuelInboxPending(["ws-b"])
    expect(await countFuelInboxPending([])).toBe(0)
    expect(inA).toBeGreaterThan(0)
    // Incluye lo de abril y mayo, que la bandeja de marzo todavía no muestra.
    expect(inA).toBeGreaterThan((await summarizeFuelInbox(scopedSession(["ws-a"]), MARCH)).total!)
    // Lo que no tiene faena sólo lo cuentan los roles globales.
    expect(all).toBe(inA + inB + 1)
  })

  describe("pendientes por tipo: el menú y el tile del Panel cuentan lo mismo que la bandeja", () => {
    const sum = (counts: Record<string, number | null>) => Object.values(counts).reduce<number>((total, n) => total + (n ?? 0), 0)
    const NONE = { carga: 0, caso: 0, patente: 0, pedido: 0 }

    it("por tipo es lo que cuenta la bandeja sin tope de mes, y su suma es el contador del menú en cada alcance", async () => {
      // Un período que termina en 2030: «Pendientes» sin un tope de mes que recorte algo.
      const far = describeFuelPeriod({ kind: "year", year: 2030 }, "url", "2026-10-31")
      const all = await getFuelInboxPendingByKind("all")
      expect(all).toEqual((await summarizeFuelInbox(globalSession(), far)).byKind)
      const scopes: Array<string[] | "all"> = ["all", ["ws-a"], ["ws-b"], []]
      for (const scope of scopes) {
        expect(sum(await getFuelInboxPendingByKind(scope))).toBe(await countFuelInboxPending(scope))
      }
    })

    it("con el alcance acotado a otra faena sólo ve lo de esa faena; lo que no tiene faena lo suma sólo el alcance global", async () => {
      const all = await getFuelInboxPendingByKind("all")
      const inA = await getFuelInboxPendingByKind(["ws-a"])
      const inB = await getFuelInboxPendingByKind(["ws-b"])
      expect(inB).toEqual({ carga: 1, caso: 1, patente: 1, pedido: 1 })
      expect(inA.carga).toBeGreaterThan(inB.carga!)
      expect(all.carga).toBe(inA.carga! + inB.carga!)
      expect(all.caso).toBe(inA.caso! + inB.caso!)
      expect(all.patente).toBe(inA.patente! + inB.patente!)
      // El pedido de la marca antigua («mark-sin-faena») no tiene faena.
      expect(all.pedido).toBe(inA.pedido! + inB.pedido! + 1)
      // Sin ninguna faena a la vista no hay nada: cero, no un tipo caído.
      expect(await getFuelInboxPendingByKind([])).toEqual(NONE)
    })

    it("el envoltorio de sesión deriva el alcance de la sesión, y el tile pinta la misma cifra que el menú", async () => {
      expect(await getFuelInboxPendingForSession(globalSession())).toEqual(await getFuelInboxPendingByKind("all"))
      // Una sesión de la faena B no ve lo de la A, por más que se lo pida: el alcance sale de la sesión.
      const inB = await getFuelInboxPendingForSession(scopedSession(["ws-b"]))
      expect(inB).toEqual({ carga: 1, caso: 1, patente: 1, pedido: 1 })
      // El tile entrega la cifra como número (la formatea KpiCard) y la marca como cifra; «Al día» va como texto
      // (más abajo). La cifra es lo que se resuelve ahora (cargas, patentes y pedidos): los casos van en el detalle,
      // como «en seguimiento», para que un histórico enorme no tape las cargas del mes.
      expect(fuelReviewTile(inB)).toMatchObject({
        value: 3,
        valueKind: "number",
        detail: "1 carga por decidir · 1 patente sin vincular · 1 pedido de revisión · 1 caso en seguimiento",
        tone: "signal",
      })
      const sessions: Array<[Session, string[] | "all"]> = [[globalSession(), "all"], [scopedSession(["ws-a"]), ["ws-a"]], [scopedSession(["ws-b"]), ["ws-b"]]]
      for (const [session, scope] of sessions) {
        const counts = await getFuelInboxPendingForSession(session)
        const tile = fuelReviewTile(counts)
        // Lo que cuenta el tile es el total pendiente sin los casos (van en el detalle).
        const actionable = (await countFuelInboxPending(scope)) - (counts.caso ?? 0)
        // `value` es `string | number` desde que KpiCard formatea cifras (UX-06).
        if (tile.valueKind === "number") expect(Number(String(tile.value).replace(/\./g, ""))).toBe(actionable)
        else expect(actionable).toBe(0)
      }
      // Sin ninguna faena a la vista el valor es «Al día», nunca un 0 pelado.
      expect(await getFuelInboxPendingForSession(scopedSession([]))).toEqual(NONE)
      expect(fuelReviewTile(await getFuelInboxPendingForSession(scopedSession([])))).toMatchObject({ value: "Al día", detail: "Nada espera a una persona", tone: "neutral" })
    })

    it("un tipo que no se pudo contar es null, no cero: el menú lo suma como 0 y el tile dice «Sin dato»", async () => {
      const logged = vi.spyOn(console, "error").mockImplementation(() => {})
      const healthy = await getFuelInboxPendingByKind("all")
      // Se tumba la tabla de los pedidos de revisión; el resto de la bandeja sigue contando.
      await pg.exec("alter table fuel_review_marks rename to fuel_review_marks_fuera")
      try {
        const broken = await getFuelInboxPendingByKind("all")
        expect(broken).toEqual({ ...healthy, pedido: null })
        expect(logged.mock.calls.some(([line]) => String(line).includes("conteo de «pedido» falló"))).toBe(true)
        expect(await countFuelInboxPending("all")).toBe(healthy.carga! + healthy.caso! + healthy.patente!)
        expect(fuelReviewTile(broken)).toMatchObject({ value: "Sin dato", tone: "neutral" })
        expect(fuelReviewTile(broken).detail).toContain("Pedidos de revisión: no se pudo calcular")
      } finally {
        await pg.exec("alter table fuel_review_marks_fuera rename to fuel_review_marks")
        logged.mockRestore()
      }
      expect(await getFuelInboxPendingByKind("all")).toEqual(healthy)
    })
  })

  it("el pie dice cuándo corrió por última vez la revisión automática", async () => {
    expect(await getLastDetectionRun()).toEqual({ at: "2026-10-30T09:01:00.000Z", status: "completed", casesCreated: 2 })
  })

  describe("detalle de un pendiente", () => {
    const flaggedBy = async (reason: string, worksiteId = "ws-a") =>
      (await loads()).find((row) => row.worksiteId === worksiteId && row.flagReasons.includes(reason) && row.reviewStatus === "flagged")!

    it("lectura menor a la anterior: las últimas lecturas, con la de esta carga marcada y la siguiente", async () => {
      const load = await flaggedBy("meter_regression")
      const item = await getFuelInboxItem(globalSession(), `carga:${load.id}`)
      expect(item!.row.canAct).toBe(true)
      const readings = item!.evidence.find((entry) => entry.type === "readings")
      expect(readings).toMatchObject({ type: "readings", unit: "km" })
      if (readings?.type !== "readings") throw new Error("sin lecturas")
      expect(readings.points.filter((point) => point.current)).toHaveLength(1)
      expect(readings.points.find((point) => point.current)!.reading).toBe(load.meterReading)
      expect(readings.points[0]!.reading).toBeGreaterThan(readings.points.find((point) => point.current)!.reading)
      expect(item!.extras.load).toMatchObject({ reviewStatus: "flagged", voided: false, hasVehicle: true })
    })

    it("posible duplicada: el par de cargas, la ventana y la tolerancia", async () => {
      const load = await flaggedBy("duplicate")
      const item = await getFuelInboxItem(globalSession(), `carga:${load.id}`)
      const duplicate = item!.evidence.find((entry) => entry.type === "duplicate")
      expect(duplicate).toMatchObject({ type: "duplicate", windowMinutes: 15, litersTolerance: 0.5 })
      if (duplicate?.type !== "duplicate") throw new Error("sin par")
      expect(duplicate.loads.map((entry) => entry.originLabel).sort()).toEqual(["Histórico de sellos", "Registro en terreno"])
      expect(duplicate.loads.every((entry) => entry.liters === 50)).toBe(true)
    })

    it("sobre la capacidad: litros contra capacidad del estanque", async () => {
      const load = await flaggedBy("over_capacity")
      const item = await getFuelInboxItem(globalSession(), `carga:${load.id}`)
      expect(item!.evidence).toContainEqual({ type: "capacity", liters: 150, capacity: 100 })
    })

    it("una carga de otra faena no se abre: misma respuesta que una que no existe", async () => {
      const other = await flaggedBy("meter_regression", "ws-b")
      expect(await getFuelInboxItem(scopedSession(["ws-a"]), `carga:${other.id}`)).toBeNull()
      expect(await getFuelInboxItem(globalSession(), "carga:no-existe")).toBeNull()
      expect(await getFuelInboxItem(globalSession(), "basura")).toBeNull()
      expect(await getFuelInboxItem(scopedSession(["ws-a"]), "caso:case-b")).toBeNull()
      expect(await getFuelInboxItem(scopedSession(["ws-a"]), "pedido:mark-b")).toBeNull()
    })

    it("un caso trae su historial, el estado exacto y a quién se puede asignar", async () => {
      const item = await getFuelInboxItem(globalSession(), "caso:case-taken")
      expect(item!.row).toMatchObject({ assignee: { id: "reviewer", name: "Jefa" }, severity: "high" })
      expect(item!.extras.case).toMatchObject({ id: "case-taken", status: "in_review", ruleCode: "sello_repetido", assigneeId: "reviewer" })
      expect(item!.history.map((entry) => entry.text)).toEqual(["La revisión automática abrió el caso.", "El sello venía de otra faena, lo estoy averiguando"])
      expect(item!.history[1]!.byName).toBe("Jefa")
      const closed = await getFuelInboxItem(globalSession(), "caso:case-closed")
      expect(closed!.extras.case!.status).toBe("dismissed")
      expect(closed!.evidence.map((entry) => (entry.type === "text" ? entry.text : ""))).toContain("Motivo del cierre: No era un problema")
    })

    it("una patente trae los equipos de la faena del lote, y sin permiso de vincular no trae ninguno", async () => {
      const key = "patente:tarjeta:batch-a:ZZZZ99"
      const item = await getFuelInboxItem(globalSession(), key)
      expect(item!.extras.plate).toMatchObject({ batchId: "batch-a", plate: "ZZZZ99", worksiteId: "ws-a" })
      expect(item!.extras.plate!.vehicleOptions.map((option) => option.label)).toEqual(["CAM-01 · AAAA11", "CAM-03 · CCCC33", "CAM-04 · DDDD44"])
      const readOnly = await getFuelInboxItem(globalSession(["combustibles:view"]), key)
      expect(readOnly!.row.canAct).toBe(false)
      expect(readOnly!.extras.plate!.vehicleOptions).toEqual([])
      expect(await getFuelInboxItem(globalSession(), "patente:tarjeta:batch-rev:XXXX77")).toBeNull()
      expect(await getFuelInboxItem(scopedSession(["ws-b"]), key)).toBeNull()
    })

    it("un pedido trae la nota de quien lo pidió y, si ya se revisó, la de quien lo revisó", async () => {
      const open = await getFuelInboxItem(globalSession(), "pedido:mark-open")
      expect(open!.extras.request).toMatchObject({ id: "mark-open", status: "open", requestedByName: "R. Pino" })
      expect(open!.history.map((entry) => entry.text)).toEqual(["El operador dice que cargó en dos partes"])
      const done = await getFuelInboxItem(globalSession(), "pedido:mark-done")
      expect(done!.history.map((entry) => entry.text)).toEqual(["Revisar litros", "Confirmado con el supervisor"])
    })
  })

  async function loadsRefId() {
    const [row] = await inMemoryDb.select({ id: schema.fuelAnomalyCases.referenceEntityId }).from(schema.fuelAnomalyCases).where(eq(schema.fuelAnomalyCases.id, "case-ref"))
    return row!.id!
  }
})

describe("referencias de consumo en la bandeja", () => {
  beforeAll(async () => {
    await inMemoryDb.insert(schema.worksites).values({ id: "ws-variation-summary", name: "Faena resumen", code: "WS-VS" })
    await inMemoryDb.insert(schema.users).values({ id: "user-variation-summary", name: "Resumen", email: "variation-summary@example.com", hashedPassword: "x" })
    await inMemoryDb.insert(schema.fuelEquipmentTypes).values({ id: "type-variation-summary", slug: "truck-summary", name: "Camión resumen" })
    await inMemoryDb.insert(schema.fuelVehicles).values({
      id: "vehicle-variation-summary", plate: "VARSUM", code: "VAR-SUM", type: "camion", equipmentTypeId: "type-variation-summary", worksiteId: "ws-variation-summary",
    })
    await inMemoryDb.insert(schema.fuelImportBatches).values({
      id: "batch-variation-summary", worksiteId: "ws-variation-summary", fuente: "Copec TCT Diesel",
      periodoDesde: "2026-01-01", periodoHasta: "2026-02-28", archivoNombre: "summary.xlsx", hashArchivo: "hash-summary",
      importadoPor: "user-variation-summary", estado: "importado",
    })
    await inMemoryDb.insert(schema.fuelAnomalyRules).values({
      id: "rule-variation-summary", code: "variacion_brusca_consumo", name: "Variación brusca", severity: "medium",
    })
  })

it("resuelve el mes de referencias nuevas y legadas de consumo y desglosa producto sin atribuir el histórico", async () => {
  await inMemoryDb.insert(schema.fuelConsumptionRecords).values({
    id: "record-new-variation", batchId: "batch-variation-summary", worksiteId: "ws-variation-summary", vehicleId: "vehicle-variation-summary",
    patente: "VARSUM", cantidadUnidad: 200, monto: 100_000, numeroTransacciones: 2, numeroTarjetas: 1,
    periodoDesde: "2026-01-01", periodoHasta: "2026-01-31", fuente: "Copec TCT Diesel",
    createdAt: "2026-01-31T12:00:00.000Z", updatedAt: "2026-01-31T12:00:00.000Z",
  })
  await inMemoryDb.insert(schema.fuelAnomalyCases).values([
    {
      id: "case-new-variation", ruleId: "rule-variation-summary", ruleCode: "variacion_brusca_consumo", severity: "medium",
      worksiteId: "ws-variation-summary", vehicleId: "vehicle-variation-summary", referenceEntityType: "fuel_consumption_record",
      referenceEntityId: "record-new-variation", description: "Variación Diesel", status: "open",
      detectedAt: "2026-05-01T12:00:00.000Z",
    },
    {
      id: "case-legacy-variation", ruleId: "rule-variation-summary", ruleCode: "variacion_brusca_consumo", severity: "medium",
      worksiteId: "ws-variation-summary", vehicleId: "vehicle-variation-summary", referenceEntityType: "fuel_consumption_record",
      referenceEntityId: "vehicle-variation-summary:2026-02-01", description: "Variación histórica", status: "open",
      detectedAt: "2026-05-02T12:00:00.000Z",
    },
  ])

  const rows = await getFuelInbox(globalSession(), MARCH, pending({ kind: "caso", pageSize: 100 }))
  expect(rows.rows.filter((row) => row.id === "case-new-variation" || row.id === "case-legacy-variation").map((row) => [row.id, row.dataMonth])).toEqual([
    ["case-new-variation", "2026-01"],
    ["case-legacy-variation", "2026-02"],
  ])
  expect(rows.rows.find((row) => row.id === "case-legacy-variation")?.datum).toContain("Histórico sin producto atribuible")
  const legacyDetail = await getFuelInboxItem(globalSession(), "caso:case-legacy-variation")
  expect(legacyDetail?.evidence[0]).toMatchObject({ type: "text", text: expect.stringContaining("Histórico sin producto atribuible") })

  const summary = await summarizeFuelInbox(globalSession(), MARCH)
  expect(summary.caseBreakdown).toEqual(expect.arrayContaining([
    { ruleCode: "variacion_brusca_consumo", product: "diesel", count: 1 },
    { ruleCode: "variacion_brusca_consumo", product: "historical_unattributed", count: 1 },
  ]))
})
})

describe("escrituras de la bandeja", () => {
  beforeAll(async () => {
    const caseBase = { ruleId: "rule-1", ruleCode: "sello_repetido", severity: "medium", description: "Un caso para tomar" }
    await inMemoryDb.insert(schema.fuelAnomalyCases).values([
      { ...caseBase, id: "take-open", worksiteId: "ws-a", status: "open", detectedAt: "2026-06-02T06:00:00.000Z" },
      { ...caseBase, id: "take-reopened", worksiteId: "ws-a", status: "reopened", detectedAt: "2026-06-02T06:00:00.000Z" },
      { ...caseBase, id: "take-b", worksiteId: "ws-b", status: "open", detectedAt: "2026-06-02T06:00:00.000Z" },
      { ...caseBase, id: "take-other", worksiteId: "ws-a", status: "in_review", assigneeId: "asker", detectedAt: "2026-06-02T06:00:00.000Z" },
      { ...caseBase, id: "take-closed", worksiteId: "ws-a", status: "resolved", resolution: "Listo", resolvedAt: "2026-06-03T06:00:00.000Z", detectedAt: "2026-06-02T06:00:00.000Z" },
    ])
    const mark = (id: string, entityId: string, worksiteId: string | null) => ({ id, entityType: "fuel_tae_submission", entityId, worksiteId, markedBy: "asker", notes: "Pido que la revisen", status: "open", createdAt: "2026-06-05T10:00:00.000Z" })
    await inMemoryDb.insert(schema.fuelReviewMarks).values([
      mark("w-mark-1", "e-1", "ws-a"), mark("w-mark-2", "e-2", "ws-a"), mark("w-mark-b", "e-3", "ws-b"), mark("w-mark-null", "e-4", null), mark("w-mark-3", "e-5", "ws-a"),
    ])
  })

  const audit = (entityId: string) => inMemoryDb.select().from(schema.auditLog).where(eq(schema.auditLog.entityId, entityId))

  it("tomar un caso: queda como responsable y «Tomada» en un solo paso, con su auditoría y su historial de estado", async () => {
    const taken = await takeAnomalyCase(globalSession(), "take-open", { status: "open", assigneeId: null })
    expect(taken).toMatchObject({ id: "take-open", status: "in_review", assigneeId: "reviewer", assigneeName: "Jefa" })
    const trail = await audit("take-open")
    expect(trail).toHaveLength(1)
    expect(JSON.parse(trail[0]!.oldState!)).toMatchObject({ status: "open", assigneeId: null })
    expect(JSON.parse(trail[0]!.newState!)).toMatchObject({ status: "in_review", assigneeId: "reviewer" })
    expect(trail[0]!.worksiteId).toBe("ws-a")
    const history = await inMemoryDb.select().from(schema.statusHistory).where(eq(schema.statusHistory.entityId, "take-open"))
    expect(history.map((row) => [row.fromStatus, row.toStatus])).toEqual([["open", "in_review"]])
    // Un caso reabierto también se toma.
    expect(await takeAnomalyCase(globalSession(), "take-reopened", { status: "reopened", assigneeId: null })).toMatchObject({ status: "in_review" })
  })

  it("tomar un caso falla si el caso cambió, si es de otra persona, si está cerrado o si es de otra faena", async () => {
    await expect(takeAnomalyCase(globalSession(), "take-other", { status: "in_review", assigneeId: null })).rejects.toThrow(/cambió/)
    await expect(takeAnomalyCase(globalSession(), "take-other", { status: "in_review", assigneeId: "asker" })).rejects.toThrow(/Otra persona/)
    await expect(takeAnomalyCase(globalSession(), "take-closed", { status: "resolved", assigneeId: null })).rejects.toThrow(/cerrado/)
    await expect(takeAnomalyCase(scopedSession(["ws-a"]), "take-b", { status: "open", assigneeId: null })).rejects.toThrow(/no encontrado/)
    expect((await getAnomalyCases({ ids: ["take-b"] }, globalSession())).cases[0]).toMatchObject({ status: "open", assigneeId: null })
  })

  it("la acción de tomar exige el permiso de revisar anomalías", async () => {
    mockAuth.mockResolvedValue(globalSession(["combustibles:view"]))
    expect((await takeAnomalyCaseAction({ caseId: "take-b", expectedStatus: "open", expectedAssigneeId: null })).ok).toBe(false)
    expect((await takeAnomalyCaseAction({ caseId: "take-b", expectedStatus: "inventado" as never, expectedAssigneeId: null })).ok).toBe(false)
    mockAuth.mockResolvedValue(globalSession())
    expect(await takeAnomalyCaseAction({ caseId: "take-b", expectedStatus: "open", expectedAssigneeId: null })).toEqual({ ok: true, message: "Caso tomado: eres su responsable" })
  })

  it("los casos se pueden acotar por fecha de detección y de cierre, y pedir por id", async () => {
    const session = globalSession()
    expect((await getAnomalyCases({ ids: [] }, session)).total).toBe(0)
    expect((await getAnomalyCases({ ids: ["case-ref", "case-b"] }, session)).cases.map((row) => row.id).sort()).toEqual(["case-b", "case-ref"])
    const march = (await getAnomalyCases({ detectedFrom: "2026-03-01T00:00:00.000Z", detectedTo: "2026-04-01T00:00:00.000Z" }, session)).cases.map((row) => row.id).sort()
    expect(march).toEqual(["case-b", "case-closed"])
    expect((await getAnomalyCases({ resolvedFrom: "2026-03-01T00:00:00.000Z", resolvedTo: "2026-04-01T00:00:00.000Z" }, session)).cases.map((row) => row.id)).toEqual(["case-closed"])
  })

  it("resolver un pedido: queda resuelto con la nota, quién y cuándo, y se audita", async () => {
    const result = await resolveReviewRequest(globalSession(), { markId: "w-mark-1", note: "Confirmado con el operador" })
    expect(result).toMatchObject({ ok: true, markId: "w-mark-1", markedBy: "asker", worksiteId: "ws-a" })
    const [row] = await inMemoryDb.select().from(schema.fuelReviewMarks).where(eq(schema.fuelReviewMarks.id, "w-mark-1"))
    expect(row).toMatchObject({ status: "resolved", resolvedBy: "reviewer", resolutionNote: "Confirmado con el operador" })
    expect(row!.resolvedAt).not.toBeNull()
    const [trail] = await audit("e-1")
    expect(trail).toMatchObject({ action: "status_change", reason: "Confirmado con el operador", worksiteId: "ws-a" })
    // Ya resuelto: no se resuelve dos veces.
    expect((await resolveReviewRequest(globalSession(), { markId: "w-mark-1", note: "Otra vez la misma revisión" })).ok).toBe(false)
  })

  it("resolver un pedido exige permiso, nota de 10 a 500 caracteres y alcance de faena", async () => {
    expect(await resolveReviewRequest(globalSession(["combustibles:view"]), { markId: "w-mark-2", note: "Nota suficientemente larga" })).toEqual({ ok: false, message: "No tienes permisos para resolver pedidos de revisión" })
    expect((await resolveReviewRequest(globalSession(), { markId: "w-mark-2", note: "corta" })).ok).toBe(false)
    expect((await resolveReviewRequest(globalSession(), { markId: "w-mark-2", note: "x".repeat(501) })).ok).toBe(false)
    const outOfScope = await resolveReviewRequest(scopedSession(["ws-a"]), { markId: "w-mark-b", note: "Intento fuera de alcance" })
    const missing = await resolveReviewRequest(globalSession(), { markId: "no-existe", note: "Este pedido no existe" })
    expect(outOfScope).toEqual({ ok: false, message: "El pedido no existe o no está en tus faenas" })
    expect(missing).toEqual(outOfScope)
    // Un pedido sin faena sólo lo resuelve un rol global.
    expect((await resolveReviewRequest(scopedSession(["ws-a"]), { markId: "w-mark-null", note: "Marca antigua sin faena" })).ok).toBe(false)
    expect((await resolveReviewRequest(globalSession(), { markId: "w-mark-null", note: "Marca antigua sin faena" })).ok).toBe(true)
    // `combustibles:tae_review` basta (es el permiso al que se avisaba de los pedidos).
    expect((await resolveReviewRequest(scopedSession(["ws-a"], ["combustibles:view", "combustibles:tae_review"]), { markId: "w-mark-2", note: "Revisado por quien recibe el aviso" })).ok).toBe(true)
    const rows = await inMemoryDb.select().from(schema.fuelReviewMarks).where(eq(schema.fuelReviewMarks.id, "w-mark-b"))
    expect(rows[0]!.status).toBe("open")
  })

  it("la acción de resolver avisa a quien pidió la revisión, salvo que sea quien la resuelve", async () => {
    mockAuth.mockResolvedValue(globalSession(["combustibles:view"]))
    expect((await resolveReviewRequestAction({ markId: "w-mark-3", note: "Nota suficientemente larga" })).ok).toBe(false)
    expect(notifySafe).not.toHaveBeenCalled()

    mockAuth.mockResolvedValue(globalSession())
    expect(await resolveReviewRequestAction({ markId: "w-mark-3", note: "Confirmado con el operador" })).toEqual({ ok: true, message: "Pedido revisado" })
    await vi.waitFor(() => expect(notifySafe).toHaveBeenCalledTimes(1))
    expect(notifySafe).toHaveBeenCalledWith(expect.objectContaining({
      userId: "asker", title: "Tu pedido de revisión ya se revisó", body: "Confirmado con el operador", entityType: "fuel_tae_submission", entityId: "e-5",
      entityHref: "/combustibles/cargas/terreno/e-5", dedupeKey: "review-resolved:w-mark-3",
    }))
  })

  it("vincular una patente delega en la acción que ya existía y sólo agrega el refresco", async () => {
    linkConsumptionPlateAction.mockResolvedValueOnce({ ok: false, message: "Sin permisos" })
    expect(await linkInboxPlateAction({ batchId: "batch-a", plate: "ZZZZ99", vehicleId: "veh-1" })).toEqual({ ok: false, message: "Sin permisos" })
    linkConsumptionPlateAction.mockResolvedValueOnce({ ok: true, message: "Patente vinculada" })
    expect(await linkInboxPlateAction({ batchId: "batch-a", plate: "ZZZZ99", vehicleId: "veh-1" })).toEqual({ ok: true, message: "Patente vinculada" })
    const form = linkConsumptionPlateAction.mock.calls.at(-1)![1] as FormData
    expect([form.get("batchId"), form.get("patente"), form.get("vehicleId")]).toEqual(["batch-a", "ZZZZ99", "veh-1"])
    expect((await linkInboxPlateAction({ batchId: "batch-a", plate: "ZZZZ99" } as never)).ok).toBe(false)
  })
})
