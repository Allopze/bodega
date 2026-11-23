import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  requirePermission: vi.fn(),
  readOnwayConfig: vi.fn(),
  start: vi.fn(),
  audit: vi.fn(),
  limit: vi.fn(),
}))

vi.mock("@/lib/logger", () => ({ logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }))
vi.mock("@/lib/auth/can", () => ({
  requirePermission: (...args: unknown[]) => Reflect.apply(mocks.requirePermission, null, args),
}))
vi.mock("@/lib/audit", () => ({
  recordAudit: (...args: unknown[]) => Reflect.apply(mocks.audit, null, args),
}))
vi.mock("@/lib/services/rate-limit", () => ({
  consumeFixedWindowLimit: (...args: unknown[]) => Reflect.apply(mocks.limit, null, args),
}))
vi.mock("@/lib/integrations/onway/onway-settings", () => ({
  readOnwayConfig: (...args: unknown[]) => Reflect.apply(mocks.readOnwayConfig, null, args),
}))
vi.mock("@/lib/integrations/onway/onway-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/integrations/onway/onway-client")>()
  return {
    ...actual,
    startOnwayInteractiveAuthentication: (...args: unknown[]) => Reflect.apply(mocks.start, null, args),
  }
})

const { POST } = await import("./route")
const { OnwayChallengeError, OnwayClientError } = await import("@/lib/integrations/onway/onway-client")

const challenge = {
  id: "onwayauth-c1",
  status: "awaiting" as const,
  expiresAt: 1_800_000,
  viewport: { width: 1_280, height: 720 },
}

describe("POST /api/flota/monitoreo/onway-verificacion", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.requirePermission.mockResolvedValue({ user: { id: "user-1", email: "flota@chome.cl" } })
    mocks.readOnwayConfig.mockResolvedValue({ hasCredentials: true, username: "flota@chome.cl", password: "secreto" })
    mocks.limit.mockResolvedValue({ allowed: true, remaining: 2 })
    mocks.audit.mockResolvedValue(undefined)
    mocks.start.mockResolvedValue({ status: "awaiting", challenge })
  })

  it("exige el permiso de administración del GPS", async () => {
    mocks.requirePermission.mockRejectedValue(new Error("forbidden"))
    const response = await POST()
    expect(response.status).toBe(403)
    expect(mocks.start).not.toHaveBeenCalled()
    expect(response.headers.get("cache-control")).toBe("no-store")
  })

  it("limita los intentos para no multiplicar navegadores", async () => {
    mocks.limit.mockResolvedValue({ allowed: false, remaining: 0 })
    const response = await POST()
    expect(response.status).toBe(429)
    expect(mocks.start).not.toHaveBeenCalled()
  })

  it("sin credenciales no abre el portal", async () => {
    mocks.readOnwayConfig.mockResolvedValue({ hasCredentials: false, username: "", password: "" })
    const response = await POST()
    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({ code: "ONWAY_CREDENTIALS_REQUIRED" })
    expect(mocks.start).not.toHaveBeenCalled()
  })

  it("si la sesión ya estaba autenticada responde sin crear una vista", async () => {
    mocks.start.mockResolvedValue({ status: "authenticated" })
    const response = await POST()
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true, status: "authenticated" })
    expect(mocks.audit).not.toHaveBeenCalled()
  })

  it("abre la vista, la audita y devuelve el id del desafío", async () => {
    const response = await POST()
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true, ...challenge })
    expect(mocks.start).toHaveBeenCalledWith(
      { username: "flota@chome.cl", password: "secreto" },
      "user-1",
    )
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({
      userId: "user-1",
      action: "login",
      entityType: "fleet_onway_interactive_auth",
      entityId: "onwayauth-c1",
    }))
  })

  it("traduce un desafío ya abierto por otra persona a un 409 explicable", async () => {
    mocks.start.mockRejectedValue(new OnwayChallengeError("ONWAY_CHALLENGE_ACTIVE"))
    const response = await POST()
    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({ code: "ONWAY_CHALLENGE_ACTIVE" })
  })

  it("traduce un rechazo de credenciales de Auth0 a un 409", async () => {
    mocks.start.mockRejectedValue(new OnwayClientError("ONWAY_AUTH_REJECTED"))
    const response = await POST()
    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({ code: "ONWAY_AUTH_REJECTED" })
  })

  it("un fallo desconocido no filtra el detalle y responde 502", async () => {
    mocks.start.mockRejectedValue(new Error("boom con datos internos"))
    const response = await POST()
    expect(response.status).toBe(502)
    expect(JSON.stringify(await response.json())).not.toContain("boom")
  })
})
