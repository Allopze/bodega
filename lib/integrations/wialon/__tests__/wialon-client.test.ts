import { afterEach, describe, expect, it, vi } from "vitest"
import {
  extractWialonTelemetry,
  fetchWialonCalculatedSensors,
  fetchWialonUnits,
  wialonFuelSensorRequests,
  loginWialon,
  logoutWialonSession,
  normalizeWialonBaseUrl,
  resetWialonSessionCache,
  verifyWialonCredentials,
  WialonClientError,
  type WialonClientErrorCode,
} from "../wialon-client"
import type { WialonUnit } from "../wialon-contract"

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })
}

function fetchMock(handler: (svc: string, params: Record<string, unknown>) => Response) {
  return vi.fn(async (_url: string, init?: RequestInit) => {
    const body = new URLSearchParams(String(init?.body ?? ""))
    const svc = body.get("svc") ?? ""
    const params = JSON.parse(body.get("params") ?? "{}") as Record<string, unknown>
    return handler(svc, params)
  }) as unknown as typeof fetch
}

function unit(overrides: Partial<WialonUnit> = {}): WialonUnit {
  return {
    id: "unit-1",
    name: "CAMION ABCD12",
    uniqueId: "imei-1",
    hardwareType: "teltonika",
    customProperties: {},
    counters: { mileageKm: 5_000, engineHours: 120 },
    connected: true,
    profile: { registrationPlate: null, vin: null, brand: null, model: null },
    sensors: [{ id: null, p: "fuel_level", name: "Nivel", type: null, unit: "%" }],
    position: { x: -70.65, y: -33.45, s: 12, c: 90, sc: 8, t: 1_760_000_000 },
    lastMessageParams: { mileage: 1234, engine_hours: 0, fuel_level: 50, ignition: 1 },
    lastMessageAt: "2026-11-12T12:00:00.000Z",
    ...overrides,
  }
}

afterEach(() => {
  resetWialonSessionCache()
})

