// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { draftOf, KEEP_RESPONSIBLE, ResponsibleField, valuesOf } from "./control-fields"

describe("borrador de la medida (Fase D: compartido por el editor y «Agregar medida a N»)", () => {
  it("una medida nueva nace «Por implementar», tipo IV y con el responsable escrito vacío", () => {
    expect(draftOf(null)).toEqual({ hierarchy: "administrative", isExisting: false, frequency: "", description: "", responsibleUserId: "", responsibleName: "", dueDate: "" })
  })
  it("D5: lo que no aplica viaja en null; el nombre escrito sólo sin persona", () => {
    const draft = { ...draftOf(null), description: " Charla de trasvasije ", responsibleName: " Supervisor ", dueDate: "2026-12-31", frequency: "Mensual" }
    expect(valuesOf(draft)).toEqual({ hierarchy: "administrative", description: "Charla de trasvasije", responsibleUserId: null, responsibleName: "Supervisor", isExisting: false, verificationFrequency: null, dueDate: "2026-12-31" })
    expect(valuesOf({ ...draft, isExisting: true, frequency: " Mensual ", responsibleUserId: "u1" }))
      .toMatchObject({ responsibleUserId: "u1", responsibleName: null, isExisting: true, verificationFrequency: "Mensual", dueDate: null })
  })
})

describe("ResponsibleField", () => {
  const options = [{ id: "u1", name: "Ana Pérez" }]
  it("en lote parte en «No cambiar»; «Otra persona o cargo…» pide el nombre", () => {
    const onChange = vi.fn()
    const { rerender } = render(<ResponsibleField userId={KEEP_RESPONSIBLE} name="" onChange={onChange} options={options} keepLabel="No cambiar" />)
    const select = screen.getByRole("combobox", { name: "Responsable de la medida" })
    expect(select).toHaveTextContent("No cambiar")
    expect(screen.queryByRole("textbox", { name: "Nombre o cargo responsable" })).toBeNull()
    fireEvent.click(select)
    fireEvent.click(screen.getByRole("option", { name: "Otra persona o cargo…" }))
    expect(onChange).toHaveBeenCalledWith({ userId: "", name: "" })
    rerender(<ResponsibleField userId="" name="Jefe de bodega" onChange={onChange} options={options} keepLabel="No cambiar" />)
    expect(screen.getByRole("textbox", { name: "Nombre o cargo responsable" })).toHaveValue("Jefe de bodega")
  })
  it("fuera de lote no ofrece «No cambiar»", () => {
    render(<ResponsibleField userId="u1" name="" onChange={vi.fn()} options={options} />)
    fireEvent.click(screen.getByRole("combobox", { name: "Responsable de la medida" }))
    expect(screen.queryByRole("option", { name: "No cambiar" })).toBeNull()
    expect(screen.getByRole("option", { name: "Ana Pérez" })).toBeTruthy()
  })
})
