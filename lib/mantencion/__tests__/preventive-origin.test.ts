import { describe, expect, it } from "vitest"
import { isDeclaredPreventive, preventiveOriginLabel, preventiveSupportText } from "../preventive-origin"

describe("origen de la preventiva", () => {
  it("la declarada lleva su rótulo y su respaldo; la firmada, «Firmada» y su folio; sin origen es firmada", () => {
    const declarada = { origin: "declarada" as const, evidence: " OT-9 " }
    expect(isDeclaredPreventive(declarada)).toBe(true)
    expect(preventiveOriginLabel(declarada)).toBe("Declarada, anterior a la plataforma")
    expect(preventiveSupportText(declarada)).toBe("Respaldo: OT-9")
    expect(preventiveOriginLabel({ origin: "firmada", evidence: "MANT-1" })).toBe("Firmada")
    expect(preventiveSupportText({ origin: "firmada", evidence: "MANT-1" })).toBe("Folio MANT-1")
    expect(preventiveOriginLabel({})).toBe("Firmada")
  })
  it("sin preventiva no hay rótulo ni respaldo", () => {
    expect(preventiveOriginLabel(null)).toBe("")
    expect(preventiveSupportText(null)).toBeNull()
    expect(preventiveSupportText({ origin: "declarada", evidence: "  " })).toBeNull()
  })
})
