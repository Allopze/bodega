/**
 * lib/__tests__/pdtp-obligations-pagination.test.ts
 *
 * PREV-M09: `listPdtpObligations` traía todas las obligaciones abiertas sin
 * límite y la pantalla filtraba en memoria. `listPdtpObligationsPage` pagina en
 * la base y filtra allí por estado efectivo (una `pending` vencida cuenta como
 * `overdue`, igual que antes en memoria), faena y texto, con los contadores de
 * los tiles calculados sobre el mismo filtro.
 */
import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import { migratePGlite } from "@/lib/testing/pglite-migrate"
import * as schema from "@/db/schema"

const pg = new PGlite()
const inMemoryDb = drizzle(pg, { schema })
const testGlobal = globalThis as typeof globalThis & { __db?: typeof inMemoryDb }
// @ts-expect-error PGlite is compatible at runtime
testGlobal.__db = inMemoryDb

vi.mock("@/db", () => ({
  get db() { return testGlobal.__db },
}))

await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))

afterAll(async () => {
  delete testGlobal.__db
  await pg.close()
})

const { listPdtpObligationsPage, listPdtpObligations } = await import("@/lib/services/pdtp/obligations")

const NOW = new Date("2026-06-15T12:00:00.000Z")
const PROGRAM_ID = "pdtp-obl-page-v1"
const WS_A = "ws-obl-a"
const WS_B = "ws-obl-b"
const ACT_1 = `${PROGRAM_ID}-a-001`
const ACT_2 = `${PROGRAM_ID}-a-002`

beforeAll(async () => {
  const now = NOW.toISOString()
  await inMemoryDb.insert(schema.worksites).values([
    { id: WS_A, name: "Faena Alfa", code: "FA", isActive: true },
    { id: WS_B, name: "Faena Beta", code: "FB", isActive: true },
  ])
  await inMemoryDb.insert(schema.pdtpPrograms).values({
    id: PROGRAM_ID, version: 1, year: 2026, title: "PDTP 2026 paginación",
    status: "active", appliesToAllWorksites: true, elaboratedByName: "P", elaboratedByTitle: "E",
    creationMode: "blank", complianceTarget: 0.9, pesoEjecucion: 0.5, pesoVerificacion: 0.3, pesoCierre: 0.2,
    activatedAt: "2026-01-01T00:00:00.000Z", createdAt: now, updatedAt: now,
  })
  const base = {
    programId: PROGRAM_ID, program: "Prevención", responsibleSlugs: [], responsibleDisplay: "P",
    scheduleMode: "on_demand" as const, scheduleClassificationStatus: "confirmed" as const, mechanism: "formulario",
    createdAt: now, updatedAt: now,
  }
  await inMemoryDb.insert(schema.pdtpActivities).values([
    { ...base, id: ACT_1, n: 1, activity: "Inducción de hombre nuevo", sourceSheetRow: 1 },
    { ...base, id: ACT_2, n: 2, activity: "Investigación de incidente", sourceSheetRow: 2 },
  ])
  // 30 en Alfa: 12 pendientes a futuro, 10 pendientes ya vencidas (sin refrescar),
  // 5 marcadas `overdue`, 3 reportadas. En Beta: 4 pendientes, 2 completadas.
  const rows: Array<typeof schema.pdtpObligations.$inferInsert> = []
  const push = (i: number, worksiteId: string, activityId: string, status: string, dueAt: string | null, sourceId?: string) => rows.push({
    id: `obl-${String(i).padStart(3, "0")}`, programId: PROGRAM_ID, activityId, worksiteId, mode: "on_demand",
    status, origin: "manual", manualReason: "Caso manual de la prueba de paginación", plannedQuantity: 1, dueAt, sourceType: sourceId ? "incidente" : null, sourceId: sourceId ?? null,
    idempotencyKey: `obl-page-${i}`, sourceMetadataJson: {}, sourceOccurredAt: now, createdAt: now, updatedAt: now,
  })
  let i = 0
  for (let k = 0; k < 12; k++) push(i++, WS_A, ACT_1, "pending", `2026-07-${String(k + 1).padStart(2, "0")}T00:00:00.000Z`)
  for (let k = 0; k < 10; k++) push(i++, WS_A, ACT_2, "pending", `2026-05-${String(k + 1).padStart(2, "0")}T00:00:00.000Z`, k === 0 ? "INC-777" : undefined)
  for (let k = 0; k < 5; k++) push(i++, WS_A, ACT_1, "overdue", `2026-04-${String(k + 1).padStart(2, "0")}T00:00:00.000Z`)
  for (let k = 0; k < 3; k++) push(i++, WS_A, ACT_2, "reported", `2026-06-${String(k + 1).padStart(2, "0")}T00:00:00.000Z`)
  for (let k = 0; k < 4; k++) push(i++, WS_B, ACT_1, "pending", null)
  for (let k = 0; k < 2; k++) push(i++, WS_B, ACT_2, "completed", "2026-03-01T00:00:00.000Z")
  await inMemoryDb.insert(schema.pdtpObligations).values(rows)
})

