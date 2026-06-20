import { describe, expect, it } from "vitest"
import { generateCode, nanoid } from "@/lib/id"

describe("generateCode", () => {
  it("generates a code with prefix, year, and zero-padded sequence", () => {
    expect(generateCode("SOL", 42, 2026)).toBe("SOL-2026-0042")
  })

  it("does not truncate sequences longer than four digits", () => {
    expect(generateCode("OC", 12034, 2026)).toBe("OC-2026-12034")
  })
})

describe("nanoid", () => {
  it("generates a string with the default length", () => {
    expect(nanoid()).toHaveLength(21)
  })

  it("generates a string with a custom length", () => {
    expect(nanoid(8)).toHaveLength(8)
  })
})
