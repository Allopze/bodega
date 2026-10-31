import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { beforeAll, describe, expect, it, vi } from "vitest"
import * as schema from "@/db/schema"
import type { DB } from "@/db"
import { migratePGlite } from "@/lib/testing/pglite-migrate"
import { IDS, filtersFor, globalSession, scopedSession, seedControlFixtures, submission } from "./test-fixtures"

const pg = new PGlite()
const testDb = drizzle(pg, { schema }) as unknown as DB
const g = globalThis as typeof globalThis & { __db?: DB }
g.__db = testDb
vi.mock("@/db", () => ({ get db() { return g.__db } }))

const { getSealJustifications, getSupervisorSealSummary, listSealDetail, listSealVehicles } = await import("./seals")
const { getSealHistory } = await import("@/lib/combustibles/seal-history")

beforeAll(async () => {
  await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))
  await seedControlFixtures(testDb)
  await testDb.insert(schema.fuelTaeSubmissions).values([
    // Pérez: 3 cargas válidas en marzo (una sin sello retirado, una sin sello nuevo con motivo, una con cadena rota).
    submission({ id: "s-ok", liters: 100, supervisorNameSnapshot: "Supervisor Pérez" }),
    submission({ id: "s-no-removed", liters: 50, removedSealNumber: null, supervisorNameSnapshot: "supervisor  pérez ", noSealReason: "Sello ilegible", loadedAt: "2026-03-11T15:00:00.000Z" }),
    submission({ id: "s-no-installed", liters: 25, installedSealNumber: "  ", supervisorNameSnapshot: "SUPERVISOR PÉREZ", noSealReason: null, sealChainStatus: "mismatch", sealChainExpected: "I-0", loadedAt: "2026-03-12T15:00:00.000Z" }),
    // Anulada: no cuenta en nada.
    submission({ id: "s-void", liters: 999, status: "voided", removedSealNumber: null }),
    // Otro supervisor, en otra faena y con fecha de abril.
    submission({ id: "s-other", worksiteId: IDS.wsB, vehicleId: IDS.vB, equipmentCodeSnapshot: "KB-2", supervisorNameSnapshot: "Ana Soto", liters: 70, loadedAt: "2026-04-20T15:00:00.000Z" }),
    // Borde de mes: 2026-04-01 02:00 UTC es 31 de marzo en Chile.
    submission({ id: "s-border", loadedAt: "2026-04-01T02:00:00.000Z", liters: 10, supervisorNameSnapshot: "Supervisor Pérez" }),
  ])
}, 60_000)

describe("getSupervisorSealSummary", () => {
  it("agrupa por nombre normalizado, cuenta faltas de sello y cadenas rotas, y excluye anuladas", async () => {
    const rows = await getSupervisorSealSummary(globalSession(), filtersFor({ meses: "3" }), { canViewPersonal: true })
    expect(rows).toHaveLength(1)
    // s-border (2026-04-01T02:00Z) es 31 de marzo en Chile y entra a marzo.
    expect(rows[0]).toMatchObject({ loads: 4, liters: 185, withoutRemovedSeal: 1, withoutInstalledSeal: 1, chainBreaks: 1 })
    expect(rows[0]?.name).toMatch(/p[ée]rez/i)
  })

  it("sin view_personal el nombre sale «Reservado» pero los conteos se conservan", async () => {
    const rows = await getSupervisorSealSummary(globalSession(), filtersFor({ meses: "3,4" }), { canViewPersonal: false })
    expect(rows.map((row) => row.name)).toEqual(["Reservado", "Reservado"])
    expect(rows.reduce((sum, row) => sum + row.loads, 0)).toBe(5)
    expect(JSON.stringify(rows)).not.toMatch(/p[ée]rez|soto/i)
  })

  it("respeta el alcance de faena y el filtro de mandante", async () => {
    const scoped = await getSupervisorSealSummary(scopedSession([IDS.wsB]), filtersFor({ meses: "3,4" }), { canViewPersonal: true })
    expect(scoped.map((row) => row.name)).toEqual(["Ana Soto"])
    const none = await getSupervisorSealSummary(scopedSession([]), filtersFor({ meses: "3,4" }), { canViewPersonal: true })
    expect(none).toEqual([])
    const otherMandante = await getSupervisorSealSummary(globalSession(), filtersFor({ meses: "3,4", mandante: IDS.m2 }), { canViewPersonal: true })
    expect(otherMandante).toEqual([])
  })

  it("el rango desde/hasta manda sobre año y meses", async () => {
    const rows = await getSupervisorSealSummary(globalSession(), filtersFor({ meses: "3", desde: "2026-04-15", hasta: "2026-04-30" }), { canViewPersonal: true })
    expect(rows.map((row) => row.name)).toEqual(["Ana Soto"])
  })
})