describe("listPdtpObligationsPage", () => {
  it("pagina el trabajo abierto en la base: total, límite y desplazamiento", async () => {
    const first = await listPdtpObligationsPage({ scope: "all", limit: 25, offset: 0, now: NOW })
    expect(first.total).toBe(34)
    expect(first.rows).toHaveLength(25)
    const second = await listPdtpObligationsPage({ scope: "all", limit: 25, offset: 25, now: NOW })
    expect(second.rows).toHaveLength(9)
    const ids = [...first.rows, ...second.rows].map((row) => row.obligation.id)
    expect(new Set(ids).size).toBe(34)
    expect(ids).not.toContain("obl-034") // completada
  })

  it("mantiene el orden por plazo y deja sin plazo al final", async () => {
    const all = await listPdtpObligationsPage({ scope: "all", limit: 100, offset: 0, now: NOW })
    const due = all.rows.map((row) => row.obligation.dueAt)
    expect(due.slice(-4)).toEqual([null, null, null, null])
    const dated = due.filter((value): value is string => value !== null).map((value) => new Date(value).getTime())
    expect([...dated].sort((a, b) => a - b)).toEqual(dated)
  })

  it("filtra por estado efectivo: una pendiente vencida cuenta como vencida", async () => {
    const overdue = await listPdtpObligationsPage({ scope: "all", filter: "overdue", limit: 100, offset: 0, now: NOW })
    expect(overdue.total).toBe(15)
    expect(overdue.rows.every((row) => row.effectiveStatus === "overdue")).toBe(true)
    const pending = await listPdtpObligationsPage({ scope: "all", filter: "pending", limit: 100, offset: 0, now: NOW })
    expect(pending.total).toBe(16)
    expect(pending.rows.every((row) => row.effectiveStatus === "pending")).toBe(true)
    const reported = await listPdtpObligationsPage({ scope: "all", filter: "reported", limit: 100, offset: 0, now: NOW })
    expect(reported.total).toBe(3)
  })

  it("los contadores de los tiles usan el mismo criterio y respetan faena y texto", async () => {
    const all = await listPdtpObligationsPage({ scope: "all", filter: "reported", limit: 1, offset: 0, now: NOW })
    expect(all.counts).toEqual({ pending: 16, overdue: 15, reported: 3 })
    const beta = await listPdtpObligationsPage({ scope: "all", worksiteId: WS_B, limit: 1, offset: 0, now: NOW })
    expect(beta.counts).toEqual({ pending: 4, overdue: 0, reported: 0 })
    expect(beta.total).toBe(4)
  })

  it("busca en la base por actividad, faena y fuente, no sólo en la página visible", async () => {
    const byActivity = await listPdtpObligationsPage({ scope: "all", search: "investigación", limit: 5, offset: 0, now: NOW })
    expect(byActivity.total).toBe(13)
    const bySource = await listPdtpObligationsPage({ scope: "all", search: "INC-777", limit: 5, offset: 0, now: NOW })
    expect(bySource.rows.map((row) => row.obligation.id)).toEqual(["obl-012"])
    const byWorksite = await listPdtpObligationsPage({ scope: "all", search: "beta", limit: 5, offset: 0, now: NOW })
    expect(byWorksite.total).toBe(4)
    // Los comodines de LIKE se escapan.
    expect((await listPdtpObligationsPage({ scope: "all", search: "%", limit: 5, offset: 0, now: NOW })).total).toBe(0)
  })

  it("respeta el alcance de faenas", async () => {
    expect((await listPdtpObligationsPage({ scope: [WS_B], limit: 100, offset: 0, now: NOW })).total).toBe(4)
    expect(await listPdtpObligationsPage({ scope: [], limit: 100, offset: 0, now: NOW })).toEqual({ rows: [], total: 0, counts: { pending: 0, overdue: 0, reported: 0 } })
    await expect(listPdtpObligationsPage({ scope: [WS_B], worksiteId: WS_A, limit: 10, offset: 0, now: NOW })).rejects.toThrow()
  })

  it("listPdtpObligations sin paginar sigue igual para sus otros llamadores", async () => {
    const rows = await listPdtpObligations({ scope: "all", statuses: ["pending", "overdue", "reported"], now: NOW })
    expect(rows).toHaveLength(34)
  })
})
