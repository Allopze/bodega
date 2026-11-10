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
import type { LinkedSparePart, PendingItemOption, WorksiteOption } from "./oc-form.types"

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

describe("useOcForm — catalogar un repuesto al armar la OC", () => {
  const SUPPLIER = { id: "sup-1", name: "Repuestos del Sur", paymentTerms: null }
  const PART: LinkedSparePart = {
    id: "rpt-1", sku: "RPT-001", name: "Filtro de aire", partNumber: "AF-100", partBrand: null,
    unitOfMeasure: "unidad", prices: { "sup-1": 21_000 },
  }
  const freeTextLine = () => makeItem({
    id: "i1", productId: null, productSku: null, productName: "Filtro aire", productNameFree: "Filtro aire",
    requestType: "repuestos", supplierPrices: {},
  })

  function sentItems(itemsJson: string) {
    return JSON.parse(itemsJson) as Array<{ requestItemId: string; productId: string | null; unitPrice: number | null }>
  }

  it("sin vínculo la línea viaja en texto libre y a precio cero", () => {
    const { result } = renderHook(() =>
      useOcForm({ suppliers: [SUPPLIER], worksites: [WORKSITE], pendingItems: [freeTextLine()], initialWorksiteId: "ws-1" }),
    )
    act(() => result.current.toggleItem("i1"))
    expect(sentItems(result.current.itemsJson)[0]).toMatchObject({ requestItemId: "i1", productId: null, unitPrice: 0 })
  })

  it("vincular manda el productId del repuesto y sugiere el precio del catálogo del proveedor elegido", () => {
    const { result } = renderHook(() =>
      useOcForm({ suppliers: [SUPPLIER], worksites: [WORKSITE], pendingItems: [freeTextLine()], initialWorksiteId: "ws-1" }),
    )
    act(() => result.current.setSupplierId("sup-1"))
    act(() => result.current.toggleItem("i1"))
    expect(sentItems(result.current.itemsJson)[0]!.unitPrice).toBe(0)

    act(() => result.current.linkSparePart("i1", PART))

    expect(result.current.linkedParts).toEqual({ i1: PART })
    expect(result.current.includedItems[0]).toMatchObject({ productId: "rpt-1", productSku: "RPT-001", isSparePart: true })
    expect(sentItems(result.current.itemsJson)[0]).toMatchObject({ requestItemId: "i1", productId: "rpt-1", unitPrice: 21_000 })
  })

  it("al cambiar de proveedor después de vincular se aplica el precio de ese proveedor", () => {
    const part = { ...PART, prices: { "sup-1": 21_000, "sup-2": 19_500 } }
    const suppliers = [SUPPLIER, { id: "sup-2", name: "Frenos Bío Bío", paymentTerms: null }]
    const { result } = renderHook(() =>
      useOcForm({ suppliers, worksites: [WORKSITE], pendingItems: [freeTextLine()], initialWorksiteId: "ws-1" }),
    )
    act(() => result.current.toggleItem("i1"))
    act(() => result.current.linkSparePart("i1", part))
    act(() => result.current.handleSupplierChange("sup-2"))
    expect(sentItems(result.current.itemsJson)[0]!.unitPrice).toBe(19_500)
  })

  it("un precio escrito a mano no lo pisa el vínculo", () => {
    const { result } = renderHook(() =>
      useOcForm({ suppliers: [SUPPLIER], worksites: [WORKSITE], pendingItems: [freeTextLine()], initialWorksiteId: "ws-1" }),
    )
    act(() => result.current.setSupplierId("sup-1"))
    act(() => result.current.toggleItem("i1"))
    act(() => result.current.setItemPrice("i1", "25000"))
    act(() => result.current.linkSparePart("i1", PART))
    expect(sentItems(result.current.itemsJson)[0]!.unitPrice).toBe(25_000)
  })

  it("quitar el vínculo devuelve la línea a texto libre", () => {
    const { result } = renderHook(() =>
      useOcForm({ suppliers: [SUPPLIER], worksites: [WORKSITE], pendingItems: [freeTextLine()], initialWorksiteId: "ws-1" }),
    )
    act(() => result.current.toggleItem("i1"))
    act(() => result.current.linkSparePart("i1", PART))
    act(() => result.current.unlinkSparePart("i1"))
    expect(result.current.linkedParts).toEqual({ i1: null })
    expect(sentItems(result.current.itemsJson)[0]!.productId).toBeNull()
    expect(result.current.includedItems[0]!.isSparePart).toBeFalsy()
  })

  it("una línea que el servidor trae ya vinculada (recarga) viaja con su repuesto y, al desvincularla, en texto libre", () => {
    // FF-6: el vínculo guardado en el ítem sobrevive a la recarga, sin el estado local.
    const fromServer = makeItem({
      id: "i1", productId: "rpt-1", productSku: "RPT-001", productName: "Filtro de aire", productNameFree: "Filtro aire",
      requestType: "repuestos", isSparePart: true, partNumber: "AF-100", linkedFromSheet: true, supplierPrices: { "sup-1": 21_000 },
    })
    const { result } = renderHook(() =>
      useOcForm({ suppliers: [SUPPLIER], worksites: [WORKSITE], pendingItems: [fromServer], initialWorksiteId: "ws-1" }),
    )
    act(() => result.current.toggleItem("i1"))
    expect(sentItems(result.current.itemsJson)[0]).toMatchObject({ requestItemId: "i1", productId: "rpt-1" })

    act(() => result.current.unlinkSparePart("i1"))
    expect(sentItems(result.current.itemsJson)[0]).toMatchObject({ requestItemId: "i1", productId: null })
    expect(result.current.includedItems[0]).toMatchObject({ productName: "Filtro aire", linkedFromSheet: false })
  })

  it("el vínculo de una línea no toca a las demás", () => {
    const other = makeItem({ id: "i2", productId: "prod-epp", requestType: "epp" })
    const { result } = renderHook(() =>
      useOcForm({ suppliers: [SUPPLIER], worksites: [WORKSITE], pendingItems: [freeTextLine(), other], initialWorksiteId: "ws-1" }),
    )
    act(() => result.current.toggleItem("i1"))
    act(() => result.current.toggleItem("i2"))
    act(() => result.current.linkSparePart("i1", PART))
    expect(sentItems(result.current.itemsJson).map((i) => [i.requestItemId, i.productId])).toEqual([["i1", "rpt-1"], ["i2", "prod-epp"]])
  })
})
