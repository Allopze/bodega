import ExcelJS from "exceljs"
import type { Session } from "next-auth"
import { afterEach, describe, expect, it, vi } from "vitest"
import { addExportMetadataSheet } from "@/lib/reports/export-metadata"

const session = { user: { id: "u1", email: "auditor@chome.cl", name: "Auditor", isGlobal: true, worksiteIds: [] } } as unknown as Session

describe("addExportMetadataSheet", () => {
  afterEach(() => vi.useRealTimers())

  it("«Generado» sale en hora de Chile, no en la del servidor", () => {
    // 02:30Z del 19-10 son las 23:30 del 18-10 en Chile (UTC-3).
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-10-19T02:30:00.000Z"))
    const workbook = new ExcelJS.Workbook()
    addExportMetadataSheet(workbook, session, { rowCount: 3 })
    const sheet = workbook.getWorksheet("Metadatos")!
    expect(sheet.getCell("A1").value).toBe("Generado")
    expect(sheet.getCell("B1").value).toBe("18-10-2026 23:30 (hora de Chile)")
  })
})