describe("cliente Wialon", () => {
  it("hace token/login con fl y devuelve el sid", async () => {
    const fetchImpl = fetchMock((svc, params) => {
      expect(svc).toBe("token/login")
      expect(params.token).toBe("secret")
      expect(params.fl).toBe(1)
      return jsonResponse({ sid: "sid-1" })
    })
    await expect(loginWialon({ baseUrl: "https://hst-api.wialon.com", token: "secret" }, { fetchImpl }))
      .resolves.toBe("sid-1")
  })

  it("acepta el eid que devuelve token/login de Wialon Hosting", async () => {
    const fetchImpl = fetchMock(() => jsonResponse({ eid: "eid-1", user: {} }))
    await expect(loginWialon({ baseUrl: "https://hst-api.wialon.com", token: "secret" }, { fetchImpl }))
      .resolves.toBe("eid-1")
  })

  it("pide los flags documentados y normaliza contadores, conexión y perfil", async () => {
    const calls: string[] = []
    const fetchImpl = fetchMock((svc, params) => {
      calls.push(svc)
      if (svc === "token/login") return jsonResponse({ eid: "sid-1" })
      // base | prp | avanzadas | pos+lmsg | sens | contadores | netconn | pflds
      expect(params.flags).toBe(0x1 | 0x2 | 0x100 | 0x400 | 0x1000 | 0x2000 | 0x200000 | 0x800000)
      return jsonResponse({
        items: [{
          id: 42,
          nm: "CAMION ABCD12",
          uid: "imei-1",
          hw: "teltonika",
          prp: { patente: "ABCD12" },
          sens: { "1": { p: "fuel_level", n: "Nivel", m: "%" } },
          pos: { x: -70.65, y: -33.45, s: 12, c: 90, sc: 8, t: 1_760_000_000 },
          lmsg: { t: 1_760_000_300, p: { fuel_level: 50 } },
          cnm: 12_345.6,
          cneh: 987.5,
          netconn: 1,
          pflds: {
            "7": { id: 7, n: "registration_plate", v: "ABCD-12" },
            "8": { id: 8, n: "vin", v: "9BWZZZ377VT004251" },
            "9": { id: 9, n: "brand", v: "Volvo" },
            "10": { id: 10, n: "model", v: "FH" },
            "11": { id: 11, n: "otro", v: "x" },
          },
        }],
      })
    })

    const result = await fetchWialonUnits({ baseUrl: "https://hst-api.wialon.com", token: "secret" }, { fetchImpl })
    expect(calls).toEqual(["token/login", "core/search_items"])
    expect(result.truncated).toBe(false)
    expect(result.units).toHaveLength(1)
    expect(result.units[0]).toMatchObject({
      id: "42",
      name: "CAMION ABCD12",
      uniqueId: "imei-1",
      hardwareType: "teltonika",
      customProperties: { patente: "ABCD12" },
      sensors: [{ p: "fuel_level", unit: "%" }],
      counters: { mileageKm: 12_345.6, engineHours: 987.5 },
      connected: true,
      profile: { registrationPlate: "ABCD-12", vin: "9BWZZZ377VT004251", brand: "Volvo", model: "FH" },
      lastMessageAt: new Date(1_760_000_300_000).toISOString(),
    })
    expect(result.units[0]).not.toHaveProperty("sysName")
    expect(result.units[0]).not.toHaveProperty("groupId")
  })

  it("un contador en 0 o ausente es «sin dato», y una unidad sin posición sigue listándose", async () => {
    const fetchImpl = fetchMock((svc) => {
      if (svc === "token/login") return jsonResponse({ eid: "sid-1" })
      return jsonResponse({ items: [{ id: 1, nm: "SIN GPS", cnm: 0, netconn: 0, pos: null, lmsg: { t: 1_760_000_000, p: {} } }] })
    })
    const result = await fetchWialonUnits({ baseUrl: "https://hst-api.wialon.com", token: "secret" }, { fetchImpl })
    expect(result.units[0]).toMatchObject({
      counters: { mileageKm: null, engineHours: null },
      connected: false,
      profile: { registrationPlate: null, vin: null },
      position: null,
    })
  })

  it("el refresco en vivo pide sólo base, posición y sensores", async () => {
    const fetchImpl = fetchMock((svc, params) => {
      if (svc === "token/login") return jsonResponse({ eid: "sid-1" })
      expect(params.flags).toBe(0x1 | 0x400 | 0x1000)
      return jsonResponse({ items: [] })
    })
    await fetchWialonUnits({ baseUrl: "https://hst-api.wialon.com", token: "secret" }, { fetchImpl, positionsOnly: true })
  })

  it("cierra la sesión cacheada al terminar la corrida", async () => {
    const calls: string[] = []
    const fetchImpl = fetchMock((svc) => {
      calls.push(svc)
      if (svc === "token/login") return jsonResponse({ sid: "sid-1" })
      return jsonResponse({ items: [] })
    })
    const credentials = { baseUrl: "https://hst-api.wialon.com", token: "secret" }
    await fetchWialonUnits(credentials, { fetchImpl })
    await logoutWialonSession(credentials, { fetchImpl })
    expect(calls).toEqual(["token/login", "core/search_items", "core/logout"])
  })

  it("probar credenciales no reutiliza la caché: siempre abre una sesión nueva", async () => {
    let logins = 0
    const fetchImpl = fetchMock((svc) => {
      if (svc === "token/login") {
        logins++
        return jsonResponse({ sid: `sid-${logins}` })
      }
      return jsonResponse({})
    })
    await verifyWialonCredentials({ baseUrl: "https://hst-api.wialon.com", token: "secret" }, { fetchImpl })
    await verifyWialonCredentials({ baseUrl: "https://hst-api.wialon.com", token: "secret" }, { fetchImpl })
    expect(logins).toBe(2)
  })

  it("mapea un error de permisos sin exponer el reason del proveedor", async () => {
    const fetchImpl = fetchMock(() => jsonResponse({ error: 7, reason: "detalle interno" }))
    await expect(fetchWialonUnits({ baseUrl: "https://hst-api.wialon.com", token: "secret" }, { fetchImpl }))
      .rejects.toMatchObject({ code: "WIALON_ACCESS_DENIED" satisfies WialonClientErrorCode })
  })

  it("mapea 401 a credenciales inválidas", async () => {
    const fetchImpl = fetchMock(() => jsonResponse({ error: "nope" }, 401))
    await expect(loginWialon({ baseUrl: "https://hst-api.wialon.com", token: "secret" }, { fetchImpl }))
      .rejects.toBeInstanceOf(WialonClientError)
  })

  it("rechaza una URL que no sea https, que lleve credenciales o que no sea del proveedor", () => {
    expect(() => normalizeWialonBaseUrl("http://hst-api.wialon.com")).toThrow(WialonClientError)
    expect(() => normalizeWialonBaseUrl("https://user:pass@hst-api.wialon.com")).toThrow(WialonClientError)
    expect(() => normalizeWialonBaseUrl("https://wialon.evil.example")).toThrow(WialonClientError)
    expect(() => normalizeWialonBaseUrl("https://127.0.0.1")).toThrow(WialonClientError)
    expect(() => normalizeWialonBaseUrl("https://localhost")).toThrow(WialonClientError)
    expect(() => normalizeWialonBaseUrl("https://169.254.169.254/latest/meta-data")).toThrow(WialonClientError)
    expect(normalizeWialonBaseUrl("https://hst-api.wialon.com/wialon/ajax.html")).toBe("https://hst-api.wialon.com")
  })

  it("sólo acepta hosts adicionales declarados por el servidor", () => {
    process.env.WIALON_ALLOWED_HOSTS = "wialon.local.example"
    try {
      expect(normalizeWialonBaseUrl("https://hst-api.wialon.local.example")).toBe("https://hst-api.wialon.local.example")
    } finally {
      delete process.env.WIALON_ALLOWED_HOSTS
    }
  })
})

