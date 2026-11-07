// @vitest-environment jsdom
/**
 * Repuestos vinculados al equipo (2026-11-07): en el selector de ítems de
 * «Nueva OC», Compras ve para qué equipo y OT es cada línea y de dónde salió el
 * precio que está prefijado, sin abrir la solicitud.
 */
import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { OcFormItems } from "./oc-form-items"
import { priceHint, suggestedPrice } from "./oc-form.helpers"
import type { PendingItemOption } from "./oc-form.types"

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

function renderItems(items: PendingItemOption[], selected: string[] = []) {
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
