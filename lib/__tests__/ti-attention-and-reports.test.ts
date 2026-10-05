import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { migratePGlite } from "@/lib/testing/pglite-migrate"
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest"
import path from "node:path"
import * as schema from "@/db/schema"
import { nanoid } from "@/lib/id"

const pg = new PGlite()
const inMemoryDb = drizzle(pg, { schema })
const testGlobal = globalThis as typeof globalThis & { __db?: typeof inMemoryDb }
// @ts-expect-error — PGlite es estructuralmente compatible en runtime
testGlobal.__db = inMemoryDb

vi.mock("@/db", () => ({
  get db() {
    return testGlobal.__db
  },
}))

await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))

import { getTiAttentionItems, getAssetsByWorksiteGroup } from "@/lib/services/ti/queries"
import { accessSheet, checklistSheet, licenseSheets, ticketSlaVerdict, ticketsSheet } from "@/lib/services/ti/reports"
import { fillMaintenanceMonths, monthLabel, compactCLP } from "@/lib/services/ti/dashboard"
import { todayInChile } from "@/lib/utils"

const NOW = new Date()
const iso = (offsetHours: number) => new Date(NOW.getTime() + offsetHours * 3_600_000).toISOString()
const day = (offsetDays: number) => {
  const d = new Date(`${todayInChile()}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + offsetDays)
  return d.toISOString().slice(0, 10)
}

const W1 = nanoid()
const W2 = nanoid()
const USER = nanoid()
const TYPE = nanoid()

describe("TI: Atención hoy y reportes", () => {
  beforeAll(async () => {
    const t = inMemoryDb
    await t.insert(schema.worksites).values([
      { id: W1, name: "Masisa", code: "FN-W1" },
      { id: W2, name: "Oficina Central", code: "FN-W2" },
    ])
    await t.insert(schema.users).values({ id: USER, name: "Técnica", email: "t@x.cl", hashedPassword: "x" })
    await t.insert(schema.itAssetTypes).values({ id: TYPE, name: "Notebook", category: "computacion" })

    const worker = (id: string, w: string, active: boolean) => t.insert(schema.workers)
      .values({ id, firstName: "Ana", lastName: id.slice(0, 4), worksiteId: w, isActive: active })
    const wActive1 = nanoid(); const wInactive2 = nanoid(); const wOffboard1 = nanoid()
    await worker(wActive1, W1, true); await worker(wInactive2, W2, false); await worker(wOffboard1, W1, true)

    const asset = async (code: string, w: string, status: string, extra: Record<string, unknown> = {}) => {
      const id = nanoid()
      await t.insert(schema.itAssets).values({ id, code, assetTypeId: TYPE, worksiteId: w, status, ...extra })
      return id
    }
    const a1 = await asset("TI-1", W1, "asignado", { warrantyEndDate: day(10) })
    const a2 = await asset("TI-2", W2, "en_prestamo")
    await asset("TI-3", W1, "disponible")
    const a4 = await asset("TI-4", W2, "en_reparacion", { updatedAt: iso(-24 * 20) })
    await asset("TI-5", W2, "en_reparacion") // reparación reciente: no entra en «hace más de 14 días»
    void a4

    const assignment = (code: string, assetId: string, w: string, extra: Record<string, unknown>) =>
      t.insert(schema.itAssetAssignments).values({
        id: nanoid(), code, assetId, workerId: wActive1, worksiteId: w, deliveredAt: iso(-48),
        deliveredByUserId: USER, ...extra,
      })
    await assignment("ACT-1", a1, W1, { acceptanceStatus: "pendiente" })
    await assignment("ACT-2", a2, W2, { kind: "loan", acceptanceStatus: "aceptada", acceptedAt: iso(-24), acceptedByUserId: USER, expectedReturnDate: day(-3) })

    const ticket = (code: string, w: string, status: string, dueAt: string | null, resolvedAt: string | null = null) =>
      t.insert(schema.itTickets).values({
        id: nanoid(), code, subject: `Asunto ${code}`, description: "d", status, requesterUserId: USER,
        worksiteId: w, dueAt, resolvedAt,
      })
    await ticket("INC-1", W1, "nuevo", iso(-5))        // vencido
    await ticket("INC-2", W1, "en_progreso", iso(10))  // por vencer
    await ticket("INC-3", W2, "en_progreso", iso(100)) // en plazo
    await ticket("INC-4", W2, "resuelto", iso(-50), iso(-60)) // cerrado a tiempo

    const lic = nanoid()
    await t.insert(schema.itLicenses).values({ id: lic, name: "Office", purchasedQuantity: 5, renewalDate: day(7), periodicity: "anual", cost: 100 })
    await t.insert(schema.itLicenseAssignments).values([
      { id: nanoid(), licenseId: lic, workerId: wActive1 },
      { id: nanoid(), licenseId: lic, workerId: wInactive2 },
    ])

    const sys = nanoid()
    await t.insert(schema.itAccessSystems).values({ id: sys, name: "ERP" })
    await t.insert(schema.itSystemAccess).values([
      { id: nanoid(), systemId: sys, workerId: wInactive2, status: "activo" },
      { id: nanoid(), systemId: sys, workerId: wActive1, status: "activo" },
    ])

    const cl = nanoid()
    await t.insert(schema.itWorkerChecklists).values({ id: cl, workerId: wOffboard1, kind: "offboarding", createdByUserId: USER })
    await t.insert(schema.itChecklistTasks).values([
      { id: nanoid(), checklistId: cl, name: "Revocar correo", done: true, position: 0 },
      { id: nanoid(), checklistId: cl, name: "Retirar equipo", done: false, position: 1 },
    ])
  })

  afterAll(async () => {
    await pg.close()
  })

  it("Atención hoy cuenta cada pendiente con su desglose por faena", async () => {
    const items = await getTiAttentionItems("all", NOW)
    const byKey = Object.fromEntries(items.map((i) => [i.key, i]))
    expect(byKey["acuse"]?.total).toBe(1)
    expect(byKey["acuse"]?.byWorksite).toEqual([{ name: "Masisa", total: 1 }])
    expect(byKey["prestamos"]?.byWorksite).toEqual([{ name: "Oficina Central", total: 1 }])
    expect(byKey["tickets-vencidos"]?.total).toBe(1)
    expect(byKey["tickets-por-vencer"]?.total).toBe(1)
    expect(byKey["garantias"]?.total).toBe(1)
    expect(byKey["licencias"]?.total).toBe(1)
    expect(byKey["accesos-inactivos"]?.byWorksite).toEqual([{ name: "Oficina Central", total: 1 }])
    expect(byKey["egresos"]?.total).toBe(1)
    expect(byKey["reparaciones"]?.total).toBe(1)
    expect(byKey["acuse"]?.href).toBe("/ti/asignaciones?acuse=pendiente")
  })

  it("acota Atención hoy al alcance de faena y omite lo que no tiene conteo", async () => {
    const items = await getTiAttentionItems([W1], NOW)
    const keys = items.map((i) => i.key)
    expect(keys).toContain("acuse")
    expect(keys).not.toContain("prestamos")
    expect(keys).not.toContain("accesos-inactivos")
    expect(keys).not.toContain("reparaciones")
    expect(await getTiAttentionItems([], NOW)).toEqual([])
  })

  it("reparte el parque por faena en cuatro grupos", async () => {
    const rows = await getAssetsByWorksiteGroup()
    const oficina = rows.find((r) => r.worksiteName === "Oficina Central")
    expect(oficina).toMatchObject({ inUse: 1, available: 0, inRepair: 2, other: 0 })
  })

  it("el reporte de tickets trae las columnas pedidas y veredicto de plazo", async () => {
    const sheet = await ticketsSheet("all", {}, NOW)
    expect(sheet.headers).toEqual(["Código", "Asunto", "Categoría", "Prioridad", "Estado", "Faena", "Solicitante", "Técnico", "Creado", "Vence", "Resuelto", "Plazo"])
    const plazo = Object.fromEntries(sheet.rows.map((r) => [r[0], r[11]]))
    expect(plazo).toEqual({
      "INC-1": "Fuera de plazo", "INC-2": "Dentro de plazo", "INC-3": "Dentro de plazo", "INC-4": "Dentro de plazo",
    })
  })

  it("los reportes respetan el alcance y el filtro de faena se intersecta con él", async () => {
    expect((await ticketsSheet([W1], {}, NOW)).rows.map((r) => r[0]).sort()).toEqual(["INC-1", "INC-2"])
    // Filtrar por una faena fuera del alcance no la expone: cero filas.
    expect((await ticketsSheet([W1], { worksiteId: W2 }, NOW)).rows).toEqual([])
    expect((await ticketsSheet("all", { worksiteId: W2 }, NOW)).rows).toHaveLength(2)
    expect((await accessSheet([W1])).rows.map((r) => r[2])).toEqual(["Masisa"])
    expect((await accessSheet("all")).rows).toHaveLength(2)
    expect((await checklistSheet([W2])).rows).toEqual([])
    const [egresos] = [await checklistSheet([W1])]
    expect(egresos.rows[0]).toEqual(expect.arrayContaining(["Egreso", "1 de 2", 1]))
  })

  it("el reporte de licencias calcula cupos libres con lo que el usuario ve", async () => {
    const [licencias, asignaciones] = await licenseSheets("all")
    expect(licencias?.rows[0]).toEqual(expect.arrayContaining(["Office", 5, 2, 3]))
    expect(asignaciones?.rows).toHaveLength(2)
    const [scopedLic, scopedAsig] = await licenseSheets([W1])
    expect(scopedLic?.rows[0]).toEqual(expect.arrayContaining([5, 1, 4]))
    expect(scopedAsig?.rows).toHaveLength(1)
  })

  it("helpers puros", () => {
    expect(ticketSlaVerdict(null, null)).toBe("Sin plazo")
    expect(monthLabel("2026-09")).toBe("sep 2026")
    const filled = fillMaintenanceMonths([{ month: "2026-09", cost: 10, count: 1 }], "2026-10-05", 3)
    expect(filled.map((p) => p.label)).toEqual(["ago 2026", "sep 2026", "oct 2026"])
    expect(filled[1]).toMatchObject({ cost: 10, count: 1 })
    expect(compactCLP(1_250_000)).toContain("M")
  })
})
