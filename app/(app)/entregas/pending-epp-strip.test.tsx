// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"
import { PendingEppStrip, type PendingEppRow } from "./pending-epp-strip"

afterEach(cleanup)

const item: PendingEppRow = {
  requestItemId: "item-1",
  requestCode: "SOL-2026-0042",
  worksiteId: "ws-1",
  worksiteName: "Faena Santa Fe",
  productId: "prod-1",
  productName: "Casco dieléctrico",
  productSku: "EPP-001",
  quantity: 10,
  deliveredQuantity: 4,
  receivedAtFaena: 10,
  remainingQuantity: 6,
  stockQuantity: 8,
  unitOfMeasure: "unidad",
}

describe("PendingEppStrip", () => {
  it("no pinta nada cuando no hay EPP por entregar", () => {
    const { container } = render(<PendingEppStrip items={[]} canCreate />)
    expect(container).toBeEmptyDOMElement()
  })

  it("lista producto, faena, saldo y solicitud, y enlaza Entregar al formulario precargado", () => {
    render(<PendingEppStrip items={[item]} canCreate />)

    expect(screen.getByText("Casco dieléctrico")).toBeDefined()
    expect(screen.getByText(/Faena Santa Fe/)).toBeDefined()
    expect(screen.getByText("SOL-2026-0042")).toBeDefined()
    expect(screen.getByText((_, el) => el?.tagName === "P" && /^\s*6\b/.test(el.textContent ?? "") && /por entregar/.test(el.textContent ?? ""))).toBeDefined()

    const link = screen.getByRole("link", { name: /Entregar Casco dieléctrico/ })
    const url = new URL(link.getAttribute("href")!, "http://localhost")
    expect(url.pathname).toBe("/entregas")
    expect(url.searchParams.get("faena")).toBe("ws-1")
    expect(url.searchParams.get("item")).toBe("item-1")
    expect(url.searchParams.get("nueva")).toBe("1")
  })

  it("sin permiso de crear no ofrece Entregar", () => {
    render(<PendingEppStrip items={[item]} canCreate={false} />)
    expect(screen.queryByRole("link", { name: /Entregar/ })).toBeNull()
  })

  it("pliega las filas sobre el límite visible", () => {
    const many = Array.from({ length: 8 }, (_, index) => ({ ...item, requestItemId: `item-${index}` }))
    render(<PendingEppStrip items={many} canCreate />)
    expect(screen.getByText("Ver 3 más")).toBeDefined()
  })
})