describe("extractWialonTelemetry", () => {
  const params = { odometerParam: "", hourMeterParam: "", fuelLevelParam: "fuel_level" }
  const sensorParams = { ...params, odometerParam: "mileage", hourMeterParam: "engine_hours" }

  it("normaliza posición, encendido y medidores desde los contadores de Wialon", () => {
    const telemetry = extractWialonTelemetry(unit(), params)
    expect(telemetry).toMatchObject({
      latitude: -33.45,
      longitude: -70.65,
      speedKph: 12,
      headingDegrees: 90,
      ignition: true,
      odometer: 5_000,
      hourMeter: 120,
      fuelLevel: 50,
      movementState: "moving",
      satellites: 8,
    })
  })

  it("un parámetro configurado explícitamente manda sobre el contador", () => {
    const telemetry = extractWialonTelemetry(unit({
      lastMessageParams: { mileage: 1234, engine_hours: 0 },
    }), sensorParams)
    // engine_hours = 0 es «sin dato»: no cae al contador, porque el parámetro manda.
    expect(telemetry).toMatchObject({ odometer: 1234, hourMeter: null })
  })

  it("sin contador ni parámetro no inventa medidores", () => {
    const telemetry = extractWialonTelemetry(unit({ counters: { mileageKm: null, engineHours: null } }), params)
    expect(telemetry).toMatchObject({ odometer: null, hourMeter: null })
  })

  it("los medidores llevan la hora del último mensaje, no la de la posición", () => {
    const telemetry = extractWialonTelemetry(unit({
      position: { x: -70.65, y: -33.45, s: 0, c: 0, sc: 8, t: 1_760_000_000 },
      lastMessageAt: "2026-11-12T12:00:00.000Z",
    }), params)
    expect(telemetry?.metersReportedAt).toBe("2026-11-12T12:00:00.000Z")
    expect(telemetry?.gpsReportedAt).toBe(new Date(1_760_000_000_000).toISOString())
  })

  it("devuelve null sin posición válida", () => {
    expect(extractWialonTelemetry(unit({ position: null }), params)).toBeNull()
    expect(extractWialonTelemetry(unit({
      position: { x: -70.65, y: -133.45, s: 0, c: 0, sc: 0, t: 1_760_000_000 },
    }), params)).toBeNull()
  })

  it("usa la hora de la posición, no la del último mensaje sin GPS", () => {
    const telemetry = extractWialonTelemetry(unit({
      position: { x: -70.65, y: -33.45, s: 0, c: 0, sc: 8, t: 1_760_000_000 },
      lastMessageAt: "2026-11-12T12:00:00.000Z",
    }), params)
    expect(telemetry?.gpsReportedAt).toBe(new Date(1_760_000_000_000).toISOString())
  })

  it("no inventa un apagado cuando el mensaje no trae encendido", () => {
    const telemetry = extractWialonTelemetry(unit({ lastMessageParams: { mileage: 1234 } }), params)
    expect(telemetry?.ignition).toBeNull()
  })

  it("usa el sensor de ignición de la cuenta cuando no existe el parámetro estándar", () => {
    const telemetry = extractWialonTelemetry(unit({
      sensors: [{ id: null, p: "io_239", name: "ignicion", type: null, unit: "Encendido/Apagado" }],
      lastMessageParams: { io_239: 1, mileage: 1234 },
    }), params)
    expect(telemetry?.ignition).toBe(true)
  })

  it("convierte medidores en metros o segundos a km y horas", () => {
    const telemetry = extractWialonTelemetry(unit({
      lastMessageParams: { mileage: 1_500, engine_hours: 3_600, fuel_level: 50 },
      sensors: [
        { id: null, p: "mileage", name: "Odómetro", type: null, unit: "m" },
        { id: null, p: "engine_hours", name: "Horómetro", type: null, unit: "s" },
        { id: null, p: "fuel_level", name: "Nivel", type: null, unit: "%" },
      ],
    }), sensorParams)
    expect(telemetry).toMatchObject({ odometer: 1.5, hourMeter: 1 })
  })

  it("no interpreta litros como porcentaje cuando falta la unidad del sensor", () => {
    const telemetry = extractWialonTelemetry(unit({ sensors: [] }), params)
    expect(telemetry?.fuelLevel).toBeNull()
  })

  it("sólo acepta nivel de estanque cuando la unidad es porcentaje", () => {
    const liters = extractWialonTelemetry(unit({
      sensors: [{ id: null, p: "fuel_level", name: "Nivel", type: null, unit: "L" }],
    }), params)
    expect(liters?.fuelLevel).toBeNull()
    const percent = extractWialonTelemetry(unit({
      sensors: [{ id: null, p: "fuel_level", name: "Nivel", type: null, unit: "%" }],
    }), params)
    expect(percent?.fuelLevel).toBe(50)
  })
})

