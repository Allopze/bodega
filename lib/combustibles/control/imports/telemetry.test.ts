import { describe, expect, it, vi } from "vitest"
import { buildXlsx } from "./test-helpers"
import { buildVehicleIndex } from "./shared"
import { normalizeSourceSlug, parseTelemetryWorkbook, resolveTelemetryRows } from "./telemetry"

vi.mock("@/lib/utils", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/utils")>()),
  todayInChile: () => "2026-10-21",
}))

const HEADERS = ["Equipo", "Fecha", "Horas funcionamiento", "Horas en vacío", "Litros trabajando", "Litros en vacío", "Litros totales"]

describe("normalizeSourceSlug", () => {
  it("pasa a minúsculas, sin tildes ni signos", () => {
    expect(normalizeSourceSlug("VisionLink")).toBe("visionlink")
    expect(normalizeSourceSlug("  Vísion Link (CAT) ")).toBe("vision-link-cat")
    expect(normalizeSourceSlug("***")).toBe("")
  })
})

describe("parseTelemetryWorkbook", () => {
  it("lee fecha dd-mm-aaaa, coma decimal y celdas de fecha de Excel", async () => {
    const buffer = await buildXlsx(HEADERS, [
      ["KA-63", "15-01-2026", "7,5", "1,25", "120,5", "30", null],
      ["AB1234", new Date(Date.UTC(2026, 0, 16)), 8, 2, null, null, null],
    ])
    const result = await parseTelemetryWorkbook(buffer)
    expect(result.issues).toEqual([])
    expect(result.rows).toHaveLength(2)
    expect(result.rows[0]).toMatchObject({ equipment: "KA-63", day: "2026-01-15", operatingHours: 7.5, idleHours: 1.25, litersWorking: 120.5, litersIdle: 30 })
    expect(result.rows[1]).toMatchObject({ equipment: "AB1234", day: "2026-01-16", litersWorking: null, litersIdle: null })
  })

  it("deriva litros trabajando = totales − vacío", async () => {
    const buffer = await buildXlsx(HEADERS, [["KA-63", "15-01-2026", 8, 2, null, 30, 150]])
    const result = await parseTelemetryWorkbook(buffer)
    expect(result.rows[0]?.litersWorking).toBe(120)
  })

  it("rechaza con motivo: relleno, futura, rangos, negativos, textos y totales sin vacío", async () => {
    const buffer = await buildXlsx(HEADERS, [
      ["KA-1", "30-12-1899", 8, 2, null, null, null],
      ["KA-2", "22-10-2026", 8, 2, null, null, null],
      ["KA-3", "15-01-2026", 25, 2, null, null, null],
      ["KA-4", "15-01-2026", 5, 6, null, null, null],
      ["KA-5", "15-01-2026", 5, 1, -4, null, null],
      ["KA-6", "15-01-2026", "mucho", 1, null, null, null],
      ["KA-7", "15-01-2026", 5, 1, null, null, 100],
      ["KA-8", "15-01-2026", 5, 1, 10, null, 100],
      ["", "15-01-2026", 5, 1, null, null, null],
      ["KA-9", null, 5, 1, null, null, null],
      ["KA-10", "03/02/26", 5, 1, null, null, null],
    ])
    const result = await parseTelemetryWorkbook(buffer)
    expect(result.rows).toEqual([])
    expect(result.totalRows).toBe(11)
    const byRow = new Map(result.issues.map((issue) => [issue.rowIndex, issue]))
    expect(byRow.get(2)?.message).toMatch(/relleno/)
    expect(byRow.get(3)?.message).toMatch(/futura/)
    expect(byRow.get(4)?.field).toBe("Horas funcionamiento")
    expect(byRow.get(5)?.field).toBe("Horas en vacío")
    expect(byRow.get(6)?.message).toMatch(/negativo/)
    expect(byRow.get(7)?.message).toMatch(/número/)
    expect(byRow.get(8)?.message).toMatch(/Litros en vacío/)
    expect(byRow.get(9)?.message).toMatch(/no ambos/)
    expect(byRow.get(10)?.field).toBe("Equipo")
    expect(byRow.get(11)?.field).toBe("Fecha")
    expect(byRow.get(12)?.field).toBe("Fecha")
  })

  it("avisa de columnas obligatorias faltantes y de archivos ilegibles", async () => {
    const missing = await parseTelemetryWorkbook(await buildXlsx(["Equipo", "Fecha"], [["KA-1", "15-01-2026"]]))
    expect(missing.fileIssue).toMatch(/Horas funcionamiento/)
    const garbage = await parseTelemetryWorkbook(new Uint8Array([1, 2, 3, 4]))
    expect(garbage.fileIssue).toMatch(/No se pudo leer/)
  })

  it("reconoce encabezados sin tilde y en otro orden, y salta filas en blanco", async () => {
    const buffer = await buildXlsx(["fecha", "EQUIPO", "Horas en vacio", "Horas funcionamiento"], [
      ["15-01-2026", "KA-63", 1, 5],
      [null, null, null, null],
      ["16-01-2026", "KA-63", 0, 4],
    ])
    const result = await parseTelemetryWorkbook(buffer)
    expect(result.issues).toEqual([])
    expect(result.rows.map((row) => row.rowIndex)).toEqual([2, 4])
  })
})

describe("resolveTelemetryRows", () => {
  const index = buildVehicleIndex([
    { id: "v1", code: "KA-63", plate: "ABCD12", worksiteId: "w1" },
    { id: "v2", code: null, plate: "XY-99-88", worksiteId: "w2" },
    { id: "v3", code: "DUP", plate: "AAAA11", worksiteId: "w1" },
    { id: "v4", code: "DUP", plate: "BBBB22", worksiteId: "w1" },
  ])
  const row = (equipment: string, day: string, rowIndex: number) => ({ rowIndex, equipment, day, operatingHours: 8, idleHours: 2, litersWorking: null, litersIdle: null, rawRow: {} })

  it("resuelve por código o patente (sin separadores) y respeta el alcance de faenas", async () => {
    const result = resolveTelemetryRows(
      [row("ka63", "2026-01-15", 2), row("abcd-12", "2026-01-16", 3), row("XY9988", "2026-01-15", 4), row("NOEXISTE", "2026-01-15", 5), row("DUP", "2026-01-15", 6)],
      index.find,
      (worksiteId) => worksiteId === "w1",
    )
    expect(result.valid.map((item) => [item.rowIndex, item.vehicleId, item.month])).toEqual([[2, "v1", "2026-01"], [3, "v1", "2026-01"]])
    const messages = Object.fromEntries(result.issues.map((issue) => [issue.rowIndex, issue.message]))
    expect(messages[4]).toMatch(/fuera de tu alcance/)
    expect(messages[5]).toMatch(/no está en el catálogo/)
    expect(messages[6]).toMatch(/más de un equipo/)
  })

  it("rechaza el mismo equipo y día repetido aunque venga por código y por patente", () => {
    const result = resolveTelemetryRows([row("KA-63", "2026-01-15", 2), row("ABCD12", "2026-01-15", 3)], index.find, () => true)
    expect(result.valid).toHaveLength(1)
    expect(result.issues).toEqual([expect.objectContaining({ rowIndex: 3, field: "Fecha", message: expect.stringContaining("fila 2") })])
  })
})
