import { afterEach, describe, expect, it, vi } from "vitest"

/**
 * Regresión del cron GPS trabado (2026-11-01 → 11-02): la lectura del portal
 * no contestaba y el cierre del navegador tampoco. El `finally` que liberaba
 * `inFlight` nunca corría, así que cada corrida siguiente esperaba esa misma
 * promesa 110 s sin volver a abrir el portal; y el Chromium colgado quedaba
 * vivo hasta reiniciar el contenedor. Además Next empaquetaba el cliente dos
 * veces (cron y Monitoreo), cada copia con su propio estado.
 */
const browser = vi.hoisted(() => ({ launches: 0, kills: 0 }))

vi.mock("@/lib/logger", () => ({ logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }))

vi.mock("playwright", () => {
  const page = {
    isClosed: () => false,
    url: () => "https://onway.enteldigital.cl/OnlineTracking/Index/es",
    goto: async () => null,
    // La respuesta del snapshot nunca llega.
    waitForResponse: () => new Promise(() => undefined),
    locator: () => ({ isVisible: async () => false, count: async () => 0 }),
    evaluate: () => new Promise(() => undefined),
  }
  return {
    chromium: {
      launchServer: async () => {
        browser.launches++
        return {
          wsEndpoint: () => "ws://127.0.0.1/onway",
          close: () => new Promise(() => undefined),
          kill: async () => { browser.kills++ },
        }
      },
      // Navegador trabado: ni siquiera el cierre termina.
      connect: async () => ({ isConnected: () => true, close: () => new Promise(() => undefined), newContext: async () => ({ newPage: async () => page }) }),
    },
  }
})

const credentials = { username: "operador@example.com", password: "x" }

describe("fetchOnwayTelemetry con navegador trabado", () => {
  afterEach(() => { vi.useRealTimers() })

  it("la corrida siguiente vuelve a abrir el portal aunque el cierre anterior siga colgado", async () => {
    const { fetchOnwayTelemetry } = await import("./onway-client")
    await expect(fetchOnwayTelemetry(credentials, { deadlineMs: 50 })).rejects.toMatchObject({ code: "ONWAY_PORTAL_TIMEOUT" })
    const before = browser.launches
    await expect(fetchOnwayTelemetry(credentials, { deadlineMs: 50 })).rejects.toMatchObject({ code: "ONWAY_PORTAL_TIMEOUT" })
    expect(browser.launches).toBe(before + 1)
  })

  it("mata el proceso de Chromium si el cierre no termina a tiempo", async () => {
    vi.useFakeTimers()
    const { fetchOnwayTelemetry } = await import("./onway-client")
    const run = fetchOnwayTelemetry(credentials, { deadlineMs: 50 })
    const settled = expect(run).rejects.toMatchObject({ code: "ONWAY_PORTAL_TIMEOUT" })
    await vi.advanceTimersByTimeAsync(60)
    await settled
    const before = browser.kills
    await vi.advanceTimersByTimeAsync(10_000)
    expect(browser.kills).toBe(before + 1)
  })

  it("dos copias del módulo comparten la lectura en curso en vez de abrir dos navegadores", async () => {
    globalThis.__onwayClient = undefined
    vi.resetModules()
    const first = await import("./onway-client")
    vi.resetModules()
    const second = await import("./onway-client")
    expect(second).not.toBe(first)

    const before = browser.launches
    const a = first.fetchOnwayTelemetry(credentials, { deadlineMs: 50 })
    const b = second.fetchOnwayTelemetry(credentials, { deadlineMs: 50 })
    await expect(a).rejects.toMatchObject({ code: "ONWAY_PORTAL_TIMEOUT" })
    await expect(b).rejects.toMatchObject({ code: "ONWAY_PORTAL_TIMEOUT" })
    expect(browser.launches).toBe(before + 1)
  })
})
