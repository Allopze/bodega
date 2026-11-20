// @vitest-environment jsdom
/**
 * Cotejo en faena de una guía enlazada a una OC: el campo «Recibido en faena»
 * tenía `step="any"` y el diálogo no es un `<form>`, así que nada impedía
 * confirmar 4,5 cascos. La unidad decide el paso, y una fracción en una unidad
 * contable bloquea el botón con el motivo a la vista.
 */
import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), back: vi.fn() }),
}))
vi.mock("@/lib/toast", () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock("../actions", () => ({
  cancelGuideAction: vi.fn(),
  dispatchGuideAction: vi.fn(),
  receiveGuideAction: vi.fn(async () => ({ ok: true })),
}))

import { GuideActions } from "./guide-actions"

function openReceive(unitOfMeasure: string) {
  render(
    <GuideActions
      guideId="g-1"
      code="GDI-000001"
      status="dispatched"
      destinationWorksiteName="Faena Santa Fe"
      itemCount={1}
      receiverOptions={[]}
      defaultReceiverWorkerId=""
      reconciliationItems={[{ id: "gi-1", name: "Casco de seguridad", quantity: 5, unitOfMeasure, receivedQuantity: 0 }]}
      permissions={{ edit: false, dispatch: false, receive: true, cancel: false }}
    />,
  )
  fireEvent.click(screen.getByRole("button", { name: "Confirmar recepción" }))
  return screen.getByLabelText("Recibido en faena") as HTMLInputElement
}

const confirmButton = () =>
  screen.getAllByRole("button", { name: "Confirmar recepción" }).find((button) => button.closest("[role='dialog']"))!

describe("GuideActions — cotejo en faena", () => {
  it("una unidad contable sube de a 1 y no confirma una fracción", () => {
    const field = openReceive("unidad")
    expect([field.step, field.min, field.getAttribute("inputmode")]).toEqual(["1", "0", "numeric"])

    fireEvent.change(field, { target: { value: "4.5" } })
    fireEvent.change(screen.getByLabelText(/Motivo de la diferencia/), { target: { value: "Faltó media unidad" } })
    expect(screen.getByText("Va en cantidades enteras")).toBeInTheDocument()
    expect(confirmButton()).toBeDisabled()

    fireEvent.change(field, { target: { value: "4" } })
    expect(screen.queryByText("Va en cantidades enteras")).toBeNull()
    expect(confirmButton()).toBeEnabled()
  })

  it("una unidad que se mide admite fracción", () => {
    const field = openReceive("kg")
    expect([field.step, field.getAttribute("inputmode")]).toEqual(["0.01", "decimal"])
    fireEvent.change(field, { target: { value: "4.5" } })
    fireEvent.change(screen.getByLabelText(/Motivo de la diferencia/), { target: { value: "Faltó medio kilo" } })
    expect(confirmButton()).toBeEnabled()
  })
})
