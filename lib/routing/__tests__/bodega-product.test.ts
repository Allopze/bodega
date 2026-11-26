import { describe, expect, it } from "vitest"
import { ALL_WORKSITES } from "@/app/(app)/bodega/faena-scope"
import { bodegaProductHref } from "@/lib/routing/bodega-product"

describe("bodegaProductHref", () => {
  it("lleva al kárdex del producto en la faena pedida", () => {
    expect(bodegaProductHref("prod-1", "ws-1")).toBe("/bodega?vista=kardex&producto=prod-1&faena=ws-1")
  })

  it("sin faena pide todas, con el mismo valor que entiende Bodega", () => {
    expect(bodegaProductHref("prod-1")).toBe(`/bodega?vista=kardex&producto=prod-1&faena=${ALL_WORKSITES}`)
    expect(bodegaProductHref("prod-1", null)).toBe("/bodega?vista=kardex&producto=prod-1&faena=todas")
  })

  it("escapa los ids para que no puedan agregar parámetros", () => {
    expect(bodegaProductHref("a&b=1", "x y")).toBe("/bodega?vista=kardex&producto=a%26b%3D1&faena=x%20y")
  })
})
