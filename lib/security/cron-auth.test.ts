import { describe, expect, it } from "vitest"
import { parseCronAllowedSources, verifyCronRequest } from "./cron-auth"

describe("cron request authorization", () => {
  it("parses a comma-separated source allowlist", () => {
    expect(parseCronAllowedSources("10.0.0.4, 10.0.0.5,,")).toEqual(["10.0.0.4", "10.0.0.5"])
  })

  it("requires both the bearer and an allowed source when enforced", () => {
    const headers = { authorization: "Bearer secret", forwardedFor: "10.0.0.4", realIp: null }
    expect(verifyCronRequest(headers, "secret", ["10.0.0.4"], true)).toBe(true)
    expect(verifyCronRequest({ ...headers, forwardedFor: "10.0.0.9" }, "secret", ["10.0.0.4"], true)).toBe(false)
    expect(verifyCronRequest(headers, "other", ["10.0.0.4"], true)).toBe(false)
  })

  it("denies a production-style request when source policy is enabled but no source is present", () => {
    expect(verifyCronRequest({ authorization: "Bearer secret" }, "secret", ["10.0.0.4"], true)).toBe(false)
  })
})
