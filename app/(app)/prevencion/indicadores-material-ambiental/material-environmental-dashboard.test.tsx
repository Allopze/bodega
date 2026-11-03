// @vitest-environment jsdom
/**
 * Fase 0.1 (AUDITORIA_VISUALIZACIONES_CHOME, CHART-006): «Total eventos» sumaba
 * TODAS las faenas mientras las otras tres cifras de la tira seguían a la faena
 * elegida, así que al cambiar de faena el total contradecía a sus propios
 * sumandos.
 */
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn(), push: vi.fn() }) }))

import { MaterialEnvironmentalDashboard, type MaterialEnvironmentalData } from "./material-environmental-dashboard"

afterEach(cleanup)

function entry(
  worksiteId: string,
  worksiteName: string,
  annual: MaterialEnvironmentalData["annual"],
): MaterialEnvironmentalData {
  return {
    worksiteId,
    worksiteName,
    monthly: Array.from({ length: 12 }, (_, index) => ({
      month: index + 1, dangerousIncidents: 0, materialDamage: 0, environmentalSpills: 0,
    })),
    annual,
  }
}

// Total = 2+1+0 (A) + 0+0+4 (B) = 7 eventos; A suma 3 y B suma 4.
const EVENT_DATA: MaterialEnvironmentalData[] = [
  entry("ws-a", "Faena A", { dangerousIncidents: 2, materialDamage: 1, environmentalSpills: 0 }),
  entry("ws-b", "Faena B", { dangerousIncidents: 0, materialDamage: 0, environmentalSpills: 4 }),
  entry("total", "Total de faenas visibles", { dangerousIncidents: 2, materialDamage: 1, environmentalSpills: 4 }),
]

/** La celda de la tira de cifras: su rótulo (`text-eyebrow`) y su valor, no la cabecera de la tabla. */
function tile(label: string): HTMLElement {
  const eyebrow = screen.getAllByText(label).find((node) => node.classList.contains("text-eyebrow"))
  if (!eyebrow?.parentElement) throw new Error(`No hay celda «${label}» en la tira de cifras`)
  return eyebrow.parentElement
}

function renderDashboard() {
  return render(<MaterialEnvironmentalDashboard eventData={EVENT_DATA} year={2026} currentYear={2026} />)
}

describe("MaterialEnvironmentalDashboard — «Total eventos»", () => {
  it("con el total de faenas elegido suma todas las faenas", () => {
    renderDashboard()

    expect(within(tile("Total eventos")).getByText("7")).toBeInTheDocument()
  })

  it("al elegir una faena, el total es la suma de ESA faena y coincide con sus tres tipos", () => {
    renderDashboard()

    fireEvent.click(screen.getByRole("combobox", { name: "Faena" }))
    fireEvent.click(screen.getByRole("option", { name: "Faena A" }))

    expect(within(tile("Inc. peligrosos")).getByText("2")).toBeInTheDocument()
    expect(within(tile("Daño material")).getByText("1")).toBeInTheDocument()
    expect(within(tile("Daño ambiental")).getByText("0")).toBeInTheDocument()
    // Antes seguía diciendo 7 (la suma de todas las faenas).
    expect(within(tile("Total eventos")).getByText("3")).toBeInTheDocument()
  })

  it("cambia con la faena: Faena B suma 4, no el total ni lo de A", () => {
    renderDashboard()

    fireEvent.click(screen.getByRole("combobox", { name: "Faena" }))
    fireEvent.click(screen.getByRole("option", { name: "Faena B" }))

    expect(within(tile("Total eventos")).getByText("4")).toBeInTheDocument()
  })
})
