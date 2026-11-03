import ExcelJS from "exceljs"
import type { Session } from "next-auth"
import { afterEach, describe, expect, it, vi } from "vitest"

const worksiteRows = vi.hoisted(() => ({ value: [] as Array<{ id: string; name: string }>, fail: false }))

vi.mock("@/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: async () => {
          if (worksiteRows.fail) throw new Error("sin base")
          return worksiteRows.value
        },
      }),
    }),
  },
}))

import { addExportMetadataSheet } from "@/lib/reports/export-metadata"

const session = { user: { id: "u1", email: "auditor@chome.cl", name: "Auditor", isGlobal: true, worksiteIds: [] } } as unknown as Session
const scoped = { user: { id: "u2", email: "faena@chome.cl", name: "Faena", isGlobal: false, worksiteIds: ["ws-b", "ws-a"] } } as unknown as Session

function scopeCell(workbook: ExcelJS.Workbook) {
  return workbook.getWorksheet("Metadatos")!.getCell("B3").value
}

describe("addExportMetadataSheet", () => {
  afterEach(() => {
    vi.useRealTimers()
    worksiteRows.value = []
    worksiteRows.fail = false
  })

  it("«Generado» sale en hora de Chile, no en la del servidor", async () => {
    // 02:30Z del 19-10 son las 23:30 del 18-10 en Chile (UTC-3).
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-10-19T02:30:00.000Z"))
    const workbook = new ExcelJS.Workbook()
    await addExportMetadataSheet(workbook, session, { rowCount: 3 })
    const sheet = workbook.getWorksheet("Metadatos")!
    expect(sheet.getCell("A1").value).toBe("Generado")
    expect(sheet.getCell("B1").value).toBe("18-10-2026 23:30 (hora de Chile)")
  })

  it("el alcance acotado muestra los nombres de las faenas, no sus identificadores", async () => {
    worksiteRows.value = [{ id: "ws-a", name: "Mininco" }, { id: "ws-b", name: "Arauco" }]
    const workbook = new ExcelJS.Workbook()
    await addExportMetadataSheet(workbook, scoped, { rowCount: 1 })
    expect(scopeCell(workbook)).toBe("Arauco, Mininco")
  })

  it("las notas de la exportación (una advertencia sobre las cifras) van al final, una por fila", async () => {
    const workbook = new ExcelJS.Workbook()
    await addExportMetadataSheet(workbook, session, {
      rowCount: 2,
      notes: ["Sin datos del proveedor en sep-2026: los totales de 12 meses no incluyen ese mes.", "Otra salvedad."],
    })
    const rows = workbook.getWorksheet("Metadatos")!.getSheetValues().slice(1) as Array<[undefined, string, string]>

    expect(rows.slice(-2).map(([, label, value]) => [label, value])).toEqual([
      ["Nota", "Sin datos del proveedor en sep-2026: los totales de 12 meses no incluyen ese mes."],
      ["Nota", "Otra salvedad."],
    ])
    // Lo que ya existía no se mueve de sitio: «Alcance de faena» sigue en la fila 3.
    expect(scopeCell(workbook)).toBe("Todas las faenas (usuario global)")
  })

  it("sin notas la hoja queda exactamente igual que antes", async () => {
    const workbook = new ExcelJS.Workbook()
    await addExportMetadataSheet(workbook, session, { rowCount: 2, notes: [] })

    expect(workbook.getWorksheet("Metadatos")!.rowCount).toBe(7)
  })

  it("si no puede leer los nombres, cae a los identificadores sin romper la exportación", async () => {
    worksiteRows.fail = true
    const workbook = new ExcelJS.Workbook()
    await addExportMetadataSheet(workbook, scoped, { rowCount: 1 })
    expect(scopeCell(workbook)).toBe("ws-b, ws-a")
  })
})
