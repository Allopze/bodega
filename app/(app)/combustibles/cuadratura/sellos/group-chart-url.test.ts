import { describe, expect, it } from "vitest"
import { buildTaeGroupDrilldownHref } from "./group-chart-url"

describe("buildTaeGroupDrilldownHref", () => {
  it("adds the selected group while preserving the period and how-it-arrived filters of Cargas", () => {
    expect(buildTaeGroupDrilldownHref(
      "/combustibles/cargas?como=qr%2Capp%2Chistorico&desde=2026-07-01&hasta=2026-07-18",
      "Supervisor & Turno A",
    )).toBe("/combustibles/cargas?como=qr%2Capp%2Chistorico&desde=2026-07-01&hasta=2026-07-18&q=Supervisor+%26+Turno+A")
  })

  it("starts the query string when the base link has none", () => {
    expect(buildTaeGroupDrilldownHref("/combustibles/cargas", "Punto 1")).toBe("/combustibles/cargas?q=Punto+1")
  })
})
