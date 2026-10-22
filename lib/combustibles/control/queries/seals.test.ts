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