describe("getSealJustifications", () => {
  it("lista las cargas sin sello con su motivo, ligadas al supervisor", async () => {
    const filters = filtersFor({ meses: "3" })
    const [summary, items] = await Promise.all([
      getSupervisorSealSummary(globalSession(), filters, { canViewPersonal: true }),
      getSealJustifications(globalSession(), filters, { canViewPersonal: true }),
    ])
    expect(items).toHaveLength(2)
    expect(items.every((item) => item.supervisorKey === summary[0]?.key)).toBe(true)
    expect(items.find((item) => item.submissionId === "s-no-removed")).toMatchObject({ missing: "removed", reason: "Sello ilegible", equipment: "KA-1" })
    expect(items.find((item) => item.submissionId === "s-no-installed")).toMatchObject({ missing: "installed", reason: null })
  })

  it("con nombres reservados las llaves siguen emparejando con el resumen", async () => {
    const filters = filtersFor({ meses: "3" })
    const access = { canViewPersonal: false }
    const [summary, items] = await Promise.all([getSupervisorSealSummary(globalSession(), filters, access), getSealJustifications(globalSession(), filters, access)])
    expect(items.every((item) => item.supervisorKey === summary[0]?.key)).toBe(true)
  })
})

describe("listSealDetail", () => {
  it("pagina, ordena por fecha descendente y filtra por equipo", async () => {
    const access = { canViewPersonal: true, limit: 2, offset: 0 }
    const first = await listSealDetail(globalSession(), filtersFor({ meses: "3,4" }), access)
    expect(first.total).toBe(5)
    expect(first.rows).toHaveLength(2)
    expect(first.rows[0]?.id).toBe("s-other")
    const second = await listSealDetail(globalSession(), filtersFor({ meses: "3,4" }), { ...access, offset: 2 })
    expect(second.rows.map((row) => row.id)).not.toContain("s-other")
    const byEquipment = await listSealDetail(globalSession(), filtersFor({ meses: "3,4", equipo: IDS.vB }), { ...access, limit: 50 })
    expect(byEquipment.rows.map((row) => row.id)).toEqual(["s-other"])
  })

  it("expone el origen de la hora, la cadena de sellos y enmascara a las personas sin permiso", async () => {
    const { rows } = await listSealDetail(globalSession(), filtersFor({ meses: "3" }), { canViewPersonal: false, limit: 50, offset: 0 })
    const broken = rows.find((row) => row.id === "s-no-installed")
    expect(broken).toMatchObject({ sealChainStatus: "mismatch", sealChainExpected: "I-0", loadedAtSource: "device", driver: "Reservado", supervisor: "Reservado" })
    expect(rows.every((row) => row.id !== "s-void")).toBe(true)
  })
})

describe("listSealVehicles", () => {
  it("devuelve solo equipos con cargas dentro del alcance", async () => {
    expect((await listSealVehicles(globalSession(), filtersFor())).map((v) => v.id).sort()).toEqual([IDS.vA, IDS.vB])
    expect((await listSealVehicles(scopedSession([IDS.wsA]), filtersFor())).map((v) => v.id)).toEqual([IDS.vA])
  })
})

/**
 * Historial de sellos. El último sello de cada equipo no es un problema: todavía
 * no hay una carga siguiente que lo retire. Sólo es «sin retiro posterior» si el
 * equipo volvió a cargar y esa carga no lo retiró.
 */
