import { describe, expect, it } from "vitest"
import { isAllowedOnwayAuthUrl, resolveOnwayLaunchOptions, validateOnwayCredentials } from "./onway-client"

describe("validateOnwayCredentials", () => {
  it("normalizes only the username and preserves password whitespace", () => {
    expect(validateOnwayCredentials({ username: "  operator@example.com ", password: " secret " }))
      .toEqual({ username: "operator@example.com", password: " secret " })
  })

  it("fails closed when either credential is missing or oversized", () => {
    expect(() => validateOnwayCredentials({ username: "", password: "secret" })).toThrow("ONWAY_CREDENTIALS_REQUIRED")
    expect(() => validateOnwayCredentials({ username: "user@example.com", password: "" })).toThrow("ONWAY_CREDENTIALS_REQUIRED")
    expect(() => validateOnwayCredentials({ username: "u".repeat(321), password: "secret" })).toThrow("ONWAY_CREDENTIALS_INVALID")
    expect(() => validateOnwayCredentials({ username: "user@example.com", password: "p".repeat(321) })).toThrow("ONWAY_CREDENTIALS_INVALID")
  })
})

describe("resolveOnwayLaunchOptions", () => {
  it("uses the runtime Chromium path when the container provides one", () => {
    expect(resolveOnwayLaunchOptions("/usr/bin/chromium-browser"))
      .toEqual({ headless: true, executablePath: "/usr/bin/chromium-browser" })
  })

  it("lets Playwright resolve its bundled browser locally", () => {
    expect(resolveOnwayLaunchOptions(undefined)).toEqual({ headless: true })
  })
})

describe("isAllowedOnwayAuthUrl", () => {
  it("allows only the exact Auth0 tenant before credentials are filled", () => {
    expect(isAllowedOnwayAuthUrl("https://lw-fleet-entel-cl.us.auth0.com/u/login")).toBe(true)
    expect(isAllowedOnwayAuthUrl("https://lw-fleet-entel-cl.us.auth0.com.evil.example/u/login")).toBe(false)
    expect(isAllowedOnwayAuthUrl("https://evil.example/?next=lw-fleet-entel-cl.us.auth0.com")).toBe(false)
    expect(isAllowedOnwayAuthUrl("not-a-url")).toBe(false)
  })
})
