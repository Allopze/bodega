import { describe, expect, it } from "vitest"
import { canConfirmCopecEmpty, findNextCopecCoverageMonth, type ProviderCoverageRow } from "../copec-coverage"

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
