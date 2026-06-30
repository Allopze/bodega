import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { eq } from "drizzle-orm"
import { drizzle } from "drizzle-orm/pglite"
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest"
import { migratePGlite } from "@/lib/testing/pglite-migrate"
import * as schema from "@/db/schema"
import { extractPdtpCatalogFromWorkbook, readPdtpWorkbook } from "@/lib/services/prevention-pdtp-catalog"

const pg = new PGlite()
const inMemoryDb = drizzle(pg, { schema })
const testGlobal = globalThis as typeof globalThis & { __db?: typeof inMemoryDb }
// @ts-expect-error PGlite is compatible at runtime
testGlobal.__db = inMemoryDb

vi.mock("@/db", () => ({
  get db() {
    return testGlobal.__db
  },
}))

await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))

afterAll(async () => {
  delete testGlobal.__db
  await pg.close()
})

beforeEach(async () => {
  await inMemoryDb.delete(schema.pdtpSheetActivities)
  await inMemoryDb.delete(schema.pdtpSheets)
  await inMemoryDb.delete(schema.pdtpActivitySchedule)
  await inMemoryDb.delete(schema.pdtpExecutions)
  await inMemoryDb.delete(schema.pdtpActivities)
  await inMemoryDb.delete(schema.pdtpResponsibleCatalog)
  await inMemoryDb.delete(schema.pdtpPrograms)
  await inMemoryDb.delete(schema.worksites)
  await inMemoryDb.delete(schema.users)

  await inMemoryDb.insert(schema.users).values({
    id: "user-1",
    name: "Prevencionista",
    email: "prev@example.test",
    hashedPassword: "x",
  })
  await inMemoryDb.insert(schema.worksites).values({
    id: "ws-1",
    name: "Faena A",
    code: "FA",
    isActive: true,
  })
})

