// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"
import { BodegaAttentionStrip, buildAttentionItems } from "./bodega-attention-strip"
import type { BodegaAttention } from "./attention"

afterEach(cleanup)

const HREFS = {
  guides: "/bodega/guias?estado=dispatched&faena=todas",
  epp: "/entregas",
  stockouts: "/bodega?demanda=1",
  drafts: "/bodega?faena=ws-1&nuevo=conteo",
}

function attention(overrides: Partial<BodegaAttention> = {}): BodegaAttention {
  return {
    guides: { count: 0, oldestSince: null },
    eppToDeliver: 0,
    stockoutsWithDemand: 0,
    countDrafts: [],
    ordersToReceive: 0,
    ...overrides,
  }
}

describe("buildAttentionItems", () => {
  it("oculta lo que está en cero: nunca cuatro ceros", () => {
    expect(buildAttentionItems(attention(), HREFS)).toEqual([])
  })

  it("nunca pasa de cuatro avisos (A1)", () => {
    const items = buildAttentionItems(
      attention({
        guides: { count: 5, oldestSince: "2026-08-31T12:00:00Z" },
        eppToDeliver: 2,
        stockoutsWithDemand: 3,
        countDrafts: [{ worksiteId: "ws-1", worksiteName: "Biodiversa", count: 1 }],
      }),
      HREFS,
    )

    expect(items.map((item) => item.key)).toEqual(["guides", "epp", "stockouts", "drafts"])
  })

  it("las guías por confirmar llevan la antigüedad de la más vieja", () => {
    const since = new Date(Date.now() - 35 * 86_400_000).toISOString()
    const [guides] = buildAttentionItems(attention({ guides: { count: 5, oldestSince: since } }), HREFS)

    expect(guides?.label).toBe("Guías por confirmar")
    expect(guides?.detail).toMatch(/^la más antigua, hace \d+ días$/)
    expect(guides?.href).toBe(HREFS.guides)
  })

  it("no ofrece lo que el usuario no puede abrir", () => {
    const items = buildAttentionItems(
      attention({ guides: { count: 1, oldestSince: null }, eppToDeliver: 4 }),
      HREFS,
      { canViewGuides: false, canDeliver: false },
    )

    expect(items).toEqual([])
  })

  it("el borrador de conteo nombra la faena cuando es una sola", () => {
    const [drafts] = buildAttentionItems(
      attention({ countDrafts: [{ worksiteId: "ws-1", worksiteName: "Biodiversa", count: 1 }] }),
      HREFS,
    )

    expect(drafts?.label).toBe("Conteo en borrador")
    expect(drafts?.detail).toBe("Biodiversa")
    expect(drafts?.href).toContain("nuevo=conteo")
  })
})

describe("BodegaAttentionStrip", () => {
  it("sin nada pendiente muestra una sola línea tranquila", () => {
    render(<BodegaAttentionStrip items={[]} />)

    expect(screen.getByText("Nada pendiente en bodega")).toBeTruthy()
    expect(screen.queryByRole("link")).toBeNull()
  })

  it("cada aviso es un enlace a su subconjunto, con su cantidad", () => {
    render(
      <BodegaAttentionStrip
        items={[{ key: "epp", count: 3, label: "EPP por entregar", href: "/entregas?faena=ws-1" }]}
      />,
    )

    const link = screen.getByRole("link", { name: /EPP por entregar/ })
    expect(link.getAttribute("href")).toBe("/entregas?faena=ws-1")
    expect(link.textContent).toContain("3")
  })
})
