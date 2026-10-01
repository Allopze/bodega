import { beforeEach, describe, expect, it, vi } from "vitest"

const mockError = vi.hoisted(() => vi.fn())
const sentry = vi.hoisted(() => {
  const scope = { setTag: vi.fn() }
  return {
    scope,
    captureRequestError: vi.fn(),
    withScope: vi.fn((cb: (s: typeof scope) => void) => cb(scope)),
  }
})
vi.mock("@/lib/logger", () => ({ logger: { error: mockError, warn: vi.fn() } }))
vi.mock("@sentry/nextjs", () => ({ captureRequestError: sentry.captureRequestError, withScope: sentry.withScope }))

describe("instrumentation onRequestError (PREV-I13)", () => {
  beforeEach(() => {
    mockError.mockReset()
    sentry.captureRequestError.mockReset()
    sentry.scope.setTag.mockReset()
    vi.unstubAllEnvs()
  })

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

  it("sin SENTRY_DSN no toca Sentry", async () => {
    vi.stubEnv("SENTRY_DSN", "")
    const { onRequestError } = await import("@/instrumentation")
    await onRequestError(new Error("x"), { path: "/", method: "GET", headers: {} }, { routerKind: "App Router", routePath: "/", routeType: "render" } as never)
    expect(sentry.captureRequestError).not.toHaveBeenCalled()
  })

  it("con SENTRY_DSN reporta el Error real a Sentry y etiqueta el digest", async () => {
    vi.stubEnv("NEXT_RUNTIME", "nodejs")
    vi.stubEnv("SENTRY_DSN", "https://abc@o1.ingest.sentry.io/2")
    const { onRequestError } = await import("@/instrumentation")
    const err = Object.assign(new Error("boom"), { digest: "987" })
    const request = { path: "/x", method: "POST", headers: {} }
    const context = { routerKind: "App Router", routePath: "/x", routeType: "action" } as never
    await onRequestError(err, request, context)
    expect(sentry.captureRequestError).toHaveBeenCalledWith(err, request, context)
    expect(sentry.scope.setTag).toHaveBeenCalledWith("digest", "987")
    // El log a stdout sigue saliendo, y sin el Error: así el sink no lo duplica.
    expect(mockError).toHaveBeenCalledTimes(1)
    expect(mockError.mock.calls[0]!.some((a: unknown) => a instanceof Error)).toBe(false)
  })

  it("si Sentry lanza, onRequestError igual resuelve", async () => {
    vi.stubEnv("NEXT_RUNTIME", "nodejs")
    vi.stubEnv("SENTRY_DSN", "https://abc@o1.ingest.sentry.io/2")
    sentry.captureRequestError.mockImplementation(() => { throw new Error("sdk") })
    const { onRequestError } = await import("@/instrumentation")
    await expect(onRequestError(new Error("x"), { path: "/", method: "GET", headers: {} }, { routerKind: "App Router", routePath: "/", routeType: "render" } as never)).resolves.toBeUndefined()
  })
})
