import { describe, expect, it } from "vitest"
import { allWorksitesLabel } from "./worksite-label"

describe("allWorksitesLabel", () => {
  it("el alcance global lee «Todas las faenas»", () => {
    expect(allWorksitesLabel({ mode: "all" })).toBe("Todas las faenas")
    expect(allWorksitesLabel(true)).toBe("Todas las faenas")
  })

  it("un alcance limitado lee «Todas tus faenas»", () => {
    expect(allWorksitesLabel({ mode: "some" })).toBe("Todas tus faenas")
    expect(allWorksitesLabel(false)).toBe("Todas tus faenas")
  })

  it("sin faenas visibles no sugiere la empresa entera", () => {
    expect(allWorksitesLabel({ mode: "none" })).toBe("Todas tus faenas")
  })
})
