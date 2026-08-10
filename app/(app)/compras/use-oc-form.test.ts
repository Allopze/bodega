// @vitest-environment jsdom
/**
 * Covers the delivery-mode grouping added to the pending-items picker: the OC
 * creation guard rejects mixing via_oficina and directo_faena items in one
 * order, so when a faena has both, the hook must expose a single active mode
 * at a time instead of surfacing every item together.
 */
import { describe, it, expect, vi } from "vitest"
import { renderHook, act } from "@testing-library/react"
import { useOcForm } from "./use-oc-form"
import type { PendingItemOption, WorksiteOption } from "./oc-form.types"

vi.mock("./actions", () => ({ createOrderAction: vi.fn() }))
vi.mock("@/lib/toast", () => ({ toast: { error: vi.fn(), success: vi.fn() } }))

const WORKSITE: WorksiteOption = { id: "ws-1", name: "Faena Test" }

function makeItem(overrides: Partial<PendingItemOption>): PendingItemOption {
  return {
    id: "item-1",
    requestId: "req-1",
    requestCode: "SOL-0001",
    worksiteId: "ws-1",
    worksiteName: "Faena Test",
    productName: "Casco",
    productSku: "SKU-1",
    productId: "prod-1",
    productNameFree: null,
    quantity: 1,
    unitOfMeasure: "unidad",
    urgency: "normal",
    notes: null,
    supplierPrices: {},
    deliveryMode: "via_oficina",
    isService: false,
    ...overrides,
  }
}

describe("useOcForm — delivery-mode grouping", () => {
  it("does not force a mode filter when the faena has only one delivery mode", () => {
    const items = [
      makeItem({ id: "i1", deliveryMode: "via_oficina" }),
      makeItem({ id: "i2", deliveryMode: "via_oficina" }),
    ]
    const { result } = renderHook(() =>
      useOcForm({ suppliers: [], worksites: [WORKSITE], pendingItems: items, initialWorksiteId: "ws-1" }),
    )

    expect(result.current.worksiteModes).toEqual(["via_oficina"])
    expect(result.current.modeFilter).toBeNull()
    expect(result.current.filteredItems.map((i) => i.id)).toEqual(["i1", "i2"])
  })

  it("defaults to the first mode present and filters items to it when the faena has mixed modes", () => {
    const items = [
      makeItem({ id: "i1", deliveryMode: "via_oficina" }),
      makeItem({ id: "i2", deliveryMode: "directo_faena" }),
    ]
    const { result } = renderHook(() =>
      useOcForm({ suppliers: [], worksites: [WORKSITE], pendingItems: items, initialWorksiteId: "ws-1" }),
    )

    expect(result.current.worksiteModes).toEqual(["via_oficina", "directo_faena"])
    expect(result.current.modeFilter).toBe("via_oficina")
    expect(result.current.filteredItems.map((i) => i.id)).toEqual(["i1"])
  })

  it("switching the mode tab shows the other mode's items and clears the selection", () => {
    const items = [
      makeItem({ id: "i1", deliveryMode: "via_oficina" }),
      makeItem({ id: "i2", deliveryMode: "directo_faena" }),
    ]
    const { result } = renderHook(() =>
      useOcForm({ suppliers: [], worksites: [WORKSITE], pendingItems: items, initialWorksiteId: "ws-1" }),
    )

    act(() => result.current.toggleItem("i1"))
    expect(result.current.selectedItems.has("i1")).toBe(true)

    act(() => result.current.handleModeChange("directo_faena"))

    expect(result.current.modeFilter).toBe("directo_faena")
    expect(result.current.filteredItems.map((i) => i.id)).toEqual(["i2"])
    expect(result.current.selectedItems.size).toBe(0)
  })
})

describe("useOcForm — partial purchase quantity", () => {
  it("defaults the included item's quantity to the full approved quantity", () => {
    const items = [makeItem({ id: "i1", quantity: 10 })]
    const { result } = renderHook(() =>
      useOcForm({ suppliers: [], worksites: [WORKSITE], pendingItems: items, initialWorksiteId: "ws-1" }),
    )
    act(() => result.current.toggleItem("i1"))
    expect(result.current.includedItems[0]!.quantity).toBe(10)
  })

  it("overrides the included item's quantity when the user buys less than approved", () => {
    const items = [makeItem({ id: "i1", quantity: 10 })]
    const { result } = renderHook(() =>
      useOcForm({ suppliers: [], worksites: [WORKSITE], pendingItems: items, initialWorksiteId: "ws-1" }),
    )
    act(() => result.current.toggleItem("i1"))
    act(() => result.current.setItemQuantity(items[0]!, "4"))
    expect(result.current.includedItems[0]!.quantity).toBe(4)
  })

  it("clamps the quantity to the approved amount", () => {
    const items = [makeItem({ id: "i1", quantity: 10 })]
    const { result } = renderHook(() =>
      useOcForm({ suppliers: [], worksites: [WORKSITE], pendingItems: items, initialWorksiteId: "ws-1" }),
    )
    act(() => result.current.toggleItem("i1"))
    act(() => result.current.setItemQuantity(items[0]!, "999"))
    expect(result.current.includedItems[0]!.quantity).toBe(10)
  })
})
