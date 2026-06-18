// @vitest-environment jsdom
import { describe, it, expect } from "vitest"
import { render, screen } from "@testing-library/react"
import { Checkbox } from "@/components/ui/checkbox"

describe("Checkbox", () => {
  it("renders label text", () => {
    render(<Checkbox id="cb" label="Notificaciones" />)
    expect(screen.getByText("Notificaciones")).toBeDefined()
  })

  it("associates label with input via htmlFor/id", () => {
    render(<Checkbox id="cb2" label="Activo" />)
    const label = screen.getByText("Activo").closest("label")
    expect(label?.getAttribute("for")).toBe("cb2")
  })

  it("renders as type=checkbox", () => {
    render(<Checkbox id="cb3" label="Activar" />)
    const input = document.getElementById("cb3") as HTMLInputElement
    expect(input?.type).toBe("checkbox")
  })

  it("passes defaultChecked", () => {
    render(<Checkbox id="cb4" label="Sí" defaultChecked />)
    const input = document.getElementById("cb4") as HTMLInputElement
    expect(input?.defaultChecked).toBe(true)
  })

  it("passes disabled", () => {
    render(<Checkbox id="cb5" label="Deshabilitado" disabled />)
    const input = document.getElementById("cb5") as HTMLInputElement
    expect(input?.disabled).toBe(true)
  })
})
