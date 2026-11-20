// @vitest-environment jsdom
/**
 * OC-2026-0065 (2026-11-20): en el cotejo de la guía, cada línea por debajo de
 * lo despachado pide su propio motivo. Con el motivo escrito en una sola de
 * tres, «Confirmar recepción» quedaba gris sin decir por qué.
 */
import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"

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

afterEach(() => cleanup())

const ITEMS = [
  { id: "gi-guante", name: "Guante Cabritilla", quantity: 20, unitOfMeasure: "par", receivedQuantity: 0 },
  { id: "gi-pantalon", name: "Pantalón Lightwind", quantity: 2, unitOfMeasure: "unidad", receivedQuantity: 0 },
  { id: "gi-camisa", name: "Camisa Absolute Zero", quantity: 2, unitOfMeasure: "unidad", receivedQuantity: 0 },
  { id: "gi-botin", name: "Botín V-Flex", quantity: 1, unitOfMeasure: "unidad", receivedQuantity: 0 },
]

function openReceive() {
  render(
    <GuideActions
      guideId="g-1"
      code="GDI-000074"
      status="dispatched"
      destinationWorksiteName="Faena Santa Fe"
      itemCount={ITEMS.length}
      receiverOptions={[]}
      defaultReceiverWorkerId=""
      reconciliationItems={ITEMS}
      permissions={{ edit: false, dispatch: false, receive: true, cancel: false }}
    />,
  )
  fireEvent.click(screen.getByRole("button", { name: "Confirmar recepción" }))
}

const dialog = () => screen.getByRole("dialog")
const confirmButton = () =>
  screen.getAllByRole("button", { name: "Confirmar recepción" }).find((button) => button.closest("[role='dialog']"))!

function markNotArrived(id: string) {
  fireEvent.change(dialog().querySelector(`#gdi-recibido-${id}`)!, { target: { value: "0" } })
}
function giveReason(id: string, reason: string) {
  fireEvent.change(dialog().querySelector(`#gdi-diferencia-${id}`)!, { target: { value: reason } })
}

describe("GuideActions — motivo de la diferencia", () => {
  it("dice en qué líneas falta el motivo cuando el botón queda deshabilitado", () => {
    openReceive()
    for (const id of ["pantalon", "camisa", "botin"]) markNotArrived(`gi-${id}`)
    giveReason("gi-pantalon", "No fue enviado desde oficina")

    expect(confirmButton()).toBeDisabled()
    const status = screen.getByRole("status")
    expect(status).toHaveTextContent(
      "Falta el motivo de la diferencia (mínimo 5 caracteres) en Camisa Absolute Zero y Botín V-Flex.",
    )
    expect(confirmButton()).toHaveAttribute("aria-describedby", status.id)

    giveReason("gi-camisa", "No fue enviado desde oficina")
    giveReason("gi-botin", "No fue enviado desde oficina")
    expect(confirmButton()).toBeEnabled()
    expect(screen.getByRole("status")).toBeEmptyDOMElement()
    expect(confirmButton()).not.toHaveAttribute("aria-describedby")
  })

  it("un motivo demasiado corto se marca en su campo", () => {
    openReceive()
    markNotArrived("gi-botin")
    giveReason("gi-botin", "no")

    expect(screen.getByText("Escribe al menos 5 caracteres.")).toBeInTheDocument()
    expect(dialog().querySelector("#gdi-diferencia-gi-botin")).toHaveAttribute("aria-invalid", "true")
    expect(confirmButton()).toBeDisabled()
  })

  it("una cantidad sobre lo pendiente se marca en su campo y en el resumen", () => {
    openReceive()
    fireEvent.change(dialog().querySelector("#gdi-recibido-gi-botin")!, { target: { value: "3" } })

    expect(screen.getByText("Supera lo pendiente (1 unidad).")).toBeInTheDocument()
    expect(screen.getByRole("status")).toHaveTextContent("Revisa la cantidad recibida de Botín V-Flex.")
    expect(confirmButton()).toBeDisabled()
  })
})