// Forma real de la cuenta (2026-11-12): el tipo de sensor llega como texto, el
// encendido es un `io_239` de tipo «engine operation» y el combustible un
// `io_270` de tipo «fuel level» en litros, que necesita el valor calculado.
describe("sensores por tipo", () => {
  const params = { odometerParam: "", hourMeterParam: "", fuelLevelParam: "fuel_level" }
  const fuelSensor = { id: "3", p: "io_270", name: "Combustible", type: "fuel level", unit: "l" }

  it("lee el tipo de sensor como texto y conserva su id", async () => {
    const fetchImpl = fetchMock((svc) => svc === "token/login"
      ? jsonResponse({ eid: "sid-1" })
      : jsonResponse({ items: [{
        id: 7, nm: "TO37 D6R",
        sens: { "3": { id: 3, n: "Control de Combustible", t: "fuel level", m: "l", p: "io_270" } },
        pos: { x: -72, y: -37, s: 0, c: 0, sc: 9, t: 1_760_000_000 },
        lmsg: { t: 1_760_000_000, p: { io_270: 812 } },
      }] }))
    const { units } = await fetchWialonUnits({ baseUrl: "https://hst-api.wialon.com", token: "t" }, { fetchImpl })
    expect(units[0]?.sensors).toEqual([{ id: "3", p: "io_270", name: "Control de Combustible", type: "fuel level", unit: "l" }])
  })

  it("usa el sensor de tipo «engine operation» como encendido", () => {
    const telemetry = extractWialonTelemetry(unit({
      sensors: [{ id: "1", p: "io_239", name: "Sensor de ignición del motor", type: "engine operation", unit: "On/Off" }],
      lastMessageParams: { io_239: 0 },
    }), params)
    expect(telemetry?.ignition).toBe(false)
  })

  it("el sensor de combustible sólo se usa con el valor calculado por Wialon, nunca el crudo", () => {
    const raw = unit({ sensors: [fuelSensor], lastMessageParams: { io_270: 812 } })
    expect(extractWialonTelemetry(raw, params, 400)?.fuelLevel).toBeNull()
    const calculated = unit({ sensors: [fuelSensor], lastMessageParams: { io_270: 812 }, calculatedSensors: { "3": 100 } })
    expect(extractWialonTelemetry(calculated, params, 400)?.fuelLevel).toBe(25)
    // Litros sin capacidad de estanque no se convierten en porcentaje.
    expect(extractWialonTelemetry(calculated, params, null)?.fuelLevel).toBeNull()
  })

  it("pide en lote el valor calculado de los sensores de combustible e ignora los N/A", async () => {
    expect(wialonFuelSensorRequests([unit({ id: "7", sensors: [fuelSensor] }), unit({ id: "8", sensors: [] })]))
      .toEqual([{ unitId: "7", sensorIds: ["3"] }])
    let batch: unknown
    const fetchImpl = fetchMock((svc, params) => {
      if (svc === "token/login") return jsonResponse({ eid: "sid-1" })
      batch = params
      return jsonResponse([{ "3": 120.5 }, { "4": -348201.3876 }, { error: 7 }])
    })
    const values = await fetchWialonCalculatedSensors(
      { baseUrl: "https://hst-api.wialon.com", token: "t" },
      [{ unitId: "7", sensorIds: ["3"] }, { unitId: "8", sensorIds: ["4"] }, { unitId: "9", sensorIds: ["5"] }],
      { fetchImpl },
    )
    expect(batch).toMatchObject({ params: [{ svc: "unit/calc_last_message", params: { unitId: 7, sensors: [3], flags: 1 } }, {}, {}] })
    expect([...values.entries()]).toEqual([["7", { "3": 120.5 }]])
  })
})

describe("parámetros configurados que la unidad no publica", () => {
  it("cae al contador cuando la unidad no trae el parámetro ni tiene sensor sobre él", () => {
    // Cuenta real: `.env` con mileage/engine_hours, mensajes sólo con io_*.
    const telemetry = extractWialonTelemetry(unit({ sensors: [], lastMessageParams: { io_239: 1 } }), {
      odometerParam: "mileage", hourMeterParam: "engine_hours", fuelLevelParam: "io_270",
    })
    expect(telemetry).toMatchObject({ odometer: 5_000, hourMeter: 120 })
  })

  it("el combustible configurado usa el valor calculado de su sensor si existe", () => {
    const telemetry = extractWialonTelemetry(unit({
      sensors: [{ id: "3", p: "io_270", name: "Combustible", type: "fuel level", unit: "l" }],
      lastMessageParams: { io_270: 812 },
      calculatedSensors: { "3": 200 },
    }), { odometerParam: "", hourMeterParam: "", fuelLevelParam: "io_270" }, 400)
    expect(telemetry?.fuelLevel).toBe(50)
  })
})
