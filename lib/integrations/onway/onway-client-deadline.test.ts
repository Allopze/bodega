import { afterEach, describe, expect, it, vi } from "vitest"

/**
 * Regresión del GPS detenido (2026-10-29 → 2026-11-01): una lectura del
 * portal que nunca contesta colgaba `fetchOnwayTelemetry` para siempre, con
 * el lock del cron tomado. Ahora tiene que fallar dentro del plazo y cerrar
 * el navegador.
 */
const browser = vi.hoisted(() => ({ close: vi.fn(async () => undefined), launches: 0 }))

vi.mock("playwright", () => {
  const snapshot = { is_session_alive: true, devices: [{ device_id: 41, unit_id: 41, imei: "000000000000041" }] }
  const response = {
    url: () => "https://onway.enteldigital.cl/OnlineTracking/GetOnlineDevicesInfoByUserForMap/",
    ok: () => true,
    headers: () => ({ "content-type": "application/json" }),
    body: async () => Buffer.from(JSON.stringify(snapshot)),
  }
  const page = {
    isClosed: () => false,
    url: () => "https://onway.enteldigital.cl/OnlineTracking/Index/es",
    goto: async () => null,
    waitForResponse: async () => response,
    locator: () => ({ isVisible: async () => false }),
    // El portal nunca contesta: ni el fetch en la página ni el evaluate terminan.
    evaluate: () => new Promise(() => undefined),
  }
  return {
    chromium: {
      launch: async () => {
        browser.launches++
        return { isConnected: () => true, close: browser.close, newContext: async () => ({ newPage: async () => page }) }
      },
    },
  }
})

const { fetchOnwayTelemetry, withOnwayDeadline } = await import("./onway-client")

describe("fetchOnwayTelemetry con un portal que no contesta", () => {
  afterEach(() => { vi.useRealTimers() })

  it("falla con ONWAY_PORTAL_TIMEOUT dentro del plazo y cierra el navegador", async () => {
    await expect(fetchOnwayTelemetry({ username: "operador@example.com", password: "x" }, { deadlineMs: 50 }))
      .rejects.toMatchObject({ code: "ONWAY_PORTAL_TIMEOUT" })
    expect(browser.close).toHaveBeenCalled()
  })

  it("la corrida siguiente abre un navegador nuevo en vez de reusar la sesión colgada", async () => {
    const before = browser.launches
    await expect(fetchOnwayTelemetry({ username: "operador@example.com", password: "x" }, { deadlineMs: 50 }))
      .rejects.toMatchObject({ code: "ONWAY_PORTAL_TIMEOUT" })
    expect(browser.launches).toBe(before + 1)
  })
})

describe("withOnwayDeadline", () => {
  it("devuelve el resultado si llega a tiempo", async () => {
    await expect(withOnwayDeadline(Promise.resolve(7), 1_000)).resolves.toBe(7)
  })

  it("propaga el error propio del trabajo, no el de plazo", async () => {
    await expect(withOnwayDeadline(Promise.reject(new Error("ONWAY_X")), 1_000)).rejects.toThrow("ONWAY_X")
  })
})
