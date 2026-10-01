import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const sentry = vi.hoisted(() => ({ init: vi.fn(), captureException: vi.fn() }))
vi.mock("@/lib/observability/sentry-browser-sdk", () => sentry)

async function loadHelper(dsn: string) {
  vi.resetModules()
  vi.stubEnv("NEXT_PUBLIC_SENTRY_DSN", dsn)
  return import("@/lib/observability/sentry-client")
}

describe("Sentry en el navegador (lib/observability/sentry-client.ts)", () => {
  beforeEach(() => {
    sentry.init.mockReset()
    sentry.captureException.mockReset()
  })
  afterEach(() => vi.unstubAllEnvs())

  it("sin DSN no inicializa ni reporta", async () => {
    const { initClientSentry, reportBoundaryError } = await loadHelper("")
    initClientSentry()
    reportBoundaryError(new Error("x"))
    await vi.dynamicImportSettled()
    expect(sentry.init).not.toHaveBeenCalled()
    expect(sentry.captureException).not.toHaveBeenCalled()
  })

  it("con DSN inicializa una sola vez, con el beforeSend compartido", async () => {
    const { initClientSentry, reportBoundaryError } = await loadHelper("https://abc@o1.ingest.sentry.io/2")
    initClientSentry()
    reportBoundaryError(new Error("render roto"))
    await vi.dynamicImportSettled()
    await new Promise((r) => setTimeout(r, 0))
    expect(sentry.init).toHaveBeenCalledTimes(1)
    const options = sentry.init.mock.calls[0]![0]
    expect(options.dsn).toBe("https://abc@o1.ingest.sentry.io/2")
    expect(options.dataCollection.stackFrameVariables).toBe(false)
    expect(options.tracesSampleRate).toBeUndefined()
    expect(options.beforeSend({ request: { url: "/x?rut=1" } }).request.url).toBe("/x")
    expect(sentry.captureException).toHaveBeenCalledTimes(1)
  })

  it("no reenvía un error con digest: nació en el servidor y ya se reportó allá", async () => {
    const { reportBoundaryError } = await loadHelper("https://abc@o1.ingest.sentry.io/2")
    reportBoundaryError(Object.assign(new Error("An error occurred in the Server Components render"), { digest: "123" }))
    await vi.dynamicImportSettled()
    await new Promise((r) => setTimeout(r, 0))
    expect(sentry.captureException).not.toHaveBeenCalled()
  })
})