describe("prevention PDTP service", () => {
  it("loads the XLSX catalog idempotently into the PDTP program tables", async () => {
    const { loadPdtpCatalog } = await import("@/lib/services/prevention-pdtp")
    const workbook = readPdtpWorkbook(path.resolve(process.cwd(), "PROGRAMA DE TRABAJO PREVENTIVO SG-SST 2026.xlsx"))
    const catalog = extractPdtpCatalogFromWorkbook(workbook)

    const first = await loadPdtpCatalog({
      year: 2026,
      version: 1,
      title: "Programa de Trabajo Preventivo SG-SST 2026",
      catalog,
      userId: "user-1",
    })
    const second = await loadPdtpCatalog({
      year: 2026,
      version: 1,
      title: "Programa de Trabajo Preventivo SG-SST 2026",
      catalog,
      userId: "user-1",
    })

    expect(second.program.id).toBe(first.program.id)

    const activities = await inMemoryDb.select().from(schema.pdtpActivities)
    const sheets = await inMemoryDb.select().from(schema.pdtpSheets)
    const memberships = await inMemoryDb.select().from(schema.pdtpSheetActivities)
    const schedule = await inMemoryDb.select().from(schema.pdtpActivitySchedule)

    expect(activities).toHaveLength(89)
    expect(sheets).toHaveLength(8)
    const expectedMemberships = Object.values(catalog.sheetActivities).reduce((sum, items) => sum + items.length, 0)
    expect(memberships).toHaveLength(expectedMemberships)
    expect(schedule.some((cell) => cell.plannedQuantity === 5)).toBe(true)
  })

  it("returns a read-only sheet view with monthly planned totals", async () => {
    const { loadPdtpCatalog, getPdtpSheetView } = await import("@/lib/services/prevention-pdtp")
    const workbook = readPdtpWorkbook(path.resolve(process.cwd(), "PROGRAMA DE TRABAJO PREVENTIVO SG-SST 2026.xlsx"))
    const catalog = extractPdtpCatalogFromWorkbook(workbook)

    await loadPdtpCatalog({
      year: 2026,
      version: 1,
      title: "Programa de Trabajo Preventivo SG-SST 2026",
      catalog,
      userId: "user-1",
    })

    const view = await getPdtpSheetView(2026, "sup_jt")

    expect(view?.sheet.label).toBe("Supervisión y jefatura de terreno")
    expect(view?.activities).toHaveLength(18)
    expect(view?.activities.map((activity) => activity.n)).toEqual([
      15, 24, 26, 29, 31, 34, 38, 39, 40, 52, 64, 66, 68, 69, 71, 73, 75, 76,
    ])
    expect(view?.monthlyTotals.some((month) => month.planned > 0)).toBe(true)
    expect(view?.activities.find((activity) => activity.n === 38)?.totalPlanned).toBeGreaterThan(12)
  })

  it("marks weekly execution quantities idempotently inside worksite scope", async () => {
    const { loadPdtpCatalog, markPdtpExecution } = await import("@/lib/services/prevention-pdtp")
    const workbook = readPdtpWorkbook(path.resolve(process.cwd(), "PROGRAMA DE TRABAJO PREVENTIVO SG-SST 2026.xlsx"))
    const catalog = extractPdtpCatalogFromWorkbook(workbook)

    await loadPdtpCatalog({
      year: 2026,
      version: 1,
      title: "Programa de Trabajo Preventivo SG-SST 2026",
      catalog,
      userId: "user-1",
    })

    const [activity] = await inMemoryDb.select().from(schema.pdtpActivities).where(eq(schema.pdtpActivities.n, 38))

    const first = await markPdtpExecution({
      activityId: activity!.id,
      worksiteId: "ws-1",
      year: 2026,
      month: 1,
      week: 1,
      executedQuantity: 3,
      evidenceText: "Charla ejecutada en turno A",
    }, "user-1", ["ws-1"])

    const second = await markPdtpExecution({
      activityId: activity!.id,
      worksiteId: "ws-1",
      year: 2026,
      month: 1,
      week: 1,
      executedQuantity: 5,
      evidenceText: "Charla completada",
    }, "user-1", ["ws-1"])

    expect(second.id).toBe(first.id)
    expect(second.executedQuantity).toBe(5)
    expect(second.evidenceText).toBe("Charla completada")

    const executions = await inMemoryDb.select().from(schema.pdtpExecutions)
    expect(executions).toHaveLength(1)

    await expect(markPdtpExecution({
      activityId: activity!.id,
      worksiteId: "ws-1",
      year: 2026,
      month: 1,
      week: 2,
      executedQuantity: 1,
    }, "user-1", [])).rejects.toThrow(/sin acceso/i)
  })

  it("includes execution totals for the selected worksite in the sheet view", async () => {
    const { loadPdtpCatalog, markPdtpExecution, getPdtpSheetView } = await import("@/lib/services/prevention-pdtp")
    const workbook = readPdtpWorkbook(path.resolve(process.cwd(), "PROGRAMA DE TRABAJO PREVENTIVO SG-SST 2026.xlsx"))
    const catalog = extractPdtpCatalogFromWorkbook(workbook)

    await loadPdtpCatalog({
      year: 2026,
      version: 1,
      title: "Programa de Trabajo Preventivo SG-SST 2026",
      catalog,
      userId: "user-1",
    })

    const [activity] = await inMemoryDb.select().from(schema.pdtpActivities).where(eq(schema.pdtpActivities.n, 38))
    await markPdtpExecution({
      activityId: activity!.id,
      worksiteId: "ws-1",
      year: 2026,
      month: 1,
      week: 1,
      executedQuantity: 4,
    }, "user-1", ["ws-1"])

    const view = await getPdtpSheetView(2026, "sup_jt", "ws-1")
    const row = view?.activities.find((item) => item.n === 38)

    expect(row?.monthlyExecuted[0]).toBe(4)
    expect(row?.totalExecuted).toBe(4)
    expect(view?.monthlyTotals[0]?.executed).toBe(4)
  })

  it("builds an XLSX report payload for the selected sheet and worksite", async () => {
    const { loadPdtpCatalog, buildPdtpExport } = await import("@/lib/services/prevention-pdtp")
    const workbook = readPdtpWorkbook(path.resolve(process.cwd(), "PROGRAMA DE TRABAJO PREVENTIVO SG-SST 2026.xlsx"))
    const catalog = extractPdtpCatalogFromWorkbook(workbook)

    await loadPdtpCatalog({
      year: 2026,
      version: 1,
      title: "Programa de Trabajo Preventivo SG-SST 2026",
      catalog,
      userId: "user-1",
    })

    const report = await buildPdtpExport({ year: 2026, sheetCode: "cphs", worksiteId: "ws-1" })

    expect(report.filenameBase).toBe("pdtp-sg-sst-2026-cphs")
    expect(report.worksheetName).toBe("Comité Paritario Higiene SST")
    expect(report.headers).toContain("Ene P")
    expect(report.headers).toContain("Ene E")
    expect(report.rows).toHaveLength(4)
    expect(report.rows[0]?.[0]).toBe(11)
  })
})
