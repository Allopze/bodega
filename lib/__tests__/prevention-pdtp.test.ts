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

// H-B7: en tests, los archivos físicos no existen. Para los tests que
// usan evidenceUrl, pre-creamos los archivos en el FS real.
import { mkdirSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
const tmpEvidenceDir = join(tmpdir(), "pdtp-evidence-test")
mkdirSync(tmpEvidenceDir, { recursive: true })

vi.mock("@/lib/storage/config", () => ({
  resolvePdtpEvidenceFile: (filePath: string) => {
    if (typeof filePath === "string" && filePath.startsWith("storage/pdtp-evidence/")) {
      return join(tmpEvidenceDir, filePath.slice("storage/pdtp-evidence/".length))
    }
    return null
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
    const workbook = await readPdtpWorkbook(path.resolve(process.cwd(), "PROGRAMA DE TRABAJO PREVENTIVO SG-SST 2026.xlsx"))
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
    const workbook = await readPdtpWorkbook(path.resolve(process.cwd(), "PROGRAMA DE TRABAJO PREVENTIVO SG-SST 2026.xlsx"))
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
    const workbook = await readPdtpWorkbook(path.resolve(process.cwd(), "PROGRAMA DE TRABAJO PREVENTIVO SG-SST 2026.xlsx"))
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
    const workbook = await readPdtpWorkbook(path.resolve(process.cwd(), "PROGRAMA DE TRABAJO PREVENTIVO SG-SST 2026.xlsx"))
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
    expect(result!.monthly[0]!.planned).toBe(76)
  })

  it("getPdtpComplianceIndicators suma solo cantidades aprobadas", async () => {
    const { getPdtpComplianceIndicators, markPdtpExecution, approvePdtpExecution } = await import("@/lib/services/prevention-pdtp")
    await loadActiveCatalog()

    const activities = await inMemoryDb.select().from(schema.pdtpActivities)
    const act1 = activities[0]!
    const act2 = activities[1]!

    // La misma actividad ejecutada tres veces aporta tres al cumplimiento.
    const exec1 = await markPdtpExecution({
      activityId: act1.id,
      worksiteId: "ws-1",
      year: 2026,
      month: 1,
      week: 1,
      executedQuantity: 3,
    }, "user-1", ["ws-1"])
    // Una segunda actividad aporta su propia cantidad al total mensual.
    const exec2 = await markPdtpExecution({
      activityId: act2.id,
      worksiteId: "ws-1",
      year: 2026,
      month: 1,
      week: 1,
      executedQuantity: 2,
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
    // Solo act2 (approved) cuenta; submitted y draft se mantienen como avance
    // operativo, pero no forman parte del cumplimiento formal.
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
    const workbook = await readPdtpWorkbook(path.resolve(process.cwd(), "PROGRAMA DE TRABAJO PREVENTIVO SG-SST 2026.xlsx"))
    const catalog = extractPdtpCatalogFromWorkbook(workbook)

    // v1 → active
    const { program: v1 } = await loadPdtpCatalog({ year: 2026, version: 1, title: "v1", catalog, userId: "user-1" })
    await approvePdtpProgramJdpr(v1.id, "user-1")
    await signPdtpProgramLegal(v1.id, "user-1")
    await activatePdtpProgram(v1.id, "user-1")

    // v2 → also activated → v1 should be closed (it was executed, not
    // reopened as draft — see activatePdtpProgram in lib/services/pdtp/lifecycle.ts)
    const { program: v2 } = await loadPdtpCatalog({ year: 2026, version: 2, title: "v2", catalog, userId: "user-1" })
    await approvePdtpProgramJdpr(v2.id, "user-1")
    await signPdtpProgramLegal(v2.id, "user-1")
    await activatePdtpProgram(v2.id, "user-1")

    const active = await getActivePdtpProgram(2026)
    expect(active?.id).toBe(v2.id)

    const [v1Row] = await inMemoryDb.select().from(schema.pdtpPrograms).where(eq(schema.pdtpPrograms.id, v1.id))
    expect(v1Row?.status).toBe("closed")
  })

  it("does not reactivate a closed program", async () => {
    const { approvePdtpProgramJdpr, signPdtpProgramLegal, activatePdtpProgram } = await import("@/lib/services/prevention-pdtp")
    const { program } = await loadCatalog()
    await approvePdtpProgramJdpr(program.id, "user-1")
    await signPdtpProgramLegal(program.id, "user-1")
    await activatePdtpProgram(program.id, "user-1")
    await inMemoryDb.update(schema.pdtpPrograms).set({ status: "closed" }).where(eq(schema.pdtpPrograms.id, program.id))

    await expect(activatePdtpProgram(program.id, "user-1")).rejects.toThrow(/estado borrador/i)
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

  it("solo permite una transición terminal cuando aprobar y rechazar compiten", async () => {
    const { markPdtpExecution, approvePdtpExecution, rejectPdtpExecution } = await import("@/lib/services/prevention-pdtp")
    await loadActiveCatalog()

    const [activity] = await inMemoryDb.select().from(schema.pdtpActivities).where(eq(schema.pdtpActivities.n, 1))
    const execution = await markPdtpExecution({
      activityId: activity!.id,
      worksiteId: "ws-1",
      year: 2026,
      month: 2,
      week: 2,
      executedQuantity: 1,
    }, "user-1", ["ws-1"])

    const results = await Promise.allSettled([
      approvePdtpExecution(execution.id, "user-1", ["ws-1"]),
      rejectPdtpExecution(execution.id, "user-1", "Revisión concurrente", ["ws-1"]),
    ])

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1)
    const [stored] = await inMemoryDb.select().from(schema.pdtpExecutions).where(eq(schema.pdtpExecutions.id, execution.id))
    expect(["approved", "rejected"]).toContain(stored!.status)
  })

  it("listPendingPdtpExecutions: only submitted rows, scope filtering, joined names", async () => {
    const { markPdtpExecution, approvePdtpExecution, listPendingPdtpExecutions } =
      await import("@/lib/services/prevention-pdtp")
    await loadActiveCatalog()
    await inMemoryDb.insert(schema.worksites).values({ id: "ws-2", name: "Faena B", code: "FB", isActive: true })

    const [act1] = await inMemoryDb.select().from(schema.pdtpActivities).where(eq(schema.pdtpActivities.n, 1))
    const [act2] = await inMemoryDb.select().from(schema.pdtpActivities).where(eq(schema.pdtpActivities.n, 2))
    const [act3] = await inMemoryDb.select().from(schema.pdtpActivities).where(eq(schema.pdtpActivities.n, 3))

    // Pending, worksite A
    await markPdtpExecution({
      activityId: act1!.id, worksiteId: "ws-1", year: 2026, month: 1, week: 1, executedQuantity: 1,
    }, "user-1", ["ws-1"])
    // Pending, worksite B
    await markPdtpExecution({
      activityId: act2!.id, worksiteId: "ws-2", year: 2026, month: 1, week: 2, executedQuantity: 1,
    }, "user-1", ["ws-2"])
    // Approved (not pending) — must be excluded
    const exec3 = await markPdtpExecution({
      activityId: act3!.id, worksiteId: "ws-1", year: 2026, month: 1, week: 1, executedQuantity: 1,
    }, "user-1", ["ws-1"])
    await approvePdtpExecution(exec3.id, "user-1", ["ws-1"])

    const all = await listPendingPdtpExecutions("all", { year: 2026 })
    expect(all).toHaveLength(2)
    expect(all.map((e) => e.worksiteId).sort()).toEqual(["ws-1", "ws-2"])
    const row1 = all.find((e) => e.worksiteId === "ws-1")
    expect(row1?.worksiteName).toBe("Faena A")
    expect(row1?.activityId).toBe(act1!.id)
    expect(row1?.activityName).toBe(act1!.activity)
    expect(row1?.activityN).toBe(1)

    const scopedToA = await listPendingPdtpExecutions(["ws-1"], { year: 2026 })
    expect(scopedToA).toHaveLength(1)
    expect(scopedToA[0]?.worksiteId).toBe("ws-1")

    const scopedToNone = await listPendingPdtpExecutions([], { year: 2026 })
    expect(scopedToNone).toHaveLength(0)
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

  it("addPdtpActivity: displayOrder es MAX+1 por hoja, no número de actividad", async () => {
    const { addPdtpActivity } = await import("@/lib/services/prevention-pdtp")
    const { program } = await loadCatalog()

    // La hoja cphs tiene 4 actividades oficiales (11, 12, 13, 14). El
    // MAX(displayOrder) actual es 4. Una actividad manual agregada
    // debe quedar con displayOrder = 5, no con displayOrder = 90.
    const a1 = await addPdtpActivity({
      programId: program.id,
      objectiveOrder: 6,
      objective: "CONTROLAR LA APLICACIÓN DEL PROCEDIMIENTO DE ACCIDENTES E INCIDENTES",
      activity: "A1",
      program: "X",
      responsibleSlugs: ["cphs"],
      responsibleDisplay: "CPHS",
      sheetCodes: ["cphs"],
    }, "user-1")
    const memberships1 = await inMemoryDb.select().from(schema.pdtpSheetActivities)
      .where(eq(schema.pdtpSheetActivities.activityId, a1.id))
    expect(memberships1[0]!.displayOrder).toBe(5)
    expect(memberships1[0]!.sheetRow).toBe(5)

    const a2 = await addPdtpActivity({
      programId: program.id,
      objectiveOrder: 6,
      objective: "CONTROLAR LA APLICACIÓN DEL PROCEDIMIENTO DE ACCIDENTES E INCIDENTES",
      activity: "A2",
      program: "X",
      responsibleSlugs: ["cphs"],
      responsibleDisplay: "CPHS",
      sheetCodes: ["cphs"],
    }, "user-1")
    const memberships2 = await inMemoryDb.select().from(schema.pdtpSheetActivities)
      .where(eq(schema.pdtpSheetActivities.activityId, a2.id))
    expect(memberships2[0]!.displayOrder).toBe(6)
  })

  it("rejectPdtpExecution: submitted→rejected, motivo persistido, re-envío la vuelve a submitted", async () => {
    const { markPdtpExecution, rejectPdtpExecution, approvePdtpExecution } = await import("@/lib/services/prevention-pdtp")
    await loadActiveCatalog()

    const [activity] = await inMemoryDb.select().from(schema.pdtpActivities).where(eq(schema.pdtpActivities.n, 1))
    const exec = await markPdtpExecution({
      activityId: activity!.id,
      worksiteId: "ws-1",
      year: 2026,
      month: 3,
      week: 1,
      executedQuantity: 1,
      evidenceText: "Cantidad mal ingresada",
    }, "user-1", ["ws-1"])

    expect(exec.status).toBe("submitted")

    // No se puede rechazar fuera de scope (antes de rechazar)
    await expect(rejectPdtpExecution(exec.id, "user-1", "X", ["ws-other"])).rejects.toThrow(/sin acceso/i)

    // Rechazar con motivo
    const rejected = await rejectPdtpExecution(exec.id, "user-1", "Cantidad debe ser 3, no 1", ["ws-1"])
    expect(rejected.status).toBe("rejected")
    expect(rejected.rejectionReason).toBe("Cantidad debe ser 3, no 1")
    expect(rejected.rejectedByUserId).toBe("user-1")
    expect(rejected.rejectedAt).toBeTruthy()

    // No se puede rechazar dos veces
    await expect(rejectPdtpExecution(exec.id, "user-1", "Otro motivo", ["ws-1"])).rejects.toThrow(/ya fue rechazada/i)

    // Re-envío por el prevencionista con cantidad corregida → vuelve a submitted y limpia el rechazo
    const resubmitted = await markPdtpExecution({
      activityId: activity!.id,
      worksiteId: "ws-1",
      year: 2026,
      month: 3,
      week: 1,
      executedQuantity: 3,
      evidenceText: "Corregido",
    }, "user-1", ["ws-1"])
    expect(resubmitted.status).toBe("submitted")
    expect(resubmitted.rejectionReason).toBeNull()
    expect(resubmitted.rejectedAt).toBeNull()
    expect(resubmitted.executedQuantity).toBe(3)

    // Ahora se puede aprobar normalmente
    const approved = await approvePdtpExecution(resubmitted.id, "user-1", ["ws-1"])
    expect(approved.status).toBe("approved")
    expect(approved.approvedByUserId).toBe("user-1")
  })

  it("markPdtpExecution: rechaza modificar una ejecución ya aprobada", async () => {
    const { markPdtpExecution, approvePdtpExecution } = await import("@/lib/services/prevention-pdtp")
    await loadActiveCatalog()

    const [activity] = await inMemoryDb.select().from(schema.pdtpActivities).where(eq(schema.pdtpActivities.n, 2))
    const exec = await markPdtpExecution({
      activityId: activity!.id,
      worksiteId: "ws-1",
      year: 2026,
      month: 4,
      week: 1,
      executedQuantity: 1,
    }, "user-1", ["ws-1"])
    await approvePdtpExecution(exec.id, "user-1", ["ws-1"])

    // Re-envío debe fallar
    await expect(markPdtpExecution({
      activityId: activity!.id,
      worksiteId: "ws-1",
      year: 2026,
      month: 4,
      week: 1,
      executedQuantity: 5,
    }, "user-1", ["ws-1"])).rejects.toThrow(/ya fue aprobada/i)
  })

  it("rejectPdtpExecution: rechaza si el motivo está vacío", async () => {
    const { markPdtpExecution, rejectPdtpExecution } = await import("@/lib/services/prevention-pdtp")
    await loadActiveCatalog()

    const [activity] = await inMemoryDb.select().from(schema.pdtpActivities).where(eq(schema.pdtpActivities.n, 3))
    const exec = await markPdtpExecution({
      activityId: activity!.id,
      worksiteId: "ws-1",
      year: 2026,
      month: 5,
      week: 1,
      executedQuantity: 1,
    }, "user-1", ["ws-1"])

    await expect(rejectPdtpExecution(exec.id, "user-1", "", ["ws-1"])).rejects.toThrow(/motivo del rechazo/i)
    await expect(rejectPdtpExecution(exec.id, "user-1", "   ", ["ws-1"])).rejects.toThrow(/motivo del rechazo/i)
  })

  it("getPdtpSheetView prefiere el programa activo sobre el más reciente por versión", async () => {
    const { loadPdtpCatalog, getPdtpSheetView, approvePdtpProgramJdpr, signPdtpProgramLegal, activatePdtpProgram } = await import("@/lib/services/prevention-pdtp")
    const workbook = await readPdtpWorkbook(path.resolve(process.cwd(), "PROGRAMA DE TRABAJO PREVENTIVO SG-SST 2026.xlsx"))
    const catalog = extractPdtpCatalogFromWorkbook(workbook)

    // v1 → activar
    const { program: v1 } = await loadPdtpCatalog({ year: 2026, version: 1, title: "v1", catalog, userId: "user-1" })
    await approvePdtpProgramJdpr(v1.id, "user-1")
    await signPdtpProgramLegal(v1.id, "user-1")
    await activatePdtpProgram(v1.id, "user-1")

    // v2 creado como draft (sin activar)
    await loadPdtpCatalog({ year: 2026, version: 2, title: "v2", catalog, userId: "user-1" })

    const view = await getPdtpSheetView(2026, "pdtp_general")
    expect(view?.program.id).toBe(v1.id)
    expect(view?.program.status).toBe("active")
  })

  it("setPdtpActivityOverride: respeta el scope de faenas del usuario", async () => {
    const { setPdtpActivityOverride, deletePdtpActivityOverride } = await import("@/lib/services/prevention-pdtp")
    await loadActiveCatalog()

    await inMemoryDb.insert(schema.worksites).values({ id: "ws-2", name: "Faena B", code: "FB", isActive: true })

    const [activity] = await inMemoryDb.select().from(schema.pdtpActivities).where(eq(schema.pdtpActivities.n, 5))

    // Scope ["ws-1"] no puede fijar override para ws-2
    await expect(setPdtpActivityOverride({
      activityId: activity!.id, worksiteId: "ws-2", year: 2026, month: 1, week: 1, plannedQuantity: 4,
    }, "user-1", ["ws-1"])).rejects.toThrow(/sin acceso/i)

    // Scope "all" sí puede
    const created = await setPdtpActivityOverride({
      activityId: activity!.id, worksiteId: "ws-2", year: 2026, month: 1, week: 1, plannedQuantity: 4,
    }, "user-1", "all")
    expect(created.plannedQuantity).toBe(4)

    // delete con scope [] no puede borrar
    await expect(deletePdtpActivityOverride({
      activityId: activity!.id, worksiteId: "ws-2", year: 2026, month: 1, week: 1,
    }, "user-1", [])).rejects.toThrow(/sin acceso/i)

    // delete con scope que contiene ws-2 sí
    await deletePdtpActivityOverride({
      activityId: activity!.id, worksiteId: "ws-2", year: 2026, month: 1, week: 1,
    }, "user-1", ["ws-2"])
    const remaining = await inMemoryDb.select().from(schema.pdtpActivityScheduleOverrides)
      .where(eq(schema.pdtpActivityScheduleOverrides.worksiteId, "ws-2"))
    expect(remaining).toHaveLength(0)
  })

  it("addPdtpActivity: acepta múltiples responsibleSlugs y sheetCodes (H-M2)", async () => {
    const { addPdtpActivity } = await import("@/lib/services/prevention-pdtp")
    const { program } = await loadCatalog()

    const created = await addPdtpActivity({
      programId: program.id,
      objectiveOrder: 6,
      objective: "CONTROLAR LA APLICACIÓN DEL PROCEDIMIENTO DE ACCIDENTES E INCIDENTES",
      activity: "Actividad con múltiples responsables y hojas",
      program: "X",
      responsibleSlugs: ["prf", "jt", "jdpr"],
      responsibleDisplay: "PRF, JT, JDPR",
      sheetCodes: ["pdtp_general", "cphs", "capacitacion"],
    }, "user-1")

    expect(created.responsibleSlugs).toEqual(["prf", "jt", "jdpr"])

    const memberships = await inMemoryDb.select().from(schema.pdtpSheetActivities)
      .where(eq(schema.pdtpSheetActivities.activityId, created.id))
    expect(memberships).toHaveLength(3)
    const sheetCodes = memberships.map((m) => m.sheetCode).sort()
    expect(sheetCodes).toEqual(["capacitacion", "cphs", "pdtp_general"])
  })

  it("markPdtpExecution: preserva evidencePhotos históricas en re-envíos (H-M3 append-only)", async () => {
    const { markPdtpExecution } = await import("@/lib/services/prevention-pdtp")
    await loadActiveCatalog()

    const [activity] = await inMemoryDb.select().from(schema.pdtpActivities).where(eq(schema.pdtpActivities.n, 38))

    // H-B7: pre-creamos archivos físicos para que la validación de
    // existencia (H-B7) los acepte
    for (const name of ["foto-001.pdf", "foto-002.pdf", "foto-003.pdf"]) {
      writeFileSync(join(tmpEvidenceDir, name), "%PDF-1.4 test")
    }

    // 1ra ejecución con foto 1
    const first = await markPdtpExecution({
      activityId: activity!.id, worksiteId: "ws-1", year: 2026, month: 6, week: 1,
      executedQuantity: 1, evidenceText: "Foto 1",
      evidenceUrl: "storage/pdtp-evidence/foto-001.pdf",
      evidencePhotos: ["storage/pdtp-evidence/foto-001.pdf"],
    }, "user-1", ["ws-1"])
    expect(first.evidencePhotos).toEqual(["storage/pdtp-evidence/foto-001.pdf"])

    // 2da ejecución (mismo período) con foto 2 → debe preservar foto 1
    const second = await markPdtpExecution({
      activityId: activity!.id, worksiteId: "ws-1", year: 2026, month: 6, week: 1,
      executedQuantity: 1, evidenceText: "Foto 2",
      evidenceUrl: "storage/pdtp-evidence/foto-002.pdf",
      evidencePhotos: ["storage/pdtp-evidence/foto-002.pdf"],
    }, "user-1", ["ws-1"])
    expect(second.evidencePhotos).toEqual([
      "storage/pdtp-evidence/foto-001.pdf",
      "storage/pdtp-evidence/foto-002.pdf",
    ])
    expect(second.evidenceUrl).toBe("storage/pdtp-evidence/foto-002.pdf")

    // 3ra ejecución con la misma foto 1 + foto 3 → no duplica foto 1
    const third = await markPdtpExecution({
      activityId: activity!.id, worksiteId: "ws-1", year: 2026, month: 6, week: 1,
      executedQuantity: 1, evidenceText: "Foto 3",
      evidenceUrl: "storage/pdtp-evidence/foto-003.pdf",
      evidencePhotos: [
        "storage/pdtp-evidence/foto-001.pdf",
        "storage/pdtp-evidence/foto-003.pdf",
      ],
    }, "user-1", ["ws-1"])
    expect(third.evidencePhotos).toEqual([
      "storage/pdtp-evidence/foto-001.pdf",
      "storage/pdtp-evidence/foto-002.pdf",
      "storage/pdtp-evidence/foto-003.pdf",
    ])
    // evidenceUrl: el último enviado (foto-003)
    expect(third.evidenceUrl).toBe("storage/pdtp-evidence/foto-003.pdf")
  })

  it("markPdtpExecution: si no se envía evidenceUrl, preserva el previo (H-M3)", async () => {
    const { markPdtpExecution } = await import("@/lib/services/prevention-pdtp")
    await loadActiveCatalog()

    const [activity] = await inMemoryDb.select().from(schema.pdtpActivities).where(eq(schema.pdtpActivities.n, 39))

    // H-B7: pre-creamos el archivo físico
    writeFileSync(join(tmpEvidenceDir, "preservada.pdf"), "%PDF-1.4 test")

    // 1ra con evidencia
    await markPdtpExecution({
      activityId: activity!.id, worksiteId: "ws-1", year: 2026, month: 6, week: 2,
      executedQuantity: 1,
      evidenceUrl: "storage/pdtp-evidence/preservada.pdf",
    }, "user-1", ["ws-1"])

    // 2da sin evidenciaUrl → debe preservar el previo
    const second = await markPdtpExecution({
      activityId: activity!.id, worksiteId: "ws-1", year: 2026, month: 6, week: 2,
      executedQuantity: 1,
      evidenceText: "Solo texto",
    }, "user-1", ["ws-1"])
    expect(second.evidenceUrl).toBe("storage/pdtp-evidence/preservada.pdf")
  })

  it("H-B7: descarta evidenceUrl cuyo archivo físico no existe", async () => {
    const { markPdtpExecution } = await import("@/lib/services/prevention-pdtp")
    await loadActiveCatalog()

    const [activity] = await inMemoryDb.select().from(schema.pdtpActivities).where(eq(schema.pdtpActivities.n, 40))

    // No escribimos el archivo en disco → resolvePdtpEvidenceFile
    // retorna un path que existsSync rechaza.
    const row = await markPdtpExecution({
      activityId: activity!.id, worksiteId: "ws-1", year: 2026, month: 6, week: 3,
      executedQuantity: 1,
      evidenceUrl: "storage/pdtp-evidence/inexistente.pdf",
    }, "user-1", ["ws-1"])

    // Se guarda la ejecución pero sin evidenceUrl (se loggea warning)
    expect(row.evidenceUrl).toBeNull()
  })
})
