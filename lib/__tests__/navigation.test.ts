import { describe, expect, it } from "vitest"
import { safeInternalPath } from "@/lib/navigation"

describe("safeInternalPath", () => {
  it("uses the fallback when the value is missing", () => {
    expect(safeInternalPath(null)).toBe("/dashboard")
    expect(safeInternalPath(undefined)).toBe("/dashboard")
    expect(safeInternalPath("")).toBe("/dashboard")
  })

  it("keeps valid internal paths", () => {
    expect(safeInternalPath("/solicitudes")).toBe("/solicitudes")
    expect(safeInternalPath("/compras/123?tab=items")).toBe("/compras/123?tab=items")
  })

  it("rejects absolute and protocol-relative URLs", () => {
    expect(safeInternalPath("https://example.com/login")).toBe("/dashboard")
    expect(safeInternalPath("//example.com/login")).toBe("/dashboard")
  })

  it("rejects encoded unsafe values", () => {
    expect(safeInternalPath("%2F%2Fevil.test")).toBe("/dashboard")
    expect(safeInternalPath("%2Fdashboard%0D%0ASet-Cookie%3Afoo")).toBe("/dashboard")
  })
})
