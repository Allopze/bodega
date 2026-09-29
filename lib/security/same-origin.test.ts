import { describe, expect, it } from "vitest"
import { isCrossOriginMutation } from "./same-origin"

const headers = (values: Record<string, string>) => new Headers(values)

describe("isCrossOriginMutation (M-02)", () => {
  it("no toca los métodos que no mutan", () => {
    expect(isCrossOriginMutation({ method: "GET", headers: headers({ origin: "https://evil.example", "sec-fetch-site": "cross-site" }) })).toBe(false)
  })

  it("rechaza una mutación que el navegador marca como de otro sitio", () => {
    expect(isCrossOriginMutation({ method: "POST", headers: headers({ host: "chome.cl", "sec-fetch-site": "cross-site" }) })).toBe(true)
  })

  it("rechaza un Origin ajeno o nulo", () => {
    expect(isCrossOriginMutation({ method: "POST", headers: headers({ host: "chome.cl", origin: "https://evil.example" }) })).toBe(true)
    expect(isCrossOriginMutation({ method: "DELETE", headers: headers({ host: "chome.cl", origin: "null" }) })).toBe(true)
  })

  it("acepta el mismo host, el reenviado por el proxy inverso o el de AUTH_URL", () => {
    expect(isCrossOriginMutation({ method: "POST", headers: headers({ host: "chome.cl", origin: "https://chome.cl", "sec-fetch-site": "same-origin" }) })).toBe(false)
    expect(isCrossOriginMutation({ method: "POST", headers: headers({ host: "app:3000", "x-forwarded-host": "chome.cl", origin: "https://chome.cl" }) })).toBe(false)
    expect(isCrossOriginMutation({ method: "PATCH", headers: headers({ host: "app:3000", origin: "https://chome.cl" }), configuredOrigin: "https://chome.cl" })).toBe(false)
  })

  it("deja pasar un cliente sin Origin ni Sec-Fetch-Site (scripts de operación)", () => {
    expect(isCrossOriginMutation({ method: "POST", headers: headers({ host: "chome.cl" }) })).toBe(false)
  })
})
