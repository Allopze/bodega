import { describe, expect, it } from "vitest"
import { REPORT_PERIODS, listWindowParams, parseReportPeriod, reportWindows } from "./reportes-period"

// 3-nov-2026, mediodía en Chile.
const NOW = new Date("2026-11-03T15:00:00Z")

describe("parseReportPeriod", () => {
  it("acepta los períodos conocidos y cae al mes en curso con cualquier otra cosa", () => {
    expect(parseReportPeriod("trimestre")).toBe("trimestre")
    expect(parseReportPeriod("anio")).toBe("anio")
    expect(parseReportPeriod("todo")).toBe("todo")
    expect(parseReportPeriod(undefined)).toBe("mes")
    expect(parseReportPeriod("semana")).toBe("mes")
    expect(parseReportPeriod(["anio", "mes"])).toBe("anio")
  })

  it("ofrece los cuatro, con «Todo» para el histórico que la pantalla tenía antes", () => {
    expect(REPORT_PERIODS.map((period) => period.value)).toEqual(["mes", "trimestre", "anio", "todo"])
  })
})

describe("reportWindows", () => {
  it("el mes en curso y el anterior usan los mismos límites que el tablero", () => {
    const windows = reportWindows("mes", NOW)

    expect(windows.current).toMatchObject({ start: "2026-11-01T00:00:00.000Z", end: "2026-12-01T00:00:00.000Z", startKey: "2026-11-01", endKey: "2026-12-01" })
    expect(windows.previous).toMatchObject({ start: "2026-10-01T00:00:00.000Z", end: "2026-11-01T00:00:00.000Z", startKey: "2026-10-01", endKey: "2026-11-01" })
  })

  it("trimestre y año", () => {
    expect(reportWindows("trimestre", NOW).current?.startKey).toBe("2026-10-01")
    expect(reportWindows("anio", NOW).previous?.startKey).toBe("2025-01-01")
  })

  it("«Todo» no tiene ventana ni comparación: sin período anterior no se inventa una variación", () => {
    expect(reportWindows("todo", NOW)).toEqual({ current: null, previous: null })
  })
})

describe("listWindowParams", () => {
  it("entrega `desde` y `hasta` INCLUSIVOS: el fin de la ventana es exclusivo y se resta un día", () => {
    const { current } = reportWindows("mes", NOW)

    expect(listWindowParams(current, undefined)).toEqual({ desde: "2026-11-01", hasta: "2026-11-30" })
  })

  it("agrega la faena elegida, y «Todo» no agrega fechas", () => {
    expect(listWindowParams(null, "ws-1")).toEqual({ faena: "ws-1" })
    expect(listWindowParams(reportWindows("anio", NOW).current, "ws-1")).toEqual({ desde: "2026-01-01", hasta: "2026-12-31", faena: "ws-1" })
  })
})
