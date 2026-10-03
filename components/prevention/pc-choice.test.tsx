// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { RE04_METHODOLOGY } from "@/lib/prevention/miper/methodology"
import { PcChoice } from "./pc-choice"

describe("PcChoice", () => {
  it("ofrece Baja, Media y Alta (1, 2, 4) para P y C con el texto del RE-04", () => {
    render(<PcChoice probability={null} consequence={null} onChange={() => {}} />)
    const probability = screen.getByRole("radiogroup", { name: "Probabilidad" })
    expect([...probability.querySelectorAll("[role=radio]")].map((radio) => radio.querySelector("p")?.textContent)).toEqual(["1 · Baja", "2 · Media", "4 · Alta"])
    expect(screen.getByText(/Elige probabilidad y consecuencia/)).toBeTruthy()
  })
  it("devuelve sólo el eje que cambió", () => {
    const onChange = vi.fn()
    render(<PcChoice probability={2} consequence={4} onChange={onChange} />)
    fireEvent.click(screen.getByRole("radio", { name: /^4 · Alta(?! \()/ }))
    expect(onChange).toHaveBeenCalledWith({ probability: 4 })
  })
  it("4 × 4 muestra MR 16, Intolerable y su criterio", () => {
    render(<PcChoice probability={4} consequence={4} onChange={() => {}} />)
    const status = screen.getByRole("status")
    expect(status.textContent).toMatch(/16/)
    expect(status.textContent).toMatch(/Intolerable/)
    expect(status.textContent).toMatch(/se debe prohibir el trabajo/)
  })
  it("la leyenda de bandas sale de RE04_METHODOLOGY (la misma fuente que congela cada MIPER)", () => {
    render(<PcChoice probability={null} consequence={null} onChange={() => {}} />)
    const bands = RE04_METHODOLOGY.configuration.bands.map((band) => `${band.magnitudes.join("–")} ${band.label}`).join(" · ")
    expect(bands).toBe("1–2 Tolerable · 4 Moderado · 8 Importante · 16 Intolerable")
    expect(screen.getByText(`Bandas del RE-04: ${bands}`)).toBeTruthy()
  })
})
