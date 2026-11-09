import { describe, expect, it, vi } from "vitest"

/**
 * La página autenticada del portal pertenece a una cuenta. Antes, guardar
 * credenciales nuevas en Monitoreo no tenía efecto hasta reiniciar el
 * contenedor: el cron reusaba la sesión de la cuenta anterior.
 */
const browser = vi.hoisted(() => ({ launches: 0 }))

vi.mock("@/lib/logger", () => ({ logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }))

vi.mock("playwright", () => {
  const snapshotResponse = {
    url: () => "https://onway.enteldigital.cl/OnlineTracking/GetOnlineDevicesInfoByUserForMap/",
    request: () => ({ method: () => "POST" }),
    ok: () => true,
    headers: () => ({ "content-type": "application/json; charset=utf-8" }),
    body: async () => Buffer.from(JSON.stringify({ is_session_alive: true, devices: [] })),
  }
  const page = {
    isClosed: () => false,
    // Ya autenticada: la lectura no pasa por Auth0.
    url: () => "https://onway.enteldigital.cl/OnlineTracking/Index/es",
    goto: async () => null,
    waitForResponse: async () => snapshotResponse,
    locator: () => ({ isVisible: async () => false, count: async () => 0 }),
    evaluate: async () => ({}),
  }
  return {
    chromium: {
      launchServer: async () => {
        browser.launches++
        return { wsEndpoint: () => "ws://127.0.0.1/onway", close: async () => undefined, kill: async () => undefined }
      },
      connect: async () => ({ isConnected: () => true, close: async () => undefined, newContext: async () => ({ newPage: async () => page }) }),
    },
  }
})

describe("sesión del portal OnWay por cuenta", () => {
  it("reusa el navegador mientras la cuenta no cambia y lo reabre cuando cambia", async () => {
    globalThis.__onwayClient = undefined
    const { fetchOnwayTelemetry } = await import("./onway-client")
    const cuentaA = { username: "flota@example.com", password: "a" }

    await fetchOnwayTelemetry(cuentaA, { includeHistory: false })
    await fetchOnwayTelemetry(cuentaA, { includeHistory: false })
    expect(browser.launches).toBe(1)

    await fetchOnwayTelemetry({ username: "otra@example.com", password: "a" }, { includeHistory: false })
    expect(browser.launches).toBe(2)

    // Rotar sólo la contraseña también obliga a autenticar de nuevo.
    await fetchOnwayTelemetry({ username: "otra@example.com", password: "b" }, { includeHistory: false })
    expect(browser.launches).toBe(3)
  })
})
