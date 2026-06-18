/**
 * Audit A-15: tests for the shared Chilean RUT helpers.
 */
import { describe, expect, it } from "vitest"
import { cleanRut, computeRutDv, validateRut } from "@/lib/rut"

describe("cleanRut", () => {
  it("strips dots, trims and upper-cases", () => {
    expect(cleanRut(" 12.345.678-k ")).toBe("12345678-K")
  })
})

describe("computeRutDv", () => {
  it("computes a numeric check digit", () => {
    // 11.111.111 → 1
    expect(computeRutDv("11111111")).toBe("1")
  })
  it("returns K when the modulo yields 10", () => {
    // 10.000.013 has check digit K
    expect(computeRutDv("10000013")).toBe("K")
  })
})

describe("validateRut", () => {
  it("accepts a valid RUT with dots and lower-case k dv", () => {
    expect(validateRut("10.000.013-k")).toBe(true)
  })
  it("accepts a valid RUT in canonical form", () => {
    expect(validateRut("11111111-1")).toBe(true)
    expect(validateRut("12345678-5")).toBe(true)
  })
  it("rejects a wrong check digit", () => {
    expect(validateRut("11111111-2")).toBe(false)
  })
  it("rejects malformed input", () => {
    expect(validateRut("not-a-rut")).toBe(false)
    expect(validateRut("123-4")).toBe(false)
    expect(validateRut("")).toBe(false)
  })
})
