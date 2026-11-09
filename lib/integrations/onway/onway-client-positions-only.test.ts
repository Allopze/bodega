import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * El refresco por minuto de Monitoreo GPS lee sólo el snapshot del mapa: una
 * consulta al portal de Entel. El detalle (una por equipo) y las alertas quedan
 * para el cron cada 5 minutos, así que no se pueden colar en la lectura liviana.
 */
const portal = vi.hoisted(() => ({ evaluations: 0 }))

vi.mock("@/lib/logger", () => ({ logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }))

vi.mock("playwright", () => {
  const device = (id: number) => ({
    device_id: id, unit_id: id, imei: `35${id}`, group_id: 10, automotor_plate: `AB-CD-${id}`,
    latitude: -36.8, longitude: -73.05, speed: 0, directionHeading: 0, ignition: false, active: "1",
  })
  const snapshotResponse = {
    url: () => "https://onway.enteldigital.cl/OnlineTracking/GetOnlineDevicesInfoByUserForMap/",
    request: () => ({ method: () => "POST" }),
    ok: () => true,
    headers: () => ({ "content-type": "application/json" }),
    body: async () => Buffer.from(JSON.stringify({ is_session_alive: true, devices: [device(11), device(12)] })),
  }
  const page = {
    isClosed: () => false,
    url: () => "https://onway.enteldigital.cl/OnlineTracking/Index/es",
    goto: async () => null,
    waitForResponse: async () => snapshotResponse,
    locator: () => ({ isVisible: async () => false, count: async () => 0 }),
    // Cada consulta de detalle o de alertas pasa por aquí (fetch dentro de la página).
    evaluate: async () => { portal.evaluations++; return {} },
  }
  return {
    chromium: {
      launchServer: async () => ({ wsEndpoint: () => "ws://127.0.0.1/onway", close: async () => undefined, kill: async () => undefined }),
      connect: async () => ({ isConnected: () => true, close: async () => undefined, newContext: async () => ({ newPage: async () => page }) }),
    },
  }
})

const credentials = { username: "flota@example.com", password: "x" }

describe("fetchOnwayTelemetry sólo con posiciones", () => {
  beforeEach(() => { portal.evaluations = 0 })

  it("con `includeDetails: false` trae el snapshot sin consultar detalle ni alertas", async () => {
    const { fetchOnwayTelemetry } = await import("./onway-client")
    const telemetry = await fetchOnwayTelemetry(credentials, { includeDetails: false })
    expect(telemetry.snapshot.devices.map((device) => device.externalDeviceId)).toEqual(["11", "12"])
    expect(telemetry.details).toEqual([])
    expect(telemetry.alerts).toEqual([])
    expect(telemetry.warnings).toEqual([])
    expect(portal.evaluations).toBe(0)
  })

  it("la lectura completa sí consulta el detalle de cada equipo y las alertas", async () => {
    const { fetchOnwayTelemetry } = await import("./onway-client")
    await fetchOnwayTelemetry(credentials, { includeHistory: false })
    expect(portal.evaluations).toBe(3)
  })
})
