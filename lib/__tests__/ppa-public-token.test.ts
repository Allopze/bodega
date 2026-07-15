import { describe, expect, it } from "vitest"
import { hashPpaPublicToken } from "@/lib/services/ppa-module/public-token"

describe("hashPpaPublicToken", () => {
  it("produces a deterministic SHA-256 digest that does not expose the token", () => {
    const token = "ppa-public-token-123"
    const hash = hashPpaPublicToken(token)

    expect(hash).toHaveLength(64)
    expect(hash).not.toContain(token)
    expect(hash).toBe(hashPpaPublicToken(token))
  })
})
