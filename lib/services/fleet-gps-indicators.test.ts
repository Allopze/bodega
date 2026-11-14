import { describe, expect, it, vi } from "vitest"

vi.mock("@/db", () => ({ db: {} }))
vi.mock("server-only", () => ({}))

const {
  alertBucketKey,
  alertGranularity,
  buildGpsAlertAggregates,
  buildGpsUsage,
  dailyAdvanceFromSeries,
  listAlertBuckets,
  listWeeks,
  pickGpsMeterSource,
  weekStart,
} = await import("./fleet-gps-indicators")

/** Instante del mediodía chileno de un día (UTC-3 en verano, UTC-4 en invierno: 15:00Z cae en el mismo día en ambos). */
const at = (day: string) => `${day}T15:00:00.000Z`

describe("pickGpsMeterSource", () => {
  it("sin dos lecturas no hay fuente", () => {
    expect(pickGpsMeterSource("odometer", { gps_wialon: 1 })).toBeNull()
    expect(pickGpsMeterSource("hour_meter", {})).toBeNull()
  })

  it("el horómetro prefiere VisionLink, luego Wialon, luego OnWay", () => {
    expect(pickGpsMeterSource("hour_meter", { visionlink_api: 10, gps_wialon: 10, gps_onway: 10 })).toBe("visionlink_api")
    expect(pickGpsMeterSource("hour_meter", { gps_wialon: 10, gps_onway: 10 })).toBe("gps_wialon")
    expect(pickGpsMeterSource("hour_meter", { gps_onway: 3 })).toBe("gps_onway")
  })

  it("el odómetro prefiere Wialon sobre OnWay y nunca usa VisionLink", () => {
    expect(pickGpsMeterSource("odometer", { gps_wialon: 5, gps_onway: 5 })).toBe("gps_wialon")
    expect(pickGpsMeterSource("odometer", { visionlink_api: 99 })).toBeNull()
  })

  it("una fuente con apenas unas lecturas no desplaza a la que tiene historia", () => {
    expect(pickGpsMeterSource("odometer", { gps_wialon: 3, gps_onway: 100 })).toBe("gps_onway")
    expect(pickGpsMeterSource("odometer", { gps_wialon: 50, gps_onway: 100 })).toBe("gps_wialon")
  })
})

describe("dailyAdvanceFromSeries", () => {
  it("atribuye el avance al día de la lectura que cierra el par", () => {
    const out = dailyAdvanceFromSeries([
      { value: 100, occurredAt: at("2026-11-01") },
      { value: 130, occurredAt: at("2026-11-02") },
      { value: 150, occurredAt: at("2026-11-03") },
    ], 1_500)
    expect(out).toEqual([{ day: "2026-11-02", advance: 30 }, { day: "2026-11-03", advance: 20 }])
  })

  it("descarta retrocesos y el salto siguiente, sin sumar de vuelta el error", () => {
    const out = dailyAdvanceFromSeries([
      { value: 1_000, occurredAt: at("2026-11-01") },
      { value: 10, occurredAt: at("2026-11-02") },
      { value: 1_050, occurredAt: at("2026-11-03") },
      { value: 1_070, occurredAt: at("2026-11-04") },
    ], 1_500)
    expect(out).toEqual([{ day: "2026-11-04", advance: 20 }])
  })

  it("descarta el salto imposible para los días transcurridos", () => {
    const out = dailyAdvanceFromSeries([
      { value: 0, occurredAt: at("2026-11-01") },
      { value: 80, occurredAt: at("2026-11-02") },
    ], 24)
    expect(out).toEqual([])
  })

  it("un avance de cero no es uso", () => {
    expect(dailyAdvanceFromSeries([
      { value: 5, occurredAt: at("2026-11-01") },
      { value: 5, occurredAt: at("2026-11-02") },
    ], 24)).toEqual([])
  })
})

