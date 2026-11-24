// @vitest-environment jsdom
import React from "react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, render } from "@testing-library/react"

// Recharts de verdad salvo el contenedor: jsdom no mide y sin tamaño no dibuja.
vi.mock("recharts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("recharts")>()
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children: React.ReactElement<{ width?: number; height?: number }> }) => React.cloneElement(children, { width: 600, height: 280 }),
  }
})
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn() }),
  usePathname: () => "/mantencion/panel",
  useSearchParams: () => new URLSearchParams(),
}))

import { HoursRecordsComboChart, recordsText } from "./hours-records-combo-chart"

afterEach(cleanup)

describe("HoursRecordsComboChart", () => {
  it("el eje de horas usa la coma decimal del resto del tablero, no el punto", () => {
    // 2,6 h como máximo: recharts parte el eje en 0 / 0,65 / 1,3 / 1,95 / 2,6.
    const { container } = render(
      <HoursRecordsComboChart data={[{ key: "v-1", label: "KA-143", hours: 2.6, records: 1 }]} ariaLabel="Horas por equipo" />,
    )
    // El primer eje Y es el de las horas (izquierda); el segundo, el de los registros.
    const ticks = container.querySelector(".recharts-yAxis-tick-labels")?.querySelectorAll(".recharts-cartesian-axis-tick-value") ?? []
    const labels = Array.from(ticks).map((tick) => tick.textContent)
    expect(labels).toEqual(["0", "0,65", "1,3", "1,95", "2,6"])
  })

  it("el tooltip concuerda «registro» con la cantidad", () => {
    expect(recordsText(1)).toBe("1 registro")
    expect(recordsText(0)).toBe("0 registros")
    expect(recordsText(12)).toBe("12 registros")
  })
})
