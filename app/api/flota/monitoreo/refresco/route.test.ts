import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  requirePermission: vi.fn(),
  isRouteOperational: vi.fn(),
  refreshOnwayLive: vi.fn(),
}))

vi.mock("@/lib/auth/can", () => ({ requirePermission: (...args: unknown[]) => Reflect.apply(mocks.requirePermission, null, args) }))
vi.mock("@/lib/services/module-toggles", () => ({ isRouteOperational: (...args: unknown[]) => Reflect.apply(mocks.isRouteOperational, null, args) }))
vi.mock("@/lib/integrations/onway/onway-live", () => ({ refreshOnwayLive: (...args: unknown[]) => Reflect.apply(mocks.refreshOnwayLive, null, args) }))

const { POST } = await import("./route")

describe("POST /api/flota/monitoreo/refresco", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.requirePermission.mockResolvedValue({ user: { id: "user-1" } })
    mocks.isRouteOperational.mockResolvedValue(true)
    mocks.refreshOnwayLive.mockResolvedValue({ outcome: "synced", observedAt: "2026-11-09T12:03:00.000Z" })
  })

  it("exige el mismo permiso que la página", async () => {
    mocks.requirePermission.mockRejectedValue(new Error("forbidden"))
    const response = await POST()
    expect(response.status).toBe(403)
    expect(mocks.requirePermission).toHaveBeenCalledWith("flota:view")
    expect(mocks.refreshOnwayLive).not.toHaveBeenCalled()
  })

  it("con el módulo apagado no consulta OnWay", async () => {
    mocks.isRouteOperational.mockResolvedValue(false)
    const response = await POST()
    expect(await response.json()).toEqual({ outcome: "disabled", reason: "module" })
    expect(mocks.refreshOnwayLive).not.toHaveBeenCalled()
  })

  it("devuelve el desenlace del refresco, a nombre de quien mira la página y sin caché", async () => {
    const response = await POST()
    expect(response.status).toBe(200)
    expect(response.headers.get("cache-control")).toBe("no-store")
    expect(await response.json()).toEqual({ outcome: "synced", observedAt: "2026-11-09T12:03:00.000Z" })
    expect(mocks.refreshOnwayLive).toHaveBeenCalledWith({ actorUserId: "user-1" })
  })
})
