// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { NextStepAction } from "@/lib/prevention/miper/next-step"
import { NextStepCard } from "./next-step-card"

const hrefFor = (action: NextStepAction) => `/prevencion/miper/m1?accion=${action.kind}`

afterEach(() => { vi.restoreAllMocks() })

describe("NextStepCard", () => {
  it("sin paso no pinta nada", () => {
    const { container } = render(<NextStepCard step={null} hrefFor={hrefFor} />)
    expect(container.innerHTML).toBe("")
  })

  it("ir al riesgo es push (vista más profunda) y «Ver los pendientes» es replace, ambos sin servidor", () => {
    const push = vi.spyOn(window.history, "pushState").mockImplementation(() => {})
    const replace = vi.spyOn(window.history, "replaceState").mockImplementation(() => {})
    render(<NextStepCard hrefFor={hrefFor} step={{ tone: "warning", title: "Faltan datos en 2 riesgo(s)", description: "Empieza por los más graves.", action: { kind: "riesgo", entryId: "b" }, secondary: { kind: "filtro", completitud: "pendientes" } }} />)
    expect(screen.getByText("Faltan datos en 2 riesgo(s)")).toBeTruthy()
    fireEvent.click(screen.getByRole("link", { name: "Empezar por el más grave" }))
    expect(push).toHaveBeenCalledWith(null, "", "/prevencion/miper/m1?accion=riesgo")
    fireEvent.click(screen.getByRole("link", { name: "Ver los pendientes" }))
    expect(replace).toHaveBeenCalledWith(null, "", "/prevencion/miper/m1?accion=filtro")
  })

  it("abrir la ficha reemplaza la entrada del historial", () => {
    const push = vi.spyOn(window.history, "pushState").mockImplementation(() => {})
    const replace = vi.spyOn(window.history, "replaceState").mockImplementation(() => {})
    render(<NextStepCard hrefFor={hrefFor} step={{ tone: "warning", title: "Completa la ficha del documento (1 dato(s))", description: "", action: { kind: "ficha" }, secondary: null }} />)
    fireEvent.click(screen.getByRole("link", { name: "Abrir la ficha" }))
    expect(replace).toHaveBeenCalledWith(null, "", "/prevencion/miper/m1?accion=ficha")
    expect(push).not.toHaveBeenCalled()
  })
})
