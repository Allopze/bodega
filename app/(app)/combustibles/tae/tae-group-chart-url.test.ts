import { describe, expect, it } from "vitest"
import { buildTaeGroupDrilldownHref } from "./tae-group-chart-url"

describe("buildTaeGroupDrilldownHref", () => {
  it("adds the selected group while preserving the TAE period filters", () => {
    expect(buildTaeGroupDrilldownHref(
      "/combustibles/bitacora?desde=2026-07-01&hasta=2026-07-18&fuente=tae_pwa",
      "Supervisor & Turno A",
    )).toBe("/combustibles/bitacora?desde=2026-07-01&hasta=2026-07-18&fuente=tae_pwa&q=Supervisor+%26+Turno+A")
  })
})
