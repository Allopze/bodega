import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  requirePermission: vi.fn(),
  isRouteOperational: vi.fn(),
  refreshOnwayLive: vi.fn(),
  refreshWialonLive: vi.fn(),
}))

vi.mock("@/lib/auth/can", () => ({ requirePermission: (...args: unknown[]) => Reflect.apply(mocks.requirePermission, null, args) }))
vi.mock("@/lib/services/module-toggles", () => ({ isRouteOperational: (...args: unknown[]) => Reflect.apply(mocks.isRouteOperational, null, args) }))
vi.mock("@/lib/integrations/onway/onway-live", () => ({ refreshOnwayLive: (...args: unknown[]) => Reflect.apply(mocks.refreshOnwayLive, null, args) }))
vi.mock("@/lib/integrations/wialon/wialon-live", () => ({ refreshWialonLive: (...args: unknown[]) => Reflect.apply(mocks.refreshWialonLive, null, args) }))

const { POST } = await import("./route")
const { ONWAY_RESPONSE_DEADLINE_MS } = await import("@/lib/integrations/onway/onway-live-contract")

describe("POST /api/flota/monitoreo/refresco", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.requirePermission.mockResolvedValue({ user: { id: "user-1" } })
    mocks.isRouteOperational.mockResolvedValue(true)
    mocks.refreshOnwayLive.mockResolvedValue({ outcome: "synced", observedAt: "2026-11-09T12:03:00.000Z" })
    mocks.refreshWialonLive.mockResolvedValue({ outcome: "synced", observedAt: "2026-11-09T12:03:01.000Z" })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("exige el mismo permiso que la página", async () => {
    mocks.requirePermission.mockRejectedValue(new Error("forbidden"))
    const response = await POST()
    expect(response.status).toBe(403)
    expect(mocks.requirePermission).toHaveBeenCalledWith("flota:view")
    expect(mocks.refreshOnwayLive).not.toHaveBeenCalled()
    expect(mocks.refreshWialonLive).not.toHaveBeenCalled()
  })

  it("con el módulo apagado no consulta a ningún proveedor", async () => {
    mocks.isRouteOperational.mockResolvedValue(false)
    const response = await POST()
    expect(await response.json()).toEqual({
      onway: { outcome: "disabled", reason: "module" },
      wialon: { outcome: "disabled", reason: "module" },
    })
    expect(mocks.refreshOnwayLive).not.toHaveBeenCalled()
    expect(mocks.refreshWialonLive).not.toHaveBeenCalled()
  })

  it("devuelve el desenlace de cada proveedor, a nombre de quien mira la página y sin caché", async () => {
    mocks.refreshOnwayLive.mockResolvedValue({ outcome: "skipped", reason: "recent", observedAt: "2026-11-09T12:02:40.000Z" })
    const response = await POST()
    expect(response.status).toBe(200)
    expect(response.headers.get("cache-control")).toBe("no-store")
    expect(await response.json()).toEqual({
      onway: { outcome: "skipped", reason: "recent", observedAt: "2026-11-09T12:02:40.000Z" },
      wialon: { outcome: "synced", observedAt: "2026-11-09T12:03:01.000Z" },
    })
    expect(mocks.refreshOnwayLive).toHaveBeenCalledWith({ actorUserId: "user-1" })
    expect(mocks.refreshWialonLive).toHaveBeenCalledTimes(1)
  })

  it("un proveedor que lanza no tumba al otro", async () => {
    mocks.refreshOnwayLive.mockRejectedValue(new Error("boom"))
    const response = await POST()
    expect(await response.json()).toEqual({
      onway: { outcome: "failed", code: "ONWAY_LIVE_FAILED" },
      wialon: { outcome: "synced", observedAt: "2026-11-09T12:03:01.000Z" },
    })
  })

  it("una lectura de OnWay lenta no retiene la respuesta de Wialon más allá del tope", async () => {
    vi.useFakeTimers()
    mocks.refreshOnwayLive.mockReturnValue(new Promise(() => undefined))
    const pending = POST()
    await vi.advanceTimersByTimeAsync(ONWAY_RESPONSE_DEADLINE_MS)
    const response = await pending
    expect(await response.json()).toEqual({
      onway: { outcome: "skipped", reason: "busy" },
      wialon: { outcome: "synced", observedAt: "2026-11-09T12:03:01.000Z" },
    })
  })
})
