import { describe, expect, it } from "vitest"
import { canConfirmCopecEmpty, findNextCopecCoverageMonth, isCopecMonthClosed, monthsWithoutProviderData, type ProviderCoverageRow } from "../copec-coverage"

const dimensions = ["TCT", "TAE"].flatMap((channel) => ["diesel", "bluemax"].map((product) => ({ channel, product })))
const closedRows = (periodMonth: string, status = "complete"): ProviderCoverageRow[] => dimensions.map(({ channel, product }) => ({
  provider: "copec",
  sourceAccount: `${channel.toLowerCase()}:${product}`,
  channel,
  product,
  periodMonth,
  status,
}))

describe("findNextCopecCoverageMonth", () => {
  it("continues from the earliest month with a non-terminal product/channel", () => {
    const rows = [
      ...closedRows("2026-01-01"),
      ...closedRows("2026-02-01"),
    ].filter((row) => !(row.channel === "TAE" && row.product === "bluemax" && row.periodMonth === "2026-01-01"))

    expect(findNextCopecCoverageMonth(rows, "2026-01-01", "2026-03-31")).toBe("2026-01-01")
  })

  it("treats unknown, incomplete, and failed as open and only closes complete or evidenced-empty months", () => {
    expect(findNextCopecCoverageMonth(closedRows("2026-01-01", "legitimate_empty"), "2026-01-01", "2026-01-31")).toBeNull()
    for (const status of ["unknown", "incomplete", "failed"]) {
      expect(findNextCopecCoverageMonth(closedRows("2026-01-01", status), "2026-01-01", "2026-01-31")).toBe("2026-01-01")
    }
  })

  it("returns null when every required product and channel is terminal", () => {
    expect(findNextCopecCoverageMonth(closedRows("2026-01-01"), "2026-01-01", "2026-01-31")).toBeNull()
  })
})

describe("canConfirmCopecEmpty", () => {
  it("permite confirmar un mes sin observación o desconocido", () => {
    expect(canConfirmCopecEmpty(undefined)).toBe(true)
    expect(canConfirmCopecEmpty({ status: "unknown", sourceAvailability: "unavailable", rowsReceived: 0 })).toBe(true)
  })

  it("permite confirmar un archivo entregado sin filas ni errores", () => {
    // La sincronización lo deja `failed` porque un archivo vacío no basta como
    // evidencia; sin esta salida el mes no podía cerrarse nunca.
    expect(canConfirmCopecEmpty({ status: "failed", sourceAvailability: "available", rowsReceived: 0 })).toBe(true)
  })

  it.each([
    { status: "failed", sourceAvailability: "available", rowsReceived: 3 },
    { status: "failed", sourceAvailability: "unknown", rowsReceived: 0 },
    { status: "incomplete", sourceAvailability: "available", rowsReceived: 0 },
    { status: "complete", sourceAvailability: "available", rowsReceived: 5 },
  ])("no permite declarar vacío $status/$sourceAvailability con $rowsReceived filas", (row) => {
    expect(canConfirmCopecEmpty(row)).toBe(false)
  })
})

/**
 * C-4 / C-10: un mes sin filas del proveedor no es «no se compró combustible»
 * mientras la cobertura no lo certifique. `monthsWithoutProviderData` dice qué
 * meses de una serie no tienen respaldo para dibujar un cero.
 */
describe("isCopecMonthClosed", () => {
  const rowsOf = (periodMonth: string, status = "complete") => closedRows(periodMonth, status).map((row) => ({ ...row, rowsAccepted: 0 }))

  it("sólo cierra el mes cuando las cuatro cuentas (TCT/TAE × diésel/BlueMax) son terminales", () => {
    expect(isCopecMonthClosed(rowsOf("2026-01-01"))).toBe(true)
    expect(isCopecMonthClosed(rowsOf("2026-01-01", "legitimate_empty"))).toBe(true)
    expect(isCopecMonthClosed(rowsOf("2026-01-01").slice(1))).toBe(false)
    expect(isCopecMonthClosed(rowsOf("2026-01-01", "incomplete"))).toBe(false)
    expect(isCopecMonthClosed([])).toBe(false)
  })
})

describe("monthsWithoutProviderData", () => {
  const coverage = (periodMonth: string, status: string, rowsAccepted: number) =>
    closedRows(periodMonth, status).map((row, index) => ({ ...row, rowsAccepted: index === 0 ? rowsAccepted : 0 }))
  const months = ["2026-07", "2026-08", "2026-09", "2026-10"]

  it("un mes sin fila de cobertura ni filas contables es un hueco, no un cero", () => {
    const rows = [...coverage("2026-07-01", "complete", 10), ...coverage("2026-08-01", "complete", 10), ...coverage("2026-10-01", "incomplete", 5)]
    expect([...monthsWithoutProviderData(months, rows)]).toEqual(["2026-09"])
  })

  it("un mes con filas aceptadas tiene datos aunque su cobertura siga incompleta", () => {
    const rows = coverage("2026-10-01", "incomplete", 329)
    expect(monthsWithoutProviderData(["2026-10"], rows).size).toBe(0)
  })

  it("un mes cerrado por la cobertura sin filas es un cero real", () => {
    expect(monthsWithoutProviderData(["2026-03"], coverage("2026-03-01", "legitimate_empty", 0)).size).toBe(0)
    expect(monthsWithoutProviderData(["2026-03"], coverage("2026-03-01", "complete", 0)).size).toBe(0)
  })

  it("una cobertura abierta y sin filas (failed/unknown/incomplete) sigue siendo un hueco", () => {
    for (const status of ["failed", "unknown", "incomplete"]) {
      expect([...monthsWithoutProviderData(["2026-03"], coverage("2026-03-01", status, 0))]).toEqual(["2026-03"])
    }
  })

  it("las filas contables que la consulta ya vio cuentan como datos aunque no haya cobertura", () => {
    expect([...monthsWithoutProviderData(months, [], new Set(["2026-08"]))]).toEqual(["2026-07", "2026-09", "2026-10"])
  })
})
