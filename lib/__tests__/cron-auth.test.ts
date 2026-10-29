import { describe, expect, it } from "vitest"
import { verifyCronInternalRequest, verifyCronSecret } from "@/lib/security/cron-auth"

describe("verifyCronSecret", () => {
  it("accepts a matching Bearer header", () => {
    expect(verifyCronSecret("Bearer s3cr3t", "s3cr3t")).toBe(true)
  })

  it("rejects a wrong secret", () => {
    expect(verifyCronSecret("Bearer wrong", "s3cr3t")).toBe(false)
  })

  it("rejects a missing header", () => {
    expect(verifyCronSecret(null, "s3cr3t")).toBe(false)
  })

  it("rejects a header of a different length without throwing", () => {
    expect(verifyCronSecret("Bearer s", "s3cr3t")).toBe(false)
  })
})

describe("verifyCronInternalRequest", () => {
  it("requires both distinct secrets for the internal scheduler path", () => {
    expect(verifyCronInternalRequest({
      authorization: "Bearer cron-secret",
      internalSecret: "fleet-secret",
    }, "cron-secret", "fleet-secret")).toBe(true)
    expect(verifyCronInternalRequest({
      authorization: "Bearer cron-secret",
      internalSecret: "cron-secret",
    }, "cron-secret", "cron-secret")).toBe(false)
    expect(verifyCronInternalRequest({
      authorization: "Bearer cron-secret",
      internalSecret: null,
    }, "cron-secret", undefined)).toBe(false)
  })
})
