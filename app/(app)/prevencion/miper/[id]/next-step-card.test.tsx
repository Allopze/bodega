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

  it("ir al pendiente se llama «Siguiente pendiente», como el pie del editor, y es push; «Ver los pendientes» es replace", () => {
    const push = vi.spyOn(window.history, "pushState").mockImplementation(() => {})
    const replace = vi.spyOn(window.history, "replaceState").mockImplementation(() => {})
    render(<NextStepCard hrefFor={hrefFor} step={{ tone: "warning", title: "Faltan datos en 2 riesgos", description: "Empieza por los más graves.", action: { kind: "riesgo", entryId: "b", purpose: "pending" }, secondary: { kind: "filtro", completitud: "pendientes" } }} />)
    expect(screen.getByText("Faltan datos en 2 riesgos")).toBeTruthy()
    expect(screen.queryByRole("link", { name: "Empezar por el más grave" })).toBeNull()
    fireEvent.click(screen.getByRole("link", { name: "Siguiente pendiente" }))
    expect(push).toHaveBeenCalledWith(null, "", "/prevencion/miper/m1?accion=riesgo")
    fireEvent.click(screen.getByRole("link", { name: "Ver los pendientes" }))
    expect(replace).toHaveBeenCalledWith(null, "", "/prevencion/miper/m1?accion=filtro")
  })

  it("quien revisa no recorre pendientes: su acción es «Empezar la revisión»", () => {
    vi.spyOn(window.history, "pushState").mockImplementation(() => {})
    render(<NextStepCard hrefFor={hrefFor} step={{ tone: "warning", title: "Revisa la versión enviada", description: "2 riesgos", action: { kind: "riesgo", entryId: "b", purpose: "review" }, secondary: null }} />)
    expect(screen.getByRole("link", { name: "Empezar la revisión" })).toBeTruthy()
    expect(screen.queryByRole("link", { name: "Siguiente pendiente" })).toBeNull()
  })

  it("abrir la ficha reemplaza la entrada del historial", () => {
    const push = vi.spyOn(window.history, "pushState").mockImplementation(() => {})
    const replace = vi.spyOn(window.history, "replaceState").mockImplementation(() => {})
    render(<NextStepCard hrefFor={hrefFor} step={{ tone: "warning", title: "Completa la ficha del documento (1 dato)", description: "", action: { kind: "ficha" }, secondary: null }} />)
    fireEvent.click(screen.getByRole("link", { name: "Abrir la ficha" }))
    expect(replace).toHaveBeenCalledWith(null, "", "/prevencion/miper/m1?accion=ficha")
    expect(push).not.toHaveBeenCalled()
  })
})
