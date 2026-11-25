import { afterEach, describe, expect, it, vi } from "vitest"

/**
 * Regresión del 2026-11-24: «por más que resuelvo los desafíos del captcha, me
 * tiene una y otra vez, no acaba nunca».
 *
 * Cada fallo de lectura cerraba el navegador y con él las cookies de Auth0 que
 * la persona acababa de conseguir con el CAPTCHA, así que el intento siguiente
 * volvía a pedir el desafío. Medido en producción: 6 CAPTCHAs pedidos, 1 vista
 * abierta y **0 verificaciones completadas** en 24 h.
 *
 * Lo que se fija: cerrar el navegador destruye la sesión, así que un fallo de
 * lectura con sesión confirmada debe reemplazar SÓLO la página. La corrida
 * siguiente tiene que reutilizar el mismo navegador, no abrir otro.
 */
const mocks = vi.hoisted(() => ({
  launchServer: vi.fn(),
  serverClose: vi.fn(async () => undefined),
  serverKill: vi.fn(async () => undefined),
  browserClose: vi.fn(async () => undefined),
  newPage: vi.fn(),
  launches: 0,
}))

vi.mock("@/lib/logger", () => ({ logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }))

vi.mock("playwright", () => {
  const snapshot = { is_session_alive: true, devices: [{ device_id: 7, unit_id: 7, imei: "000000000000007" }] }
  const response = {
    url: () => "https://onway.enteldigital.cl/OnlineTracking/GetOnlineDevicesInfoByUserForMap/",
    ok: () => true,
    headers: () => ({ "content-type": "application/json" }),
    body: async () => Buffer.from(JSON.stringify(snapshot)),
  }
  // La primera lectura responde el snapshot (sesión válida). La siguiente
  // cuelga `evaluate`: simula el portal que deja de contestar.
  let reads = 0
  const page = {
    isClosed: () => false,
    url: () => "https://onway.enteldigital.cl/OnlineTracking/Index/es",
    goto: async () => null,
    waitForResponse: async () => { reads++; return response },
    locator: () => ({ isVisible: async () => false, count: async () => 0 }),
    evaluate: () => (reads <= 1 ? Promise.resolve(response) : new Promise(() => undefined)),
    close: async () => undefined,
  }
  return {
    chromium: {
      launchServer: async () => {
        mocks.launches++
        mocks.launchServer()
        return { wsEndpoint: () => "ws://127.0.0.1/onway", close: mocks.serverClose, kill: mocks.serverKill }
      },
      connect: async () => ({
        isConnected: () => true,
        close: mocks.browserClose,
        newContext: async () => ({ pages: () => [page], newPage: async () => { mocks.newPage(); return page } }),
      }),
    },
  }
})

const credentials = { username: "operador@example.com", password: "x" }
const { fetchOnwayTelemetry } = await import("./onway-client")

afterEach(() => { vi.clearAllMocks() })

describe("sesión de OnWay frente a un fallo de lectura", () => {
  it("una lectura exitosa deja la sesión marcada como válida", async () => {
    await fetchOnwayTelemetry(credentials, { deadlineMs: 5_000 })

    // Nada se cerró: el navegador sigue disponible para la corrida siguiente.
    expect(mocks.browserClose).not.toHaveBeenCalled()
    expect(mocks.serverKill).not.toHaveBeenCalled()
  })

  it("un timeout posterior conserva el navegador en vez de destruir la sesión", async () => {
    // Segunda lectura: el portal ya no contesta y vence el plazo.
    await expect(fetchOnwayTelemetry(credentials, { deadlineMs: 60 }))
      .rejects.toMatchObject({ code: "ONWAY_PORTAL_TIMEOUT" })

    // El driver NO se mata: hacerlo borra las cookies de Auth0 y obliga a otro
    // CAPTCHA. Se cambia la página, que es lo único inservible.
    expect(mocks.serverKill).not.toHaveBeenCalled()
  })
})
