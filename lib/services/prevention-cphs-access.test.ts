import { describe, expect, it } from "vitest"
import { CPHS_NOT_FOUND, nullIfCphsNotFound } from "./prevention-cphs-access"

describe("nullIfCphsNotFound (M-10)", () => {
  it("un registro inexistente o fuera de alcance es null (404)", () => {
    expect(nullIfCphsNotFound(new Error(CPHS_NOT_FOUND))).toBeNull()
  })

  it("cualquier otro error se relanza en vez de fingir un 404", () => {
    const failure = new Error("connection terminated unexpectedly")
    expect(() => nullIfCphsNotFound(failure)).toThrow(failure)
  })
})
