import { describe, expect, it } from "vitest"
import { CHART_SERIES } from "@/lib/chart-palette"
import { NO_MEDIUM_COLOR, OVERFLOW_MEDIUM_COLOR, mediumColor } from "./chart-shared"

describe("mediumColor", () => {
  it("los seis primeros medios llevan la serie categórica y el resto un gris, nunca un color reciclado", () => {
    const colors = Array.from({ length: 8 }, (_, index) => mediumColor(`Medio ${index}`, index))
    expect(colors.slice(0, 6)).toEqual([...CHART_SERIES])
    expect(colors.slice(6)).toEqual([OVERFLOW_MEDIUM_COLOR, OVERFLOW_MEDIUM_COLOR])
    expect(new Set(colors.slice(0, 6)).size).toBe(6)
  })

  it("«Sin medio informado» va en el gris de referencia en cualquier posición", () => {
    expect(mediumColor("Sin medio informado", 0)).toBe(NO_MEDIUM_COLOR)
    expect(mediumColor("Sin medio informado", 9)).toBe(NO_MEDIUM_COLOR)
  })
})
