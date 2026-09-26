import { beforeEach, describe, expect, it, vi } from "vitest"

const mockError = vi.hoisted(() => vi.fn())
vi.mock("@/lib/logger", () => ({ logger: { error: mockError, warn: vi.fn() } }))

describe("instrumentation onRequestError (PREV-I13)", () => {
  beforeEach(() => { mockError.mockReset() })

  it("registra el error no capturado con ruta, tipo y digest, sin query ni headers", async () => {
    const { onRequestError } = await import("@/instrumentation")
    const err = Object.assign(new Error("boom"), { digest: "123456" })
    await onRequestError(
      err,
      { path: "/prevencion/pdtp?token=secreto", method: "POST", headers: { cookie: "session=abc" } },
      { routerKind: "App Router", routePath: "/prevencion/pdtp", routeType: "action", renderSource: undefined, revalidateReason: undefined } as never,
    )
    expect(mockError).toHaveBeenCalledTimes(1)
    const logged = JSON.stringify(mockError.mock.calls[0])
    expect(logged).toContain("/prevencion/pdtp")
    expect(logged).toContain("action")
    expect(logged).toContain("123456")
    expect(logged).not.toContain("token=secreto")
    expect(logged).not.toContain("session=abc")
  })

  it("nunca lanza, aunque el logger falle", async () => {
    const { onRequestError } = await import("@/instrumentation")
    mockError.mockImplementation(() => { throw new Error("logger caído") })
    await expect(onRequestError(new Error("x"), { path: "/", method: "GET", headers: {} }, { routerKind: "App Router", routePath: "/", routeType: "render" } as never)).resolves.toBeUndefined()
  })
})
