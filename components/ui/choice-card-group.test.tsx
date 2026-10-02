// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { ChoiceCardGroup } from "./choice-card-group"

const OPTIONS = [{ value: "yes", title: "Sí" }, { value: "partial", title: "Parcialmente" }, { value: "no", title: "No" }] as const

describe("ChoiceCardGroup", () => {
  it("es un radiogroup con una sola tarjeta tabulable y avisa al elegir otra", () => {
    const onChange = vi.fn()
    render(<ChoiceCardGroup label="¿Está controlado?" options={[...OPTIONS]} value="partial" onChange={onChange} />)
    const radios = screen.getAllByRole("radio")
    expect(screen.getByRole("radiogroup", { name: "¿Está controlado?" })).toBeTruthy()
    expect(radios.map((radio) => radio.getAttribute("tabindex"))).toEqual(["-1", "0", "-1"])
    fireEvent.click(screen.getByRole("radio", { name: "Parcialmente" }))
    expect(onChange).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole("radio", { name: "No" }))
    expect(onChange).toHaveBeenCalledWith("no")
  })
  it("las flechas mueven la selección y dan la vuelta", () => {
    const onChange = vi.fn()
    render(<ChoiceCardGroup label="g" options={[...OPTIONS]} value="no" onChange={onChange} />)
    fireEvent.keyDown(screen.getByRole("radio", { name: "No" }), { key: "ArrowRight" })
    expect(onChange).toHaveBeenCalledWith("yes")
  })
})
