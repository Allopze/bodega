import { describe, expect, it } from "vitest"
import { withFuelContext } from "@/lib/combustibles/routes"
import { myLoadsHref } from "./links"

describe("enlaces del Panel a mis cargas", () => {
  const link = (href: string) => withFuelContext(href, { periodo: "2026-S44" })

  it("lleva el período y se acota a las cargas de la persona", () => {
    expect(myLoadsHref(link)).toBe("/combustibles/cargas?mias=si&periodo=2026-S44")
  })

  it("agrega el estado por su slug", () => {
    expect(myLoadsHref(link, "por-validar")).toBe("/combustibles/cargas?mias=si&estado=por-validar&periodo=2026-S44")
    expect(myLoadsHref(link, "con-observacion")).toBe("/combustibles/cargas?mias=si&estado=con-observacion&periodo=2026-S44")
  })
})