describe("semanas y baldes de alertas", () => {
  it("weekStart devuelve el lunes", () => {
    expect(weekStart("2026-11-13")).toBe("2026-11-09") // viernes
    expect(weekStart("2026-11-09")).toBe("2026-11-09") // lunes
    expect(weekStart("2026-11-15")).toBe("2026-11-09") // domingo
  })

  it("listWeeks incluye la semana que contiene el inicio y la del término", () => {
    expect(listWeeks("2026-11-04", "2026-11-17")).toEqual(["2026-11-02", "2026-11-09", "2026-11-16"])
  })

  it("hasta ~6 meses va por semana, sobre eso por mes", () => {
    expect(alertGranularity("2026-06-01", "2026-11-13")).toBe("week")
    expect(alertGranularity("2025-11-01", "2026-11-13")).toBe("month")
    expect(alertBucketKey("2026-11-13", "week")).toBe("2026-11-09")
    expect(alertBucketKey("2026-11-13", "month")).toBe("2026-11")
    expect(listAlertBuckets("2026-09-15", "2026-11-13", "month")).toEqual(["2026-09", "2026-10", "2026-11"])
  })
})

describe("buildGpsUsage", () => {
  const period = {
    from: "2026-11-01",
    to: "2026-11-10",
    previous: { from: "2026-10-22", to: "2026-10-31" },
    granularity: "day" as const,
  }
  const vehicles = [
    { id: "v1", code: "KA-1", plate: "AA-0001", typeName: "Camión", typeSlug: "camion", worksiteId: "w1", worksiteName: "Faena 1" },
    { id: "v2", code: null, plate: "BB-0002", typeName: "Cargadora", typeSlug: "cargadora", worksiteId: "w2", worksiteName: "Faena 2" },
    { id: "v3", code: "KA-3", plate: "CC-0003", typeName: "Camión", typeSlug: "camion", worksiteId: "w1", worksiteName: "Faena 1" },
  ]
  const odo = (vehicleId: string, day: string, value: number, source = "gps_wialon") => ({ vehicleId, source, meterType: "odometer", occurredAt: at(day), value })
  const hrs = (vehicleId: string, day: string, value: number, source = "visionlink_api") => ({ vehicleId, source, meterType: "hour_meter", occurredAt: at(day), value })

  const meterRows = [
    // v1: km. 31 oct → 1 nov (+50, cae en la lectura previa: el par cierra el 1 nov), luego +30 el 2 y +20 el 3. Antes del período: +10 el 31.
    odo("v1", "2026-10-30", 940), odo("v1", "2026-10-31", 950), odo("v1", "2026-11-01", 1_000), odo("v1", "2026-11-02", 1_030), odo("v1", "2026-11-03", 1_050),
    // v2: sólo horas (VisionLink), 8 h el 2 y 6 h el 3.
    hrs("v2", "2026-11-01", 500), hrs("v2", "2026-11-02", 508), hrs("v2", "2026-11-03", 514),
    // v1 también tiene OnWay: no se encadena con Wialon.
    odo("v1", "2026-11-02", 9_999, "gps_onway"),
    // fuera del alcance de los equipos pedidos
    odo("zz", "2026-11-02", 1), odo("zz", "2026-11-03", 900),
  ]

  const data = buildGpsUsage({ vehicles, meterRows, linkedExtra: new Set(["v3"]), rule: { config: null }, period })

  it("suma km y horas del período y del anterior", () => {
    expect(data.km.current).toBe(100) // 50 + 30 + 20
    expect(data.km.previous).toBe(10)
    expect(data.hours.current).toBe(14)
    expect(data.hours.previous).toBe(0)
  })

  it("mide la cobertura de lecturas en pares equipo-día de cada período", () => {
    // v1: 30 y 31/10 (anterior) y 1-3/11 (actual; el OnWay del 2 es el mismo par equipo-día); v2: 1-3/11; zz queda fuera.
    expect(data.readingDays).toEqual({ current: 6, previous: 2 })
  })

  it("reparte por día, incluidos los días sin datos", () => {
    expect(data.buckets).toHaveLength(10)
    const byKey = Object.fromEntries(data.buckets.map((bucket) => [bucket.key, bucket]))
    expect(byKey["2026-11-01"]).toMatchObject({ km: 50, hours: 0 })
    expect(byKey["2026-11-02"]).toMatchObject({ km: 30, hours: 8 })
    expect(byKey["2026-11-03"]).toMatchObject({ km: 20, hours: 6 })
    expect(byKey["2026-11-07"]).toMatchObject({ km: 0, hours: 0 })
  })

  it("cuenta equipos vinculados, con lecturas, con uso y la flota", () => {
    expect(data.fleetVehicles).toBe(3)
    expect(data.linkedVehicles).toBe(3) // v1 y v2 por lecturas, v3 por vínculo
    expect(data.vehiclesWithReadings).toBe(2)
    expect(data.vehiclesWithUse).toBe(2)
  })

  it("arma los rankings por equipo y por faena", () => {
    expect(data.topByKm.map((row) => row.vehicleId)).toEqual(["v1"])
    expect(data.topByHours.map((row) => row.vehicleId)).toEqual(["v2"])
    expect(data.byWorksite).toEqual([
      { worksiteId: "w1", name: "Faena 1", km: 100, hours: 0, vehicles: 1 },
      { worksiteId: "w2", name: "Faena 2", km: 0, hours: 14, vehicles: 1 },
    ])
  })

  it("agrupa por mes cuando la granularidad es mensual", () => {
    const monthly = buildGpsUsage({
      vehicles, meterRows, linkedExtra: new Set(), rule: { config: null },
      period: { from: "2026-10-01", to: "2026-11-30", previous: { from: "2026-08-01", to: "2026-09-30" }, granularity: "month" },
    })
    expect(monthly.buckets.map((bucket) => bucket.key)).toEqual(["2026-10", "2026-11"])
    expect(monthly.buckets[0]).toMatchObject({ km: 10 + 0 })
    expect(monthly.buckets[1]).toMatchObject({ km: 100, hours: 14 })
  })
})

