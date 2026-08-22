import { afterEach, describe, expect, it, vi } from "vitest"

describe("allowedTaeEvidenceHosts / isAllowedTaeEvidenceHost", () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  it("permite el dominio de producción por defecto", async () => {
    const { isAllowedTaeEvidenceHost } = await import("./tae-evidence-hosts")
    expect(isAllowedTaeEvidenceHost(new URL("https://plataforma.portalchome.cl/x"))).toBe(true)
  })

  it("rechaza un host no anticipado", async () => {
    const { isAllowedTaeEvidenceHost } = await import("./tae-evidence-hosts")
    expect(isAllowedTaeEvidenceHost(new URL("https://evil.example/x"))).toBe(false)
  })

  // APP_URL cubre dev/staging con un host distinto del de producción, sin
  // mantener dos listas separadas.
  it("agrega el host de APP_URL a la lista cuando está configurado", async () => {
    vi.stubEnv("APP_URL", "https://staging.portalchome.cl")
    vi.resetModules()
    const { allowedTaeEvidenceHosts, isAllowedTaeEvidenceHost } = await import("./tae-evidence-hosts")
    expect(allowedTaeEvidenceHosts()).toContain("staging.portalchome.cl")
    expect(isAllowedTaeEvidenceHost(new URL("https://staging.portalchome.cl/x"))).toBe(true)
    // El de producción sigue permitido — APP_URL se agrega, no reemplaza.
    expect(isAllowedTaeEvidenceHost(new URL("https://plataforma.portalchome.cl/x"))).toBe(true)
  })

  it("ignora un APP_URL inválido en vez de romper", async () => {
    vi.stubEnv("APP_URL", "no-es-una-url")
    vi.resetModules()
    const { isAllowedTaeEvidenceHost } = await import("./tae-evidence-hosts")
    expect(isAllowedTaeEvidenceHost(new URL("https://plataforma.portalchome.cl/x"))).toBe(true)
  })
})
