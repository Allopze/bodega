// @vitest-environment jsdom

import { fireEvent, render, screen, within } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { PdtpActivityPicker, type PdtpActivityPickerOption } from "./pdtp-activity-picker"

const options: PdtpActivityPickerOption[] = [
  { id: "catalog-30", code: "PDT-030-ALCOTEST-PREVENCION", title: "Realizar alcotest por Prevención", description: "Control administrativo de alcohol", status: "active", annualNumber: 30 },
  { id: "catalog-31", code: "PDT-031-ALCOTEST-TURNOS", title: "Realizar alcotest en turnos", description: "Control por supervisores de turno", status: "active", annualNumber: 31 },
  { id: "catalog-old", code: "PDT-002-PLAN", title: "Difundir el plan", description: "Actividad histórica retirada", status: "retired", annualNumber: 2 },
]

describe("PdtpActivityPicker", () => {
  it("busca por descripción y muestra código, título y número anual", () => {
    render(<PdtpActivityPicker options={options} value="" onChange={vi.fn()} label="Actividad acreditada" />)
    fireEvent.click(screen.getByRole("button", { name: /seleccionar actividad/i }))
    fireEvent.change(screen.getByRole("searchbox", { name: /buscar actividad/i }), { target: { value: "supervisores" } })

    const listbox = screen.getByRole("listbox")
    expect(within(listbox).getByText("Realizar alcotest en turnos")).toBeVisible()
    expect(within(listbox).getByText(/PDT-031-ALCOTEST-TURNOS/)).toBeVisible()
    expect(within(listbox).getByText(/N°31/)).toBeVisible()
    expect(within(listbox).queryByText("Realizar alcotest por Prevención")).toBeNull()
  })

  it("selecciona múltiples y conserva una retirada histórica sin permitir elegirla de nuevo", () => {
    const onChange = vi.fn()
    render(<PdtpActivityPicker multiple options={options} value={["catalog-old"]} onChange={onChange} label="Actividades acreditadas" />)
    fireEvent.click(screen.getByRole("button", { name: /1 actividad seleccionada/i }))

    expect(screen.getByRole("option", { name: /Difundir el plan/ })).toHaveAttribute("aria-disabled", "true")
    fireEvent.click(screen.getByRole("option", { name: /Realizar alcotest por Prevención/ }))
    expect(onChange).toHaveBeenCalledWith(["catalog-old", "catalog-30"])
  })
})
