import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { WEEKLY_COLORS } from "./weekly-chart-colors"

/** Luminancia relativa sRGB (WCAG 2.2). */
function luminance(hex: string) {
  const channels = [1, 3, 5].map((offset) => {
    const value = Number.parseInt(hex.slice(offset, offset + 2), 16) / 255
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * channels[0]! + 0.7152 * channels[1]! + 0.0722 * channels[2]!
}

function contrastAgainstWhite(hex: string) {
  return 1.05 / (luminance(hex) + 0.05)
}

describe("colores del gráfico semanal", () => {
  it("cada serie cumple el 3:1 de WCAG para elementos gráficos sobre blanco", () => {
    expect(contrastAgainstWhite(WEEKLY_COLORS.preventive)).toBeGreaterThanOrEqual(3)
    expect(contrastAgainstWhite(WEEKLY_COLORS.corrective)).toBeGreaterThanOrEqual(3)
  })
})

describe("leyenda del gráfico semanal", () => {
  // La `Legend` de recharts pinta el texto con el color de la serie: «Correctivas»
  // (#c96a00) medía 3,8:1 sobre blanco y fallaba AA. La leyenda del sistema
  // (`ChartLegendContent`) usa el color de texto y deja el color sólo en la muestra.
  const source = readFileSync(join(__dirname, "weekly-chart-inner.tsx"), "utf8")

  it("usa la leyenda del sistema y no la de recharts, que heredaba el color de la serie", () => {
    expect(source).toMatch(/ChartLegendContent/)
    expect(source).not.toMatch(/<Legend[\s/>]/)
    expect(source).not.toMatch(/import\s*\{[^}]*\bLegend\b[^}]*\}\s*from\s*"recharts"/)
  })

  it("la correctiva sigue en su naranja", () => {
    expect(WEEKLY_COLORS.corrective).toBe("#c96a00")
  })
})
