import path from "node:path"
import { describe, expect, it } from "vitest"
import catalog from "@/db/seed/pdtp-catalog-2026.json"
import {
  PDTP_2026_EXECUTED_CELLS,
  PDTP_2026_INVARIANTS,
  PDTP_2026_LONG_TEXT_ACTIVITY_IDS,
  PDTP_2026_NO_NUMERIC_PLAN_ACTIVITY_IDS,
  PDTP_2026_SOURCE,
  PDTP_2026_VIEW_MEMBERSHIPS,
} from "@/lib/services/pdtp-adapters/contract-2026"
import { extractPdtpCatalogFromWorkbook, readPdtpWorkbook } from "@/lib/services/prevention-pdtp-catalog"

describe("contrato del adaptador PDTP 2026", () => {
  it("fija identidad, plan, actividades sin P, textos límite y membresías exactas", () => {
    const cells = catalog.activities.flatMap((activity) => activity.schedule)
    expect(PDTP_2026_SOURCE).toEqual(expect.objectContaining({
      filename: "PROGRAMA DE TRABAJO PREVENTIVO SG-SST 2026.xlsx",
      sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      sizeBytes: 4_513_110,
    }))
    expect(catalog.objectives).toHaveLength(PDTP_2026_INVARIANTS.objectiveCount)
    expect(catalog.activities).toHaveLength(PDTP_2026_INVARIANTS.activityCount)
    expect(Object.keys(catalog.sheetActivities)).toHaveLength(PDTP_2026_INVARIANTS.viewCount)
    expect(cells).toHaveLength(PDTP_2026_INVARIANTS.plannedCellCount)
    expect(cells.reduce((sum, cell) => sum + cell.plannedQuantity, 0)).toBe(PDTP_2026_INVARIANTS.plannedQuantityTotal)
    expect(Math.max(...cells.map((cell) => cell.plannedQuantity))).toBe(PDTP_2026_INVARIANTS.maxPlannedCellQuantity)
    expect(catalog.activities.filter((activity) => activity.schedule.length === 0).map((activity) => activity.n)).toEqual(PDTP_2026_NO_NUMERIC_PLAN_ACTIVITY_IDS)
    expect(catalog.sheetActivities).toEqual(PDTP_2026_VIEW_MEMBERSHIPS)
    for (const id of PDTP_2026_LONG_TEXT_ACTIVITY_IDS) {
      const activity = catalog.activities.find((item) => item.n === id)
      expect(Math.max(activity?.activity.length ?? 0, activity?.program.length ?? 0)).toBeGreaterThan(200)
    }
  })

  it("fija las seis celdas E conocidas del libro fuente", async () => {
    const workbook = await readPdtpWorkbook(path.resolve(process.cwd(), PDTP_2026_SOURCE.filename))
    const sheet = workbook.getWorksheet("PDTP GENERAL")
    const extracted = extractPdtpCatalogFromWorkbook(workbook)
    expect(sheet).toBeDefined()
    expect(PDTP_2026_EXECUTED_CELLS).toHaveLength(PDTP_2026_INVARIANTS.executedQuantityTotal)
    for (const execution of PDTP_2026_EXECUTED_CELLS) {
      expect(Number(sheet!.getCell(execution.sourceCell).value)).toBe(execution.quantity)
    }
    expect(extracted.importedExecutions).toHaveLength(PDTP_2026_INVARIANTS.executedQuantityTotal)
    expect(extracted.importedExecutions?.map((execution) => execution.sourceCell)).toEqual(
      PDTP_2026_EXECUTED_CELLS.map((execution) => execution.sourceCell),
    )
  })

  it("mantiene una fixture generable compatible con el parser del adaptador", async () => {
    const fixturePath = path.resolve(process.cwd(), ".tmp/pdtp-2026-sanitized.xlsx")
    const { execFileSync } = await import("node:child_process")
    execFileSync(process.execPath, ["--import", "tsx", "scripts/generate-pdtp-2026-sanitized-fixture.ts", fixturePath], { cwd: process.cwd() })
    const fixture = extractPdtpCatalogFromWorkbook(await readPdtpWorkbook(fixturePath))
    expect(fixture.activities).toHaveLength(PDTP_2026_INVARIANTS.activityCount)
    expect(fixture.sheetActivities).toEqual(PDTP_2026_VIEW_MEMBERSHIPS)
    expect(fixture.activities.flatMap((activity) => activity.schedule)).toHaveLength(PDTP_2026_INVARIANTS.plannedCellCount)
  })
})
