import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

const mocks = vi.hoisted(() => ({
  requirePermission: vi.fn(),
  isDteSyncEnabled: vi.fn(),
  buildDtePortalClientConfig: vi.fn(),
  syncDteDocuments: vi.fn(),
  assertSyncablePeriodo: vi.fn(),
  classifyDteFailure: vi.fn(),
}))

vi.mock("@/lib/auth/can", () => ({
  requirePermission: (...args: unknown[]) => mocks.requirePermission(...args),
}))
vi.mock("@/lib/services/dte-portal/config", () => ({
  isDteSyncEnabled: (...args: unknown[]) => mocks.isDteSyncEnabled(...args),
  buildDtePortalClientConfig: (...args: unknown[]) => mocks.buildDtePortalClientConfig(...args),
}))
vi.mock("@/lib/services/dte-portal/client", () => ({
  DtePortalClient: class DtePortalClient {},
}))
vi.mock("@/lib/services/dte-portal/sync", () => ({
  syncDteDocuments: (...args: unknown[]) => mocks.syncDteDocuments(...args),
  assertSyncablePeriodo: (...args: unknown[]) => mocks.assertSyncablePeriodo(...args),
}))
vi.mock("@/lib/services/dte-portal/failure", () => ({
  classifyDteFailure: (...args: unknown[]) => mocks.classifyDteFailure(...args),
}))

const { POST } = await import("./route")

function request(body: Record<string, unknown> = {}) {
  return new NextRequest("http://localhost/api/dte-portal/sync", {
    method: "POST",
    body: JSON.stringify(body),
  })
}

describe("POST /api/dte-portal/sync", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.requirePermission.mockResolvedValue({ user: { id: "admin-1" } })
    mocks.isDteSyncEnabled.mockResolvedValue(true)
    mocks.classifyDteFailure.mockReturnValue({ code: "DTE_SETTINGS_INVALID", summary: "La configuración segura de DTE requiere revisión." })
  })

  it("returns a redacted failure when the safe config check itself fails", async () => {
    mocks.isDteSyncEnabled.mockRejectedValue(new Error("clave=portal-secret-never-return"))

    const response = await POST(request())
    const body = await response.json()

    expect(response.status).toBe(500)
    expect(body).toEqual({ ok: false, code: "DTE_SETTINGS_INVALID", error: "La configuración segura de DTE requiere revisión." })
    expect(JSON.stringify(body)).not.toContain("portal-secret-never-return")
  })

  // "2026-13" pasaba la regex local y reventaba dentro del servicio: el
  // llamante recibía un 500 "DTE_UNEXPECTED" por un error de entrada suyo.
  it("rechaza con 400 un período que el servicio no puede sincronizar", async () => {
    mocks.assertSyncablePeriodo.mockImplementation(() => {
      throw new Error('Período inválido: "2026-13". Use YYYY-MM con un mes entre 01 y 12.')
    })

    const response = await POST(request({ periodo: "2026-13" }))
    const body = await response.json()

    expect(response.status).toBe(400)
    expect(body.error).toContain("2026-13")
    expect(mocks.syncDteDocuments).not.toHaveBeenCalled()
  })
})
