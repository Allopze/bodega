// @vitest-environment jsdom
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"
import type { IndicatorPeriod } from "@/lib/indicators/period"
import type { GpsDrivingIndicators, GpsIdleIndicators, GpsUsageIndicators } from "@/lib/services/fleet-gps-indicators"

// Los gráficos se cargan diferidos y sin SSR: aquí sólo importa la estructura de las secciones.
vi.mock("./gps-charts-lazy", () => ({
  GpsUsageChart: () => <div data-chart="uso" />,
  GpsIdleChart: () => <div data-chart="ralenti" />,
  GpsTripsChart: () => <div data-chart="viajes" />,
  GpsAlertsChart: () => <div data-chart="alertas" />,
}))

const { UsageSection, DrivingSection } = await import("./gps-sections")

const period: IndicatorPeriod = {
  from: "2026-11-01",
  to: "2026-11-10",
  granularity: "day",
  previous: { from: "2026-10-22", to: "2026-10-31" },
  isDefault: false,
  invalid: false,
}

const usage: GpsUsageIndicators = {
  fleetVehicles: 10,
  linkedVehicles: 8,
  vehiclesWithReadings: 6,
  vehiclesWithUse: 5,
  km: { current: 1_200, previous: 1_000 },
  hours: { current: 90, previous: 100 },
  readingDays: { current: 40, previous: 38 },
  buckets: [{ key: "2026-11-01", km: 1_200, hours: 90 }],
  byWorksite: [
    { worksiteId: "w1", name: "Faena 1", km: 800, hours: 50, vehicles: 3 },
    { worksiteId: "w2", name: "Faena 2", km: 400, hours: 40, vehicles: 2 },
  ],
  topByKm: [{ vehicleId: "v1", code: "KA-1", plate: "AA-0001", typeName: "Camión", worksiteId: "w1", worksiteName: "Faena 1", km: 800, hours: 0 }],
  topByHours: [{ vehicleId: "v2", code: "KA-2", plate: "BB-0002", typeName: "Cargadora", worksiteId: "w2", worksiteName: "Faena 2", km: 0, hours: 40 }],
}

const idle: GpsIdleIndicators = { months: [{ key: "2026-11", workingHours: 80, idleHours: 20 }], vehicles: 4, idlePct: 20, previousIdlePct: 25, workingHours: 80, idleHours: 20, operatingHours: { current: 100, previous: 90 } }
const driving: GpsDrivingIndicators = {
  coverageDays: { current: 10, previous: 9 },
  trips: { current: 12, previous: 10, km: 240 },
  tripBuckets: [{ key: "2026-11-01", trips: 12, km: 240 }],
  alertGranularity: "week",
  alertBuckets: [{ key: "2026-11-02", counts: { speeding: 3, harsh_driving: 1, pothole: 0, idle: 0, other: 0 } }],
  alertTotals: { speeding: 3, harsh_driving: 1, pothole: 0, idle: 0, other: 0 },
  speeding: { current: 3, previous: 1 },
  topSpeeding: [{ vehicleId: "v1", code: "KA-1", plate: "AA-0001", typeName: "Camión", count: 3 }],
}

const count = (html: string, needle: string) => html.split(needle).length - 1

