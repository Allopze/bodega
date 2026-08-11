import { describe, expect, it } from "vitest"
import {
  DTE_PORTAL_BASE_URL,
  assertDtePortalBaseUrl,
  resolveDtePortalResourceUrl,
} from "../portal-origin"

describe("DTE portal origin", () => {
  it("only accepts the canonical HTTPS portal base URL", () => {
    expect(assertDtePortalBaseUrl(undefined)).toBe(DTE_PORTAL_BASE_URL)
    expect(assertDtePortalBaseUrl(`${DTE_PORTAL_BASE_URL}/`)).toBe(DTE_PORTAL_BASE_URL)

    for (const value of [
      "http://clientes.dtefacturaenlinea.cl/facturaenlinea",
      "https://evil.example/facturaenlinea",
      "https://clientes.dtefacturaenlinea.cl:443/facturaenlinea",
      "https://user@clientes.dtefacturaenlinea.cl/facturaenlinea",
      `${DTE_PORTAL_BASE_URL}?next=evil`,
      `${DTE_PORTAL_BASE_URL}#fragment`,
      "https://127.0.0.1/facturaenlinea",
    ]) {
      expect(() => assertDtePortalBaseUrl(value)).toThrow("DTE_PORTAL_ORIGIN_INVALID")
    }
  })

  it("resolves only resources below the allowed portal path", () => {
    expect(resolveDtePortalResourceUrl("paneldte.php")).toBe(`${DTE_PORTAL_BASE_URL}/paneldte.php`)
    expect(resolveDtePortalResourceUrl("PanelCorreo/PNC_PanelCorreo.php?x=1")).toBe(
      `${DTE_PORTAL_BASE_URL}/PanelCorreo/PNC_PanelCorreo.php?x=1`,
    )
    expect(resolveDtePortalResourceUrl(`${DTE_PORTAL_BASE_URL}/dtexml.php?post=1`)).toBe(
      `${DTE_PORTAL_BASE_URL}/dtexml.php?post=1`,
    )
  })

  it("rejects SSRF-like resources, traversal and foreign origins", () => {
    for (const value of [
      "https://evil.example/file.xml",
      "//evil.example/file.xml",
      "../private.xml",
      "%2e%2e/private.xml",
      "%252e%252e/private.xml",
      `${DTE_PORTAL_BASE_URL.replace("https://", "https://user:pass@")}/file.xml`,
      "http://clientes.dtefacturaenlinea.cl/facturaenlinea/file.xml",
      "https://clientes.dtefacturaenlinea.cl/other/file.xml",
    ]) {
      expect(() => resolveDtePortalResourceUrl(value)).toThrow("DTE_PORTAL_RESOURCE_INVALID")
    }
  })
})
