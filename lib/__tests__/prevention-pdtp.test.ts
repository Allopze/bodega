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
  const loadCatalog = async () => {
    const { loadPdtpCatalog } = await import("@/lib/services/prevention-pdtp")
    const workbook = readPdtpWorkbook(path.resolve(process.cwd(), "PROGRAMA DE TRABAJO PREVENTIVO SG-SST 2026.xlsx"))
    const catalog = extractPdtpCatalogFromWorkbook(workbook)
    return loadPdtpCatalog({
      year: 2026,
      version: 1,
      title: "Programa de Trabajo Preventivo SG-SST 2026",
      catalog,
      userId: "user-1",
    })
  }

  const loadActiveCatalog = async () => {
    const { approvePdtpProgramJdpr, signPdtpProgramLegal, activatePdtpProgram } =
      await import("@/lib/services/prevention-pdtp")
    const { program } = await loadCatalog()
    await approvePdtpProgramJdpr(program.id, "user-1")
    await signPdtpProgramLegal(program.id, "user-1")
    await activatePdtpProgram(program.id, "user-1")
    return program
  }

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
    const { markPdtpExecution } = await import("@/lib/services/prevention-pdtp")
    await loadActiveCatalog()

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

  it("markPdtpExecution rejects execution against a draft program", async () => {
    const { markPdtpExecution } = await import("@/lib/services/prevention-pdtp")
    // Program is created in `draft` by loadCatalog — no activation here.
    const { program } = await loadCatalog()
    const [activity] = await inMemoryDb.select()
      .from(schema.pdtpActivities)
      .where(eq(schema.pdtpActivities.programId, program.id))
      .limit(1)

    await expect(markPdtpExecution({
      activityId: activity!.id,
      worksiteId: "ws-1",
      year: 2026,
      month: 1,
      week: 1,
      executedQuantity: 1,
    }, "user-1", ["ws-1"])).rejects.toThrow(/estado activo/i)

    // No execution row should be persisted.
    const executions = await inMemoryDb.select().from(schema.pdtpExecutions)
    expect(executions).toHaveLength(0)
  })

  it("includes execution totals for the selected worksite in the sheet view", async () => {
    const { markPdtpExecution, getPdtpSheetView } = await import("@/lib/services/prevention-pdtp")
    await loadActiveCatalog()

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

  it("getPdtpComplianceIndicators returns 0 executions when none recorded", async () => {
    const { getPdtpComplianceIndicators } = await import("@/lib/services/prevention-pdtp")
    await loadCatalog()

    const result = await getPdtpComplianceIndicators(2026, "ws-1")

    expect(result).not.toBeNull()
    expect(result!.target).toBe(0.9)
    expect(result!.monthly).toHaveLength(12)
    // All months have planned activities (global program)
    expect(result!.monthly.some((m) => m.planned > 0)).toBe(true)
    // No executions yet
    expect(result!.monthly.every((m) => m.executed === 0)).toBe(true)
    expect(result!.annual.executed).toBe(0)
    // Month 1 (January) has programmed activities in the XLSX
    expect(result!.monthly[0]!.planned).toBe(36)
  })

  it("getPdtpComplianceIndicators counts only submitted/approved executions, not draft", async () => {
    const { getPdtpComplianceIndicators, markPdtpExecution, approvePdtpExecution } = await import("@/lib/services/prevention-pdtp")
    await loadActiveCatalog()

    const activities = await inMemoryDb.select().from(schema.pdtpActivities)
    const act1 = activities[0]!
    const act2 = activities[1]!

    // Mark act1 submitted (executedQuantity > 0) — counted
    const exec1 = await markPdtpExecution({
      activityId: act1.id,
      worksiteId: "ws-1",
      year: 2026,
      month: 1,
      week: 1,
      executedQuantity: 1,
    }, "user-1", ["ws-1"])
    // Mark act2 submitted then approved — still counted
    const exec2 = await markPdtpExecution({
      activityId: act2.id,
      worksiteId: "ws-1",
      year: 2026,
      month: 1,
      week: 1,
      executedQuantity: 1,
    }, "user-1", ["ws-1"])
    await approvePdtpExecution(exec2.id, "user-1", ["ws-1"])

    // Force a draft execution (directly insert)
    const act3 = activities[2]!
    const draftId = `${act3.id}-e-ws-1-2026-01-1`
    await inMemoryDb.insert(schema.pdtpExecutions).values({
      id: draftId,
      activityId: act3.id,
      worksiteId: "ws-1",
      year: 2026,
      month: 1,
      week: 1,
      executedQuantity: 1,
      status: "draft",
      evidencePhotos: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })

    const result = await getPdtpComplianceIndicators(2026, "ws-1")
    // Only act1 (submitted) and act2 (approved) counted; act3 (draft) not counted
    expect(result!.monthly[0]!.executed).toBe(2)
    expect(exec1.status).toBe("submitted")
  })

  it("program lifecycle: draft → jdpr approved → legal signed → active", async () => {
    const { approvePdtpProgramJdpr, signPdtpProgramLegal, activatePdtpProgram, getActivePdtpProgram } = await import("@/lib/services/prevention-pdtp")
    const { program } = await loadCatalog()
    const programId = program.id

    // Cannot activate without both approvals
    await expect(activatePdtpProgram(programId, "user-1")).rejects.toThrow(/jdpr/i)

    await approvePdtpProgramJdpr(programId, "user-1")
    // Cannot activate with only JDPR approval
    await expect(activatePdtpProgram(programId, "user-1")).rejects.toThrow(/legal/i)

    await signPdtpProgramLegal(programId, "user-1")
    await activatePdtpProgram(programId, "user-1")

    const active = await getActivePdtpProgram(2026)
    expect(active?.id).toBe(programId)
    expect(active?.status).toBe("active")
    expect(active?.approvedByJdprUserId).toBe("user-1")
    expect(active?.approvedByLegalUserId).toBe("user-1")
  })

  it("activating a new version deactivates the old one", async () => {
    const { approvePdtpProgramJdpr, signPdtpProgramLegal, activatePdtpProgram, getActivePdtpProgram } = await import("@/lib/services/prevention-pdtp")
    const { loadPdtpCatalog } = await import("@/lib/services/prevention-pdtp")
    const workbook = readPdtpWorkbook(path.resolve(process.cwd(), "PROGRAMA DE TRABAJO PREVENTIVO SG-SST 2026.xlsx"))
    const catalog = extractPdtpCatalogFromWorkbook(workbook)

    // v1 → active
    const { program: v1 } = await loadPdtpCatalog({ year: 2026, version: 1, title: "v1", catalog, userId: "user-1" })
    await approvePdtpProgramJdpr(v1.id, "user-1")
    await signPdtpProgramLegal(v1.id, "user-1")
    await activatePdtpProgram(v1.id, "user-1")

    // v2 → also activated → v1 should be draft
    const { program: v2 } = await loadPdtpCatalog({ year: 2026, version: 2, title: "v2", catalog, userId: "user-1" })
    await approvePdtpProgramJdpr(v2.id, "user-1")
    await signPdtpProgramLegal(v2.id, "user-1")
    await activatePdtpProgram(v2.id, "user-1")

    const active = await getActivePdtpProgram(2026)
    expect(active?.id).toBe(v2.id)

    const [v1Row] = await inMemoryDb.select().from(schema.pdtpPrograms).where(eq(schema.pdtpPrograms.id, v1.id))
    expect(v1Row?.status).toBe("draft")
  })

  it("lifecycle transitions write change log entries", async () => {
    const { approvePdtpProgramJdpr, signPdtpProgramLegal, activatePdtpProgram } = await import("@/lib/services/prevention-pdtp")
    const { program } = await loadCatalog()

    await approvePdtpProgramJdpr(program.id, "user-1")
    await signPdtpProgramLegal(program.id, "user-1")
    await activatePdtpProgram(program.id, "user-1")

    const log = await inMemoryDb.select().from(schema.pdtpChangeLog).where(eq(schema.pdtpChangeLog.programId, program.id))
    expect(log.length).toBeGreaterThanOrEqual(3)
    expect(log.some((entry) => entry.section === "lifecycle" && String(entry.note).includes("JDPR"))).toBe(true)
    expect(log.some((entry) => entry.section === "lifecycle" && String(entry.note).includes("Legal"))).toBe(true)
    expect(log.some((entry) => entry.section === "lifecycle" && String(entry.note).includes("activado"))).toBe(true)
  })

  it("approvePdtpExecution: submitted→approved, rejects wrong scope", async () => {
    const { markPdtpExecution, approvePdtpExecution } = await import("@/lib/services/prevention-pdtp")
    await loadActiveCatalog()

    const [activity] = await inMemoryDb.select().from(schema.pdtpActivities).where(eq(schema.pdtpActivities.n, 1))
    const exec = await markPdtpExecution({
      activityId: activity!.id,
      worksiteId: "ws-1",
      year: 2026,
      month: 2,
      week: 1,
      executedQuantity: 1,
    }, "user-1", ["ws-1"])

    expect(exec.status).toBe("submitted")

    // Wrong scope → rejected
    await expect(approvePdtpExecution(exec.id, "user-1", ["ws-other"])).rejects.toThrow(/sin acceso/i)

    // Correct scope → approved
    const approved = await approvePdtpExecution(exec.id, "user-1", ["ws-1"])
    expect(approved.status).toBe("approved")
    expect(approved.approvedByUserId).toBe("user-1")

    // Already approved → throws
    await expect(approvePdtpExecution(exec.id, "user-1", ["ws-1"])).rejects.toThrow(/ya fue aprobada/i)
  })

  it("updatePdtpActivity: edits fields and writes change log", async () => {
    const { updatePdtpActivity } = await import("@/lib/services/prevention-pdtp")
    const { program } = await loadCatalog()

    const [activity] = await inMemoryDb.select().from(schema.pdtpActivities).where(eq(schema.pdtpActivities.n, 1))

    const updated = await updatePdtpActivity({
      activityId: activity!.id,
      activity: "Actividad editada",
      notes: "Nota de prueba",
    }, "user-1")

    expect(updated.activity).toBe("Actividad editada")
    expect(updated.notes).toBe("Nota de prueba")

    const log = await inMemoryDb.select().from(schema.pdtpChangeLog).where(eq(schema.pdtpChangeLog.programId, program.id))
    expect(log.length).toBeGreaterThanOrEqual(1)
    expect(log.some((entry) => entry.section === `activity:1`)).toBe(true)
  })

  it("updatePdtpActivity: throws if program is not draft", async () => {
    const { updatePdtpActivity, approvePdtpProgramJdpr, signPdtpProgramLegal, activatePdtpProgram } = await import("@/lib/services/prevention-pdtp")
    const { program } = await loadCatalog()

    await approvePdtpProgramJdpr(program.id, "user-1")
    await signPdtpProgramLegal(program.id, "user-1")
    await activatePdtpProgram(program.id, "user-1")

    const [activity] = await inMemoryDb.select().from(schema.pdtpActivities).where(eq(schema.pdtpActivities.n, 1))
    await expect(updatePdtpActivity({ activityId: activity!.id, activity: "X" }, "user-1"))
      .rejects.toThrow(/draft/i)
  })

  it("addPdtpActivity: creates activity with n = maxN + 1 and writes change log", async () => {
    const { addPdtpActivity } = await import("@/lib/services/prevention-pdtp")
    const { program } = await loadCatalog()

    const created = await addPdtpActivity({
      programId: program.id,
      objectiveOrder: 1,
      objective: "FORTALECER EL LIDERAZGO DE SEGURIDAD Y SALUD EN EL TRABAJO",
      activity: "Nueva actividad de prueba",
      program: "Reunión online",
      responsibleSlugs: ["prf"],
      responsibleDisplay: "PRF",
      sheetCodes: ["pdtp_general"],
    }, "user-1")

    expect(created.n).toBe(90)  // 89 existing + 1
    expect(created.activity).toBe("Nueva actividad de prueba")

    const log = await inMemoryDb.select().from(schema.pdtpChangeLog).where(eq(schema.pdtpChangeLog.programId, program.id))
    expect(log.some((entry) => entry.section === "activity:90")).toBe(true)

    // Verify sheet membership was created
    const memberships = await inMemoryDb.select().from(schema.pdtpSheetActivities).where(eq(schema.pdtpSheetActivities.activityId, created.id))
    expect(memberships.length).toBeGreaterThanOrEqual(1)
  })
})
