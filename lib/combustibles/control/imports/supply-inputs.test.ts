import { describe, expect, it, vi } from "vitest"
import { buildXlsx } from "./test-helpers"
import { buildVehicleIndex, buildWorksiteIndex } from "./shared"
import { normalizeReference, parseSupplyInputsWorkbook, resolveSupplyRows } from "./supply-inputs"

vi.mock("@/lib/utils", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/utils")>()),
  todayInChile: () => "2026-10-21",
}))

const HEADERS = ["Fecha", "Hora", "Faena", "Litros", "Referencia", "Patente o estanque"]

describe("normalizeReference", () => {
  it("compara sin mayúsculas ni espacios de más", () => {
    expect(normalizeReference("  g-123   b ")).toBe("G-123 B")
  })
})

describe("parseSupplyInputsWorkbook", () => {
  it("lee fecha, hora opcional (celda o texto), litros con formato chileno y referencia", async () => {
    const buffer = await buildXlsx(HEADERS, [
      ["15-01-2026", new Date(Date.UTC(1899, 11, 30, 8, 30)), "Faena Norte", "1.250,5", "g-1001", "AB-CD-12"],
      ["16-01-2026", "14:05", "Faena Norte", 800, "G-1002", null],
      [new Date(Date.UTC(2026, 0, 17)), null, "Faena Sur", 50, "G-1003", null],
    ])
    const result = await parseSupplyInputsWorkbook(buffer)
    expect(result.issues).toEqual([])
    expect(result.rows.map((row) => [row.day, row.liters, row.reference, row.target])).toEqual([
      ["2026-01-15", 1250.5, "G-1001", "AB-CD-12"],
      ["2026-01-16", 800, "G-1002", ""],
      ["2026-01-17", 50, "G-1003", ""],
    ])
    // 08:30 de Santiago en enero (UTC-3) son las 11:30 UTC.
    expect(result.rows[0]?.occurredAt).toBe("2026-01-15T11:30:00.000Z")
    expect(result.rows[1]?.occurredAt).toBe("2026-01-16T17:05:00.000Z")
  })

  it("rechaza fecha, hora, litros, faena y referencia inválidos", async () => {
    const buffer = await buildXlsx(HEADERS, [
      ["30-12-1899", null, "Faena Norte", 10, "A", null],
      ["15-01-2026", "25:99", "Faena Norte", 10, "B", null],
      ["15-01-2026", null, "Faena Norte", 0, "C", null],
      ["15-01-2026", null, "", 10, "D", null],
      ["15-01-2026", null, "Faena Norte", 10, "", null],
      ["22-10-2026", null, "Faena Norte", 10, "F", null],
    ])
    const result = await parseSupplyInputsWorkbook(buffer)
    expect(result.rows).toEqual([])
    expect(result.issues.map((issue) => issue.field)).toEqual(["Fecha", "Hora", "Litros", "Faena", "Referencia", "Fecha"])
  })

  it("exige las columnas obligatorias", async () => {
    const result = await parseSupplyInputsWorkbook(await buildXlsx(["Fecha", "Litros"], [["15-01-2026", 10]]))
    expect(result.fileIssue).toMatch(/Faena/)
    expect(result.fileIssue).toMatch(/Referencia/)
  })
})

describe("resolveSupplyRows", () => {
  const worksites = buildWorksiteIndex([
    { id: "w1", name: "Faena Norte", code: "FN-001" },
    { id: "w2", name: "Faena Sur", code: "FS-001" },
    { id: "w3", name: "Casa Central", code: "CC-1" },
    { id: "w4", name: "Casa  central", code: "CC-2" },
  ])
  const vehicles = buildVehicleIndex([{ id: "v1", code: "KA-63", plate: "ABCD12", worksiteId: "w1" }])
  const row = (worksite: string, reference: string, rowIndex: number, target = "") => ({ rowIndex, day: "2026-01-15", occurredAt: "2026-01-15T11:30:00.000Z", worksite, liters: 100, reference, target, rawRow: {} })

  it("resuelve faena por nombre o código sin tildes ni mayúsculas, y el equipo si existe", () => {
    const result = resolveSupplyRows([row("faena  NORTE", "A1", 2, "ab-cd-12"), row("fs-001", "A2", 3, "ESTANQUE 1")], worksites.find, vehicles.find, () => true)
    expect(result.issues).toEqual([])
    expect(result.valid.map((item) => [item.worksiteId, item.vehicleId])).toEqual([["w1", "v1"], ["w2", null]])
  })

  it("rechaza faena desconocida, ambigua, fuera de alcance y referencia repetida", () => {
    const result = resolveSupplyRows(
      [row("Nada", "B1", 2), row("casa central", "B2", 3), row("Faena Sur", "B3", 4), row("Faena Norte", "B4", 5), row("Faena Norte", "B4", 6)],
      worksites.find,
      vehicles.find,
      (worksiteId) => worksiteId === "w1",
    )
    const messages = Object.fromEntries(result.issues.map((issue) => [issue.rowIndex, issue.message]))
    expect(messages[2]).toMatch(/no es una faena/)
    expect(messages[3]).toMatch(/más de una faena/)
    expect(messages[4]).toMatch(/fuera de tu alcance/)
    expect(result.valid.map((item) => item.rowIndex)).toEqual([5])
    expect(messages[6]).toMatch(/fila 5/)
  })
})
