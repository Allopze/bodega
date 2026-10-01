// @vitest-environment jsdom
import { fireEvent, render } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { PcSelect } from "./pc-select"

describe("PcSelect", () => {
  it("ofrece Baja, Media y Alta con su valor y devuelve número", () => {
    const onChange = vi.fn()
    const { getByLabelText, getByRole } = render(<PcSelect kind="probability" value={null} onChange={onChange} ariaLabel="Probabilidad fila 1" />)
    const select = getByLabelText("Probabilidad fila 1") as HTMLSelectElement
    expect([...select.options].map((o) => o.textContent)).toEqual(["—", "Baja (1)", "Media (2)", "Alta (4)"])
    fireEvent.change(getByRole("combobox"), { target: { value: "4" } })
    expect(onChange).toHaveBeenCalledWith(4)
  })
  it("con showDescription muestra el criterio del nivel elegido", () => {
    const { getByText } = render(<PcSelect kind="consequence" value={4} onChange={() => {}} ariaLabel="Consecuencia" showDescription />)
    expect(getByText(/amputaciones/)).toBeTruthy()
  })
})
