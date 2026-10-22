import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { migratePGlite } from "@/lib/testing/pglite-migrate"
import { describe, it, expect, beforeAll, vi } from "vitest"
import path from "node:path"
import type { Session } from "next-auth"
import * as schema from "@/db/schema"
import { nanoid } from "@/lib/id"

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

await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))

const { getReviewQueue, parseReviewTab } = await import("@/lib/combustibles/control/review-queue")
const { parseControlFilters } = await import("@/lib/combustibles/control/filters")

function globalSession(): Session {
  return {
    user: { id: "u-global", name: "Global", email: "g@example.com", roles: ["administrador"], permissions: [], worksiteIds: [], primaryWorksiteId: null, avatarColor: null, isActive: true, isGlobal: true },
    expires: "2099-01-01T00:00:00.000Z",
  }
}

function scopedSession(worksiteIds: string[]): Session {
  return {
    user: { id: "u-scoped", name: "Scoped", email: "s@example.com", roles: ["solicitante_faena"], permissions: [], worksiteIds, primaryWorksiteId: worksiteIds[0] ?? null, avatarColor: null, isActive: true },
    expires: "2099-01-01T00:00:00.000Z",
  }
}

/** Cola de revisión (`getReviewQueue`) contra PostgreSQL: estados, alcance, paginación y promedio del equipo. */
describe("cola de revisión de cargas (PostgreSQL)", () => {
  const worksiteA = nanoid()
  const worksiteB = nanoid()
  const userId = nanoid()
  const typeId = nanoid()
  const vehicleId = nanoid()
  const batchId = nanoid()
  const ids = { flaggedA1: nanoid(), flaggedA2: nanoid(), flaggedB: nanoid(), approvedA: nanoid(), rejectedA: nanoid() }

  let counter = 0
  async function insertLoad(values: { id: string; worksiteId: string; reviewStatus: string; performanceValue: number | null; performanceStatus?: string; day: number; flagReasons?: string[]; reviewNote?: string; reviewed?: boolean }) {
    const recordId = nanoid()
    counter += 1
    await inMemoryDb.insert(schema.fuelOperationRecords).values({
      id: recordId, batchId, worksiteId: values.worksiteId, vehicleId, plate: "AB-CD12", fecha: `2026-03-${String(values.day).padStart(2, "0")}`, liters: 100,
    })
    await inMemoryDb.insert(schema.fuelEquipmentLoads).values({
      id: values.id,
      source: "operations_import",
      operationRecordId: recordId,
      vehicleId,
      worksiteId: values.worksiteId,
      occurredAt: `2026-03-${String(values.day).padStart(2, "0")}T15:00:00.000Z`,
      month: "2026-03",
      liters: 100,
      meterType: "odometer",
      meterReading: 1000 + counter * 100,
      performanceUnit: "km_per_liter",
      performanceValue: values.performanceValue,
      performanceStatus: values.performanceStatus ?? "computed",
      reviewStatus: values.reviewStatus,
      flagReasons: values.flagReasons ?? [],
      reviewNote: values.reviewNote,
      reviewedBy: values.reviewed ? userId : null,
      reviewedAt: values.reviewed ? "2026-03-20T12:00:00.000Z" : null,
    })
  }

  beforeAll(async () => {
    await inMemoryDb.insert(schema.worksites).values([
      { id: worksiteA, name: "Faena A", code: `FA-${nanoid().slice(0, 8)}`, isActive: true },
      { id: worksiteB, name: "Faena B", code: `FB-${nanoid().slice(0, 8)}`, isActive: true },
    ])
    await inMemoryDb.insert(schema.users).values({ id: userId, name: "Revisora", email: `rev-${nanoid()}@example.com`, hashedPassword: "x", isActive: true })
    await inMemoryDb.insert(schema.fuelEquipmentTypes).values({ id: typeId, slug: `camion-${nanoid().slice(0, 6)}`, name: "Camión" })
    await inMemoryDb.insert(schema.fuelVehicles).values({ id: vehicleId, plate: `RQ${nanoid().slice(0, 4).toUpperCase()}`, code: "KA-63", type: "camion", equipmentTypeId: typeId, worksiteId: worksiteA, isActive: true, performanceUnit: "km_per_liter" })
    await inMemoryDb.insert(schema.fuelOperationBatches).values({
      id: batchId, archivoNombre: "x.xlsx", hashArchivo: nanoid(), periodoDesde: "2026-03-01", periodoHasta: "2026-03-31", importadoPor: userId,
    })

    await insertLoad({ id: ids.flaggedA1, worksiteId: worksiteA, reviewStatus: "flagged", performanceValue: 9, day: 2, flagReasons: ["outlier", "valor-inventado"] })
    await insertLoad({ id: ids.flaggedA2, worksiteId: worksiteA, reviewStatus: "flagged", performanceValue: 1, day: 3, flagReasons: ["over_capacity"] })
    await insertLoad({ id: ids.flaggedB, worksiteId: worksiteB, reviewStatus: "flagged", performanceValue: 2, day: 4, flagReasons: ["implausible"] })
    await insertLoad({ id: ids.approvedA, worksiteId: worksiteA, reviewStatus: "approved", performanceValue: 4, day: 5, reviewNote: "Cambio de tablero confirmado", reviewed: true })
    await insertLoad({ id: ids.rejectedA, worksiteId: worksiteA, reviewStatus: "rejected", performanceValue: 50, day: 6, reviewNote: "Lectura mal digitada", reviewed: true })
    // Dos cargas válidas (ok) del equipo: junto con la aprobada (4) promedian (2+3+4)/3 = 3.
    await insertLoad({ id: nanoid(), worksiteId: worksiteA, reviewStatus: "ok", performanceValue: 2, day: 7 })
    await insertLoad({ id: nanoid(), worksiteId: worksiteA, reviewStatus: "ok", performanceValue: 3, day: 8 })
  })

  const filters = () => parseControlFilters({ anio: "2026" })

  it("devuelve las marcadas con motivos conocidos, origen y conteos por pestaña (alcance global)", async () => {
    const result = await getReviewQueue(globalSession(), filters(), parseReviewTab(undefined))
    expect(result.counts).toEqual({ "en-revision": 3, aprobadas: 1, rechazadas: 1 })
    expect(result.total).toBe(3)
    expect(result.rows.map((row) => row.id)).toEqual([ids.flaggedA1, ids.flaggedA2, ids.flaggedB])
    const first = result.rows[0]!
    expect(first.flagReasons).toEqual(["outlier"])
    expect(first.vehicleCode).toBe("KA-63")
    expect(first.worksiteName).toBe("Faena A")
    expect(first.source).toBe("operations_import")
    expect(first.originHref).toBe(`/combustibles/importar/operaciones/${batchId}`)
  })

  it("calcula el promedio del equipo solo con cargas estadísticamente válidas", async () => {
    const result = await getReviewQueue(globalSession(), filters(), parseReviewTab(undefined))
    const first = result.rows[0]!
    // ok(2) + ok(3) + approved(4); las marcadas y la rechazada no entran.
    expect(first.vehicleAverage).toBeCloseTo(3, 5)
    expect(first.vehicleAverageSamples).toBe(3)
  })

  it("limita cola y conteos al alcance de faena del usuario", async () => {
    const result = await getReviewQueue(scopedSession([worksiteA]), filters(), parseReviewTab(undefined))
    expect(result.counts["en-revision"]).toBe(2)
    expect(result.rows.map((row) => row.id)).not.toContain(ids.flaggedB)
    const none = await getReviewQueue(scopedSession([]), filters(), parseReviewTab(undefined))
    expect(none.total).toBe(0)
    expect(none.rows).toEqual([])
  })

  it("las pestañas de decididas traen nota y revisor", async () => {
    const approved = await getReviewQueue(globalSession(), filters(), parseReviewTab("aprobadas"))
    expect(approved.rows).toHaveLength(1)
    expect(approved.rows[0]).toMatchObject({ id: ids.approvedA, reviewNote: "Cambio de tablero confirmado", reviewerName: "Revisora" })
    const rejected = await getReviewQueue(globalSession(), filters(), parseReviewTab("rechazadas"))
    expect(rejected.rows.map((row) => row.id)).toEqual([ids.rejectedA])
  })

  it("pagina con el tamaño pedido y respeta los filtros de período", async () => {
    const page1 = await getReviewQueue(globalSession(), filters(), parseReviewTab(undefined), 2)
    expect(page1.rows).toHaveLength(2)
    expect(page1.total).toBe(3)
    const page2 = await getReviewQueue(globalSession(), parseControlFilters({ anio: "2026", pagina: "2" }), parseReviewTab(undefined), 2)
    expect(page2.rows.map((row) => row.id)).toEqual([ids.flaggedB])
    const otherMonth = await getReviewQueue(globalSession(), parseControlFilters({ anio: "2026", meses: "7" }), parseReviewTab(undefined))
    expect(otherMonth.total).toBe(0)
  })
})