describe("UsageSection", () => {
  const html = renderToStaticMarkup(<UsageSection usage={usage} period={period} />)

  it("pinta cuatro tiles, todos con enlace", () => {
    expect(count(html, "data-kpi-card")).toBe(4)
    expect(count(html, 'href="/flota/monitoreo"')).toBeGreaterThanOrEqual(2)
    expect(html).toContain("de 8 vinculados")
  })

  it("avisa la cobertura cuando no toda la flota informa", () => {
    expect(html).toContain("Lecturas GPS de 6 de 10 vehículos")
  })

  it("los rankings enlazan a la ficha del equipo", () => {
    expect(html).toContain('href="/flota/v1"')
    expect(html).toContain('href="/flota/v2"')
  })

  it("sin ningún dato dice qué hacer en vez de pintar ceros", () => {
    const empty = renderToStaticMarkup(<UsageSection usage={{ ...usage, linkedVehicles: 0, vehiclesWithReadings: 0, vehiclesWithUse: 0, km: { current: 0, previous: 0 }, hours: { current: 0, previous: 0 }, byWorksite: [], topByKm: [], topByHours: [] }} period={period} />)
    expect(count(empty, "data-kpi-card")).toBe(0)
    expect(empty).toContain("Aún no hay equipos con GPS vinculado")
    expect(empty).toContain("Vincular dispositivos")
  })

  it("compara con el período anterior sólo si éste tiene cobertura comparable", () => {
    expect(html).toContain("data-delta")
    const sparse = renderToStaticMarkup(<UsageSection usage={{ ...usage, readingDays: { current: 40, previous: 6 } }} period={period} />)
    expect(sparse).not.toContain("data-delta")
    expect(count(sparse, "Sin base comparable en el período anterior")).toBe(2) // km y horas
  })

  it("las celdas de gráficos no dejan una fila a medias en xl ni en 2xl", () => {
    // Con el ranking de faenas oculto, las celdas restantes se reparten solas.
    const two = renderToStaticMarkup(<UsageSection usage={{ ...usage, byWorksite: [usage.byWorksite[0]!] }} period={period} />)
    expect(two).not.toContain("Uso por faena")
    expect(two).toContain("xl:col-span-2 2xl:col-span-3") // el último ranking toma la fila entera, no queda solo al lado de un hueco
  })

  it("con una sola faena no dibuja el ranking de faenas", () => {
    const one = renderToStaticMarkup(<UsageSection usage={{ ...usage, byWorksite: [usage.byWorksite[0]!] }} period={period} />)
    expect(one).not.toContain("Uso por faena")
  })
})

describe("DrivingSection", () => {
  it("con todos los permisos pinta tres tiles y el vínculo a Motor en vacío", () => {
    const html = renderToStaticMarkup(<DrivingSection idle={idle} driving={driving} period={period} canViewIdle />)
    expect(count(html, "data-kpi-card")).toBe(3)
    expect(html).toContain("/combustibles/consumo/motor-en-vacio")
    expect(html).toContain("data-chart=\"ralenti\"")
    expect(html).toContain("data-chart=\"alertas\"")
  })

  it("sin base comparable en OnWay o VisionLink no muestra variaciones", () => {
    const html = renderToStaticMarkup(<DrivingSection idle={{ ...idle, operatingHours: { current: 100, previous: 10 } }} driving={{ ...driving, coverageDays: { current: 10, previous: 2 } }} period={period} canViewIdle />)
    expect(html).not.toContain("data-delta")
    expect(count(html, "Sin base comparable en el período anterior")).toBe(3)
  })

  it("sin permiso de combustibles no muestra el ralentí", () => {
    const html = renderToStaticMarkup(<DrivingSection idle={null} driving={driving} period={period} canViewIdle={false} />)
    expect(count(html, "data-kpi-card")).toBe(2)
    expect(html).not.toContain("data-chart=\"ralenti\"")
    expect(html).not.toContain("motor-en-vacio")
  })

  it("sin viajes, alertas ni ralentí dice qué significa", () => {
    const empty: GpsDrivingIndicators = { ...driving, trips: { current: 0, previous: 0, km: 0 }, tripBuckets: [], alertBuckets: [], alertTotals: { speeding: 0, harsh_driving: 0, pothole: 0, idle: 0, other: 0 }, speeding: { current: 0, previous: 0 }, topSpeeding: [] }
    const html = renderToStaticMarkup(<DrivingSection idle={{ ...idle, months: [], idlePct: null }} driving={empty} period={period} canViewIdle />)
    expect(count(html, "data-kpi-card")).toBe(0)
    expect(html).toContain("Sin viajes, alertas ni ralentí en este período")
  })
})
