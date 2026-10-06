// @vitest-environment jsdom
import { act, cleanup, render, screen, within } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  usePathname: () => "/bodega",
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock("./adjust-panel", () => ({
  AdjustPanel: ({ initialProductId }: { initialProductId?: string }) => <div data-testid="adjust">{initialProductId}</div>,
}))
vi.mock("./discard-panel", () => ({ DiscardPanel: () => <div data-testid="discard" /> }))
vi.mock("./physical-inventory-panel", () => ({ PhysicalInventoryPanel: () => <div data-testid="count" /> }))

import { BodegaMovementSheet, BodegaMovementTrigger, type ReceivePending } from "./movement-sheet"
import { requestBodegaMovement } from "./movement-events"

afterEach(cleanup)

const WORKSITES = [{ id: "ws-1", name: "Biodiversa" }, { id: "ws-2", name: "Masisa" }]
const PENDING: ReceivePending = { guidesToConfirm: 5, ordersToReceive: 2 }

function renderSheet(overrides: Partial<React.ComponentProps<typeof BodegaMovementSheet>> = {}) {
  render(
    <>
      <BodegaMovementTrigger />
      <BodegaMovementSheet
        worksites={WORKSITES}
        currentWorksiteId="ws-1"
        canAdjust
        canDeliver
        canReceive
        canViewGuides
        canCreateGuide
        pending={PENDING}
        {...overrides}
      />
    </>,
  )
}

describe("BodegaMovementSheet", () => {
  it("ordena los trabajos del bodeguero y deja el traslado informativo al final", () => {
    renderSheet()
    act(() => { screen.getByRole("button", { name: "Registrar movimiento" }).click() })

    const dialog = within(screen.getByRole("dialog"))
    const rows = [
      ...dialog.getAllByRole("link"),
      ...dialog.getAllByRole("button"),
    ].map((node) => node.textContent ?? "")
    expect(rows.some((text) => text.startsWith("Entregar a trabajador"))).toBe(true)
    expect(dialog.getByText("Recibir guía u OC")).toBeTruthy()
    expect(dialog.getByRole("button", { name: /^Baja o merma/ })).toBeTruthy()
    expect(dialog.getByRole("button", { name: /^Ajuste/ })).toBeTruthy()
    expect(dialog.getByRole("button", { name: /^Conteo físico/ })).toBeTruthy()

    const order = Array.from(screen.getByRole("dialog").querySelectorAll("a, button"))
      .map((node) => node.textContent ?? "")
      .filter((text) => /^(Entregar a trabajador|Baja o merma|Ajuste|Conteo físico|Traslado a faena)/.test(text))
      .map((text) => text.match(/^(Entregar a trabajador|Baja o merma|Ajuste|Conteo físico|Traslado a faena)/)![1])
    expect(order).toEqual(["Entregar a trabajador", "Baja o merma", "Ajuste", "Conteo físico", "Traslado a faena"])
  })

  it("ya no ofrece Devolución a stock", () => {
    renderSheet()
    act(() => { screen.getByRole("button", { name: "Registrar movimiento" }).click() })

    expect(screen.queryByText("Devolución a stock")).toBeNull()
  })

  it("Entregar lleva a la pantalla de entregas con la faena a la vista", () => {
    renderSheet()
    act(() => { screen.getByRole("button", { name: "Registrar movimiento" }).click() })

    const link = screen.getByRole("link", { name: /^Entregar a trabajador/ })
    expect(link.getAttribute("href")).toBe("/entregas?faena=ws-1&nueva=1")
  })

  it("Recibir muestra cuántas guías y OC hay y enlaza a cada lista", () => {
    renderSheet()
    act(() => { screen.getByRole("button", { name: "Registrar movimiento" }).click() })

    const guides = screen.getByRole("link", { name: /guías por confirmar/ })
    expect(guides.textContent).toContain("5")
    expect(guides.getAttribute("href")).toBe("/bodega/guias?estado=dispatched&faena=ws-1")
    const orders = screen.getByRole("link", { name: /OC por recibir/ })
    expect(orders.textContent).toContain("2")
    expect(orders.getAttribute("href")).toBe("/recepcion")
  })

  it("sin permiso de ajustar no ofrece baja, ajuste ni conteo", () => {
    renderSheet({ canAdjust: false })
    act(() => { screen.getByRole("button", { name: "Registrar movimiento" }).click() })

    expect(screen.queryByRole("button", { name: /^Baja o merma/ })).toBeNull()
    expect(screen.queryByRole("button", { name: /^Ajuste/ })).toBeNull()
    expect(screen.queryByRole("button", { name: /^Conteo físico/ })).toBeNull()
  })

  it("un pedido desde una fila abre la hoja directamente en ese modo, con el producto", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      openCount: null, worksiteId: "ws-2", worksiteName: "Masisa",
      products: [{ productId: "p-9", productName: "Guante", productSku: null, unitOfMeasure: "par", quantity: 4, hasMovements: true }],
    }), { status: 200 })))
    renderSheet()

    await act(async () => { requestBodegaMovement({ mode: "adjust", worksiteId: "ws-2", productId: "p-9" }) })

    expect((await screen.findByTestId("adjust")).textContent).toBe("p-9")
    vi.unstubAllGlobals()
  })
})