describe("getSealHistory — el último sello de cada equipo no es un problema", () => {
  const validated = (overrides: Partial<typeof schema.fuelTaeSubmissions.$inferInsert>) => submission({ status: "validated", ...overrides })

  beforeAll(async () => {
    await testDb.insert(schema.fuelTaeSubmissions).values([
      // KA-1: 0001 → 0002 → 0003 → 0004. La cadena está completa y 0004 es el sello vigente.
      validated({ id: "h-a1", loadedAt: "2026-05-01T15:00:00.000Z", removedSealNumber: "0001", installedSealNumber: "0002" }),
      validated({ id: "h-a2", loadedAt: "2026-05-10T15:00:00.000Z", removedSealNumber: "0002", installedSealNumber: "0003" }),
      validated({ id: "h-a3", loadedAt: "2026-05-20T15:00:00.000Z", removedSealNumber: "0003", installedSealNumber: "0004" }),
      // KB-2: instaló 0102 y la carga siguiente retiró otro sello (0999): 0102 quedó sin retiro y el equipo volvió a cargar.
      validated({ id: "h-b1", worksiteId: IDS.wsB, vehicleId: IDS.vB, equipmentCodeSnapshot: "KB-2", loadedAt: "2026-05-05T15:00:00.000Z", removedSealNumber: "0101", installedSealNumber: "0102" }),
      validated({ id: "h-b2", worksiteId: IDS.wsB, vehicleId: IDS.vB, equipmentCodeSnapshot: "KB-2", loadedAt: "2026-05-15T15:00:00.000Z", removedSealNumber: "0999", installedSealNumber: "0103" }),
      // Otro equipo cuya carga siguiente quedó sin validar: sólo cuentan las validadas, así que 0201 es su sello vigente.
      validated({ id: "h-c1", worksiteId: IDS.wsC, vehicleId: IDS.vC, equipmentCodeSnapshot: "CC-3", loadedAt: "2026-05-06T15:00:00.000Z", removedSealNumber: "0200", installedSealNumber: "0201" }),
      submission({ id: "h-c2", worksiteId: IDS.wsC, vehicleId: IDS.vC, equipmentCodeSnapshot: "CC-3", loadedAt: "2026-05-16T15:00:00.000Z", status: "submitted", removedSealNumber: "0201", installedSealNumber: "0202" }),
      // Una carga sin equipo asociado se sigue por su patente.
      validated({ id: "h-z1", vehicleId: null, plateSnapshot: "ZZ-9999", equipmentCodeSnapshot: "ZZ", loadedAt: "2026-05-02T15:00:00.000Z", removedSealNumber: "0300", installedSealNumber: "0301" }),
      validated({ id: "h-z2", vehicleId: null, plateSnapshot: "ZZ-9999", equipmentCodeSnapshot: "ZZ", loadedAt: "2026-05-12T15:00:00.000Z", removedSealNumber: "0777", installedSealNumber: "0302" }),
    ])
  }, 60_000)

  const byId = (rows: Awaited<ReturnType<typeof getSealHistory>>) => new Map(rows.map((row) => [row.submissionId, row]))
  const may = { from: "2026-05-01", to: "2026-05-31" }

  it("el sello vigente del equipo no se marca como cadena rota; el retirado después enlaza a quien lo retiró", async () => {
    const rows = byId(await getSealHistory(globalSession(), may))
    expect(rows.get("h-a3")).toMatchObject({ installedSeal: "0004", continuityBroken: false, isLatestForEquipment: true, nextRemovedAt: null })
    expect(rows.get("h-a1")).toMatchObject({ continuityBroken: false, isLatestForEquipment: false, nextRemovedBy: expect.stringContaining("KA-1") })
    expect(rows.get("h-a2")).toMatchObject({ continuityBroken: false, nextRemovedAt: "2026-05-20 11:00" })
    expect(rows.get("h-a3")?.vehicleId).toBe(IDS.vA)
  })

  it("si el equipo volvió a cargar y nadie retiró el sello, sí es una cadena rota", async () => {
    const rows = byId(await getSealHistory(globalSession(), may))
    expect(rows.get("h-b1")).toMatchObject({ installedSeal: "0102", continuityBroken: true, isLatestForEquipment: false })
    expect(rows.get("h-b2")).toMatchObject({ installedSeal: "0103", continuityBroken: false, isLatestForEquipment: true })
  })

  it("una carga posterior sin validar no convierte el sello vigente en un problema", async () => {
    const rows = byId(await getSealHistory(globalSession(), may))
    expect(rows.get("h-c1")).toMatchObject({ continuityBroken: false, isLatestForEquipment: true })
    expect(rows.has("h-c2")).toBe(false)
  })

  it("sin equipo asociado se sigue por la patente", async () => {
    const rows = byId(await getSealHistory(globalSession(), may))
    expect(rows.get("h-z1")).toMatchObject({ vehicleId: null, continuityBroken: true, isLatestForEquipment: false })
    expect(rows.get("h-z2")).toMatchObject({ continuityBroken: false, isLatestForEquipment: true })
  })

  it("filtrar el período no cambia el veredicto: la carga siguiente puede caer fuera del recorte", async () => {
    // Sólo la primera quincena: la última carga de KA-1 (20 de mayo) queda fuera, pero 0003 sí se retiró ahí.
    const early = byId(await getSealHistory(globalSession(), { from: "2026-05-01", to: "2026-05-12" }))
    expect(early.get("h-a2")).toMatchObject({ continuityBroken: false, nextRemovedAt: "2026-05-20 11:00" })
    // Y el sello de KB-2 sigue roto: su carga siguiente (15 de mayo) está fuera del recorte pero no lo retiró.
    expect(early.get("h-b1")).toMatchObject({ continuityBroken: true })
    // Sólo la última carga de cada equipo: sigue siendo el sello vigente aunque el recorte no muestre nada posterior.
    const late = byId(await getSealHistory(globalSession(), { from: "2026-05-18", to: "2026-05-31" }))
    expect(late.get("h-a3")).toMatchObject({ continuityBroken: false, isLatestForEquipment: true })
  })

  it("respeta el alcance de faena", async () => {
    const rows = await getSealHistory(scopedSession([IDS.wsB]), may)
    expect(rows.map((row) => row.submissionId).sort()).toEqual(["h-b1", "h-b2"])
  })
})
