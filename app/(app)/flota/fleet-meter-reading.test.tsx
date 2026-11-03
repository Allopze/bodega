// @vitest-environment jsdom
import { act, fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { FleetMeterReading } from "./fleet-meter-reading"

const OBJECTION = { caseId: "case-77", ruleLabel: "Kilometraje inferior al anterior" }

describe("FleetMeterReading", () => {
  it("sin ninguna lectura muestra «—»", () => {
    render(<FleetMeterReading vehicle={{ lastOdometerReading: null, lastHourMeterReading: null, lastReadingObjection: null }} />)

    expect(screen.getByText("—")).toBeInTheDocument()
    expect(screen.queryByRole("link")).toBeNull()
  })

  it("muestra el odómetro en km y, a falta de él, el horómetro en h; sin objeción no hay enlace ni ícono", () => {
    const { container, rerender } = render(<FleetMeterReading vehicle={{ lastOdometerReading: 10_900, lastHourMeterReading: null, lastReadingObjection: null }} />)
    expect(screen.getByText("10.900 km")).toBeInTheDocument()

    rerender(<FleetMeterReading vehicle={{ lastOdometerReading: null, lastHourMeterReading: 120.5, lastReadingObjection: null }} />)
    expect(screen.getByText("120,5 h")).toBeInTheDocument()
    expect(screen.queryByRole("link")).toBeNull()
    expect(container.querySelector("svg")).toBeNull()
  })

  describe("con un caso abierto sobre la lectura", () => {
    const renderObjected = () =>
      render(<FleetMeterReading vehicle={{ lastOdometerReading: 1, lastHourMeterReading: null, lastReadingObjection: OBJECTION }} />)

    it("sigue mostrando la lectura tal cual, aunque parezca absurda", () => {
      renderObjected()

      expect(screen.getByText("1 km")).toBeInTheDocument()
    })

    it("la marca es un enlace con nombre accesible «Lectura objetada: revisar caso» que abre el caso en la bandeja", () => {
      renderObjected()

      const link = screen.getByRole("link", { name: "Lectura objetada: revisar caso" })
      expect(link).toHaveAttribute("href", "/combustibles/revisar?tipo=caso&item=caso%3Acase-77")
    })

    it("no depende del color: el ícono es una forma (triángulo) oculta a los lectores y el texto va aparte", () => {
      const { container } = renderObjected()

      const icon = screen.getByRole("link", { name: "Lectura objetada: revisar caso" }).querySelector("svg")
      expect(icon).not.toBeNull()
      expect(icon).toHaveAttribute("aria-hidden", "true")
      // Color de estado de texto/ícono: el token -ink (regla 8), nunca el base.
      expect(container.innerHTML).toContain("--color-warning-ink")
      expect(container.innerHTML).not.toMatch(/--color-warning[^-]/)
    })

    it("se alcanza con el teclado (sin tabindex negativo) y el foco abre el tooltip con la regla que la objeta", async () => {
      renderObjected()
      const link = screen.getByRole("link", { name: "Lectura objetada: revisar caso" })

      expect(link.getAttribute("tabindex")).not.toBe("-1")
      await act(async () => { link.focus() })
      expect((await screen.findAllByText(/Kilometraje inferior al anterior/)).length).toBeGreaterThan(0)
      expect(document.body.textContent).toContain("Revisar caso")
    })

    it("no cambia el nombre accesible ni agrega un enlace al valor de una fila sin objeción", () => {
      render(<FleetMeterReading vehicle={{ lastOdometerReading: 52_000, lastHourMeterReading: null, lastReadingObjection: null }} />)

      expect(screen.queryByRole("link", { name: /Lectura objetada/ })).toBeNull()
      fireEvent.focus(screen.getByText("52.000 km"))
      expect(document.body.textContent).not.toContain("Revisar caso")
    })
  })
})
