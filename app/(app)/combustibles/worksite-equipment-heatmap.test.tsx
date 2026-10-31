import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import type { HeatmapCell } from "@/lib/combustibles/consumption-dashboard"
import { HEATMAP_STEPS, WorksiteEquipmentHeatmap, heatmapStep } from "./worksite-equipment-heatmap"

const cell = (worksiteName: string, equipmentLabel: string, liters: number, max = 1000): HeatmapCell => ({ worksiteName, equipmentLabel, liters, amount: null, intensity: liters / max })

describe("mapa de calor faena × equipo", () => {
  it("usa un solo tono: sin rojo, ámbar ni verde de semáforo, porque el color no codifica categorías", () => {
    const html = renderToStaticMarkup(<WorksiteEquipmentHeatmap cells={[cell("Faena A", "KA-1", 1000), cell("Faena A", "KA-2", 500), cell("Faena B", "KA-1", 100)]} />)
    expect(html).not.toMatch(/--color-(danger|warning|success)/)
    expect(html).toContain("color-mix(in oklab, var(--color-primary)")
  })

  it("más litros es un paso más oscuro, y el mayor lleva texto claro", () => {
    expect(heatmapStep(1).mix).toBe(100)
    expect(heatmapStep(0.5).mix).toBeLessThan(heatmapStep(0.9).mix)
    expect(heatmapStep(0).mix).toBe(HEATMAP_STEPS[HEATMAP_STEPS.length - 1]!.mix)
    const html = renderToStaticMarkup(<WorksiteEquipmentHeatmap cells={[cell("Faena A", "KA-1", 1000)]} />)
    expect(html).toContain("color:var(--color-surface)")
  })

  it("rotula la escala con palabras y dice que más oscuro es más litros", () => {
    const html = renderToStaticMarkup(<WorksiteEquipmentHeatmap cells={[cell("Faena A", "KA-1", 1000)]} />)
    expect(html).toContain("Menos litros")
    expect(html).toContain("Más litros")
    expect(html).toContain("más oscuro es más litros")
  })

  it("una combinación sin litros queda como guion, no como una celda de color", () => {
    const html = renderToStaticMarkup(<WorksiteEquipmentHeatmap cells={[cell("Faena A", "KA-1", 1000), cell("Faena B", "KA-2", 400)]} />)
    expect(html.match(/>—</g)?.length).toBe(2)
  })

  it("sin datos explica que no hay matriz que construir", () => {
    expect(renderToStaticMarkup(<WorksiteEquipmentHeatmap cells={[]} />)).toContain("Sin datos para construir la matriz")
  })
})
