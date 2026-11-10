// @vitest-environment jsdom
/**
 * Repuestos vinculados al equipo (2026-11-07): en el selector de ítems de
 * «Nueva OC», Compras ve para qué equipo y OT es cada línea y de dónde salió el
 * precio que está prefijado, sin abrir la solicitud.
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { OcFormItems } from "./oc-form-items"
import { priceHint, suggestedPrice } from "./oc-form.helpers"
import type { PendingItemOption } from "./oc-form.types"

// La hoja «Catalogar» llama acciones de servidor: aquí sólo importa que se abra.
const unlinkAction = vi.fn()
vi.mock("./actions", () => ({
  searchSparePartsForOcAction: vi.fn(async () => ({ ok: true, parts: [], total: 0, suggestion: null })),
  linkSparePartForOcAction: vi.fn(),
  createSparePartForOcAction: vi.fn(),
  unlinkSparePartForOcAction: (...args: unknown[]) => unlinkAction(...args),
}))
beforeEach(() => unlinkAction.mockReset())
afterEach(cleanup)

function makeItem(overrides: Partial<PendingItemOption> = {}): PendingItemOption {
  return {
    id: "item-1", requestId: "req-1", requestCode: "REP-0001",
    worksiteId: "ws-1", worksiteName: "Faena", productName: "Manguera hidráulica",
    productSku: null, productId: null, productNameFree: "Manguera hidráulica",
    quantity: 2, unitOfMeasure: "unidad", urgency: "normal", notes: null,
    supplierPrices: {}, deliveryMode: "directo_faena", isService: false,
    ...overrides,
  }
}

function renderItems(
  items: PendingItemOption[],
  selected: string[] = [],
  catalog: Partial<React.ComponentProps<typeof OcFormItems>> = {},
) {
  const byId = new Map(items.map((item) => [item.id, item]))
  return render(
    <OcFormItems
      filteredItems={items}
      filteredByWorksite={items}
      selectedItems={new Set(selected)}
      suppliers={[]}
      worksiteId="ws-1"
      search=""
      worksiteModes={["directo_faena"]}
      modeFilter={null}
      onModeChange={() => {}}
      onToggle={() => {}}
      onToggleAll={() => {}}
      onSearchChange={() => {}}
      itemPrice={(item) => suggestedPrice(byId.get(item.id)!, "") ?? 0}
      itemDiscount={() => 0}
      setItemPrice={() => {}}
      setItemDiscount={() => {}}
      itemQuantity={(item) => item.quantity}
      setItemQuantity={() => {}}
      resolveItemSupplierId={() => ""}
      setItemSupplier={() => {}}
      {...catalog}
    />,
  )
}

describe("OcFormItems — equipo, OT y precio estimado", () => {
  it("muestra el equipo y la OT bajo el nombre del ítem", () => {
    renderItems([makeItem({ vehicleLabel: "KA-63 · ABCD-12", workOrderFolio: "M-0042" })])
    expect(screen.getByText("Equipo: KA-63 · ABCD-12 · OT M-0042")).toBeTruthy()
  })

  it("con equipo pero sin OT no nombra una OT", () => {
    renderItems([makeItem({ vehicleLabel: "ABCD-12" })])
    expect(screen.getByText("Equipo: ABCD-12")).toBeTruthy()
  })

  it("sin equipo no dibuja la línea", () => {
    renderItems([makeItem()])
    expect(screen.queryByText(/Equipo:/)).toBeNull()
  })

  it("al incluir el ítem, el precio estimado se prefija y el rótulo dice «estimado», no «catálogo»", () => {
    const item = makeItem({ estimatedUnitPrice: 20_000 })
    renderItems([item], [item.id])

    expect((screen.getByLabelText("Precio unit.") as HTMLInputElement).value).toBe("20000")
    expect(screen.getByText("estimado")).toBeTruthy()
    expect(screen.queryByText("catálogo")).toBeNull()
    expect(priceHint(item, "")).toContain("Precio estimado por el solicitante")
  })
})

describe("OcFormItems — Catalogar", () => {
  const repuesto = (overrides: Partial<PendingItemOption> = {}) =>
    makeItem({ requestType: "repuestos", requestedPartNumber: "AF-100", ...overrides })
  const onLinkPart = () => {}

  it("una línea de repuesto en texto libre ofrece «Catalogar»", () => {
    renderItems([repuesto()], [], { onLinkPart, onUnlinkPart: onLinkPart })
    expect(screen.getByRole("button", { name: "Catalogar" })).toBeTruthy()
  })

  it("no lo ofrece en otros tipos de solicitud, en servicios ni donde la página no lo habilita", () => {
    const { unmount } = renderItems([makeItem({ requestType: "epp" }), repuesto({ id: "s", isService: true })], [], { onLinkPart })
    expect(screen.queryByRole("button", { name: "Catalogar" })).toBeNull()
    unmount()
    renderItems([repuesto()])
    expect(screen.queryByRole("button", { name: "Catalogar" })).toBeNull()
  })

  it("una línea vinculada desde la hoja muestra el repuesto y deja desvincular; no vuelve a ofrecer «Catalogar»", async () => {
    const onUnlink = vi.fn()
    unlinkAction.mockResolvedValue({ ok: true })
    const linked = repuesto({ productId: "rpt-1", productSku: "RPT-001", isSparePart: true, partNumber: "AF-100", linkedFromSheet: true })
    renderItems([linked], [], { onLinkPart, onUnlinkPart: onUnlink })
    expect(screen.getByText("Repuesto de catálogo")).toBeTruthy()
    expect(screen.getByText("N° AF-100")).toBeTruthy()
    expect(screen.getByText("RPT-001")).toBeTruthy()
    expect(screen.queryByRole("button", { name: "Catalogar" })).toBeNull()
    fireEvent.click(screen.getByRole("button", { name: /Desvincular/ }))
    // Primero se quita en el servidor; recién entonces la línea vuelve a texto libre.
    await waitFor(() => expect(onUnlink).toHaveBeenCalledWith(linked.id))
    expect(unlinkAction).toHaveBeenCalledWith({ requestItemId: linked.id })
  })

  it("si el servidor rechaza desvincular (la línea ya está en una OC), dice el motivo y la línea no cambia", async () => {
    const onUnlink = vi.fn()
    unlinkAction.mockResolvedValue({ ok: false, message: "El ítem ya está en una orden de compra: elimínala o anúlala antes de cambiar el repuesto" })
    const linked = repuesto({ productId: "rpt-1", productSku: "RPT-001", isSparePart: true, partNumber: "AF-100", linkedFromSheet: true })
    renderItems([linked], [], { onLinkPart, onUnlinkPart: onUnlink })
    fireEvent.click(screen.getByRole("button", { name: /Desvincular/ }))
    expect((await screen.findByRole("alert")).textContent).toContain("ya está en una orden de compra")
    expect(onUnlink).not.toHaveBeenCalled()
  })

  it("un repuesto que ya venía catalogado desde la solicitud no ofrece desvincular", () => {
    const fromRequest = repuesto({ productId: "rpt-1", productSku: "RPT-001", isSparePart: true, partNumber: "AF-100" })
    renderItems([fromRequest], [], { onLinkPart, onUnlinkPart: () => {} })
    expect(screen.getByText("Repuesto de catálogo")).toBeTruthy()
    expect(screen.queryByRole("button", { name: /Desvincular/ })).toBeNull()
  })

  it("«Catalogar» abre la hoja con la descripción de la línea", async () => {
    renderItems([repuesto({ productNameFree: "Filtro aire camión", productName: "Filtro aire camión" })], [], { onLinkPart, canCreateSparePart: true })
    fireEvent.click(screen.getByRole("button", { name: "Catalogar" }))
    expect(await screen.findByText("Catalogar repuesto")).toBeTruthy()
    expect(screen.getByText(/«Filtro aire camión»/)).toBeTruthy()
  })
})
