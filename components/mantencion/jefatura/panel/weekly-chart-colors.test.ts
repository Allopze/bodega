import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { CHART_COLORS } from "@/lib/chart-palette"
import { WEEKLY_COLORS } from "./weekly-chart-colors"

describe("colores del gráfico semanal", () => {
  it("las dos series son tokens de la paleta, sin hex fijos", () => {
    expect(WEEKLY_COLORS.preventive).toMatch(/^var\(--color-/)
    expect(WEEKLY_COLORS.corrective).toMatch(/^var\(--color-/)
    const source = readFileSync(join(__dirname, "weekly-chart-colors.ts"), "utf8")
    expect(source.replace(/\/\*[\s\S]*?\*\//g, "")).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
  })

  it("la correctiva no usa el naranja signal, reservado a lo pendiente", () => {
    expect(WEEKLY_COLORS.corrective).not.toBe(CHART_COLORS.signal)
    expect(WEEKLY_COLORS.preventive).not.toBe(CHART_COLORS.signal)
  })
})

describe("leyenda del gráfico semanal", () => {
  // La `Legend` de recharts pinta el texto con el color de la serie y podía fallar AA.
  // La leyenda del sistema (`ChartLegendContent`) usa el color de texto y deja el color sólo en la muestra.
  const source = readFileSync(join(__dirname, "weekly-chart-inner.tsx"), "utf8")

  it("usa la leyenda del sistema y no la de recharts, que heredaba el color de la serie", () => {
    expect(source).toMatch(/ChartLegendContent/)
    expect(source).not.toMatch(/<Legend[\s/>]/)
    expect(source).not.toMatch(/import\s*\{[^}]*\bLegend\b[^}]*\}\s*from\s*"recharts"/)
  })
})