describe("buildGpsAlertAggregates", () => {
  const period = {
    from: "2026-11-02",
    to: "2026-11-15",
    previous: { from: "2026-10-19", to: "2026-11-01" },
    granularity: "day" as const,
  }
  const vehicles = new Map([
    ["v1", { code: "KA-1", plate: "AA-0001", typeName: "Camión" }],
    ["v2", { code: "KA-2", plate: "BB-0002", typeName: "Camión" }],
  ])
  const speed = "El dispositivo KA-1 ha excedido la velocidad en segmento vial, límite de 50 km/h."
  const rows = [
    { vehicleId: "v1", day: "2026-11-03", title: speed, n: 4 },
    { vehicleId: "v2", day: "2026-11-10", title: speed, n: 1 },
    { vehicleId: "v1", day: "2026-11-10", title: "Inicio de ralentí, dispositivo KA-1", n: 2 },
    { vehicleId: "v1", day: "2026-11-10", title: "Fin de ralentí, dispositivo KA-1", n: 2 },
    { vehicleId: "v1", day: "2026-11-11", title: "El vehículo KA-1 fue apagado", n: 9 },
    { vehicleId: "v2", day: "2026-11-11", title: "El dispositivo KA-2 frenó bruscamente", n: 3 },
    { vehicleId: "v2", day: "2026-10-25", title: speed, n: 7 },
  ]
  const out = buildGpsAlertAggregates({ rows, vehicles, period })

  it("excluye las operacionales y cuenta por clase", () => {
    expect(out.alertTotals).toEqual({ speeding: 5, harsh_driving: 3, pothole: 0, idle: 2, other: 0 })
  })

  it("agrupa por semana (lunes) incluyendo las vacías", () => {
    expect(out.alertGranularity).toBe("week")
    expect(out.alertBuckets.map((bucket) => bucket.key)).toEqual(["2026-11-02", "2026-11-09"])
    expect(out.alertBuckets[0]!.counts.speeding).toBe(4)
    expect(out.alertBuckets[1]!.counts).toMatchObject({ speeding: 1, harsh_driving: 3, idle: 2 })
  })

  it("compara los excesos con el período anterior y rankea por equipo", () => {
    expect(out.speeding).toEqual({ current: 5, previous: 7 })
    expect(out.topSpeeding.map((row) => [row.vehicleId, row.count])).toEqual([["v1", 4], ["v2", 1]])
  })
})
