import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  frame: vi.fn(),
  status: vi.fn(),
  input: vi.fn(),
  cancel: vi.fn(),
}))

vi.mock("@/lib/logger", () => ({ logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }))
vi.mock("@/lib/auth/auth", () => ({ auth: (...args: unknown[]) => Reflect.apply(mocks.auth, null, args) }))
vi.mock("@/lib/auth/can", () => ({
  can: (session: { user?: { permissions?: string[] } } | null, permission: string) =>
    Boolean(session?.user?.permissions?.includes(permission)),
}))
vi.mock("@/lib/integrations/onway/onway-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/integrations/onway/onway-client")>()
  return {
    ...actual,
    readOnwayChallengeFrame: (...args: unknown[]) => Reflect.apply(mocks.frame, null, args),
    getOnwayChallengeStatus: (...args: unknown[]) => Reflect.apply(mocks.status, null, args),
    sendOnwayChallengeInput: (...args: unknown[]) => Reflect.apply(mocks.input, null, args),
    cancelOnwayChallenge: (...args: unknown[]) => Reflect.apply(mocks.cancel, null, args),
  }
})

const { GET, POST } = await import("./route")
const { OnwayChallengeError } = await import("@/lib/integrations/onway/onway-client")

const params = { params: Promise.resolve({ id: "c1" }) }
const url = "http://localhost/api/flota/monitoreo/onway-verificacion/c1"
const view = {
  id: "c1",
  status: "awaiting" as const,
  expiresAt: 1_800_000,
  viewport: { width: 1_280, height: 720 },
  remainingMs: 60_000,
}

function postRequest(body: unknown) {
  return new NextRequest(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}

describe("/api/flota/monitoreo/onway-verificacion/[id]", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.auth.mockResolvedValue({ user: { id: "user-1", permissions: ["flota:manage_gps"] } })
    mocks.frame.mockResolvedValue(Buffer.from([0xff, 0xd8, 0xff, 0xd9]))
    mocks.status.mockResolvedValue(view)
    mocks.input.mockResolvedValue(undefined)
    mocks.cancel.mockResolvedValue({ ...view, status: "cancelled" })
  })

  it("sin sesión responde 401 y no toca el navegador", async () => {
    mocks.auth.mockResolvedValue(null)
    const response = await GET(new NextRequest(url), params)
    expect(response.status).toBe(401)
    expect(mocks.frame).not.toHaveBeenCalled()
  })

  it("sin el permiso de GPS responde 403", async () => {
    mocks.auth.mockResolvedValue({ user: { id: "user-1", permissions: ["flota:view"] } })
    const response = await GET(new NextRequest(url), params)
    expect(response.status).toBe(403)
    expect(mocks.status).not.toHaveBeenCalled()
  })

  it("sirve el frame como JPEG sin caché", async () => {
    const response = await GET(new NextRequest(`${url}?frame=1`), params)
    expect(response.status).toBe(200)
    expect(response.headers.get("content-type")).toBe("image/jpeg")
    expect(response.headers.get("cache-control")).toContain("no-store")
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]))
    expect(mocks.frame).toHaveBeenCalledWith("c1", "user-1")
  })

  it("devuelve el estado del desafío sin caché", async () => {
    const response = await GET(new NextRequest(url), params)
    expect(await response.json()).toEqual({ ok: true, ...view })
    expect(response.headers.get("cache-control")).toBe("no-store")
    expect(mocks.status).toHaveBeenCalledWith("c1", "user-1")
  })

  it("reenvía la interacción al navegador del servidor", async () => {
    const body = { kind: "down", x: 0.5, y: 0.5 }
    const response = await POST(postRequest(body), params)
    expect(response.status).toBe(200)
    expect(mocks.input).toHaveBeenCalledWith("c1", "user-1", body)
  })

  it("cancela con una acción explícita", async () => {
    const response = await POST(postRequest({ action: "cancel" }), params)
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ ok: true, status: "cancelled" })
    expect(mocks.cancel).toHaveBeenCalledWith("c1", "user-1")
    expect(mocks.input).not.toHaveBeenCalled()
  })

  it("un desafío vencido o inexistente se explica con su código HTTP", async () => {
    mocks.status.mockRejectedValue(new OnwayChallengeError("ONWAY_CHALLENGE_NOT_FOUND"))
    const response = await GET(new NextRequest(url), params)
    expect(response.status).toBe(404)
    expect(await response.json()).toMatchObject({ code: "ONWAY_CHALLENGE_NOT_FOUND" })
  })

  it("una interacción inválida responde 400", async () => {
    mocks.input.mockRejectedValue(new OnwayChallengeError("ONWAY_CHALLENGE_INPUT_INVALID"))
    const response = await POST(postRequest({ kind: "click", x: 0, y: 0 }), params)
    expect(response.status).toBe(400)
  })
})
