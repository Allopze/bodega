// @vitest-environment jsdom
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"
import type { IndicatorPeriod } from "@/lib/indicators/period"
import type { GpsDrivingIndicators, GpsIdleIndicators, GpsUsageIndicators } from "@/lib/services/fleet-gps-indicators"

// Los gráficos se cargan diferidos y sin SSR: aquí sólo importa la estructura de las secciones.
// Cada stub deja en el DOM la leyenda y la granularidad que recibió, para verificar de qué ventana vienen.
vi.mock("./gps-charts-lazy", () => ({
  GpsUsageChart: ({ description, granularity }: { description: string; granularity: string }) => <div data-chart="uso" data-granularity={granularity}>{description}</div>,
  GpsIdleChart: ({ description }: { description: string }) => <div data-chart="ralenti">{description}</div>,
  GpsTripsChart: ({ description, granularity }: { description: string; granularity: string }) => <div data-chart="viajes" data-granularity={granularity}>{description}</div>,
  GpsAlertsChart: ({ description }: { description: string }) => <div data-chart="alertas">{description}</div>,
}))

// Los rankings son gráficos de barras (recharts, diferido): aquí un stub con sus filas y enlaces.
vi.mock("@/components/charts/bar-ranking-chart-lazy", () => ({
  BarRankingChartLazy: ({ items, ariaLabel }: { items: Array<{ key: string; label: string; href?: string }>; ariaLabel: string }) => (
    <div data-chart="ranking" role="img" aria-label={ariaLabel}>
      {items.map((item) => (item.href ? <a key={item.key} href={item.href}>{item.label}</a> : <span key={item.key}>{item.label}</span>))}
    </div>
  ),
}))

const { UsageSection, DrivingSection } = await import("./gps-sections")

const period: IndicatorPeriod = {
  from: "2026-11-01",
  to: "2026-11-10",
  granularity: "day",
  previous: { from: "2026-10-22", to: "2026-10-31" },
  requested: { from: "2026-11-01", to: "2026-11-10" },
  chart: { from: "2026-11-01", to: "2026-11-10", granularity: "day", isHistory: false },
  isDefault: false,
  invalid: false,
}
// Un mes con los seis meses que terminan en él: los gráficos de evolución miran la ventana larga.
const periodWithHistory: IndicatorPeriod = {
  ...period,
  chart: { from: "2026-06-01", to: "2026-11-10", granularity: "month", isHistory: true },
}

const usage: GpsUsageIndicators = {
  fleetVehicles: 10,
  linkedVehicles: 8,
  vehiclesWithReadings: 6,
  vehiclesWithUse: 5,
  vehiclesWithKm: 1,
  vehiclesWithHours: 1,
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
  speedingVehicles: 1,
}

const count = (html: string, needle: string) => html.split(needle).length - 1

describe("UsageSection", () => {
  const html = renderToStaticMarkup(<UsageSection usage={usage} period={period} />)

  it("resume el período en una tira de cuatro cifras con enlace, sin tiles", () => {
    expect(count(html, "data-kpi-card")).toBe(0)
    expect(html).toContain("Km recorridos")
    expect(html).toContain("Horas de motor")
    expect(html).toContain("Equipos con uso")
    expect(html).toContain("Equipos sin lecturas")
    expect(count(html, 'href="/flota/monitoreo"')).toBeGreaterThanOrEqual(2)
    expect(count(html, 'href="/flota"')).toBeGreaterThanOrEqual(2)
    expect(html).toContain("de 8 con GPS")
  })

  it("los rankings son gráficos, no listas", () => {
    expect(count(html, 'data-chart="ranking"')).toBe(4) // faenas en km y en horas, equipos con más km, equipos con más horas
    expect(html).not.toContain("data-ranked-list")
  })

  it("una sola base para la sección: los vehículos con GPS (crítica 2026-11-15, paso 5)", () => {
    expect(html).toContain("8 de los 10 vehículos de la flota tienen GPS (Entel OnWay, Wialon o VisionLink): las cifras de esta sección son de ellos.")
    expect(html).toContain("Con GPS y sin lecturas en el período")
    expect(html).not.toContain("vinculados")
    const all = renderToStaticMarkup(<UsageSection usage={{ ...usage, fleetVehicles: 8 }} period={period} />)
    expect(all).not.toContain("vehículos de la flota tienen GPS")
  })

  it("los rankings dicen cuánto pesa el primero y si muestran a todos o a los primeros", () => {
    // 800 de 1.200 km son de KA-1, el único con km: «por equipo», no «los 1 primeros».
    expect(html).toContain("67%")
    expect(html).toContain("del recorrido es de KA-1")
    expect(html).toContain("Km recorridos por equipo · 01-11-2026 al 10-11-2026")
    expect(html).toContain("de las horas de motor son de KA-2")
    expect(html).not.toContain("lo hacen")
    const many = renderToStaticMarkup(<UsageSection usage={{ ...usage, vehiclesWithKm: 20 }} period={period} />)
    expect(many).toContain("Km recorridos, los 1 con más de 20 equipos · 01-11-2026 al 10-11-2026")
  })

  it("los rankings enlazan a la ficha del equipo", () => {
    expect(html).toContain('href="/flota/v1"')
    expect(html).toContain('href="/flota/v2"')
  })

  it("sin ningún dato dice qué hacer en vez de pintar ceros", () => {
    const empty = renderToStaticMarkup(<UsageSection usage={{ ...usage, linkedVehicles: 0, vehiclesWithReadings: 0, vehiclesWithUse: 0, km: { current: 0, previous: 0 }, hours: { current: 0, previous: 0 }, buckets: [], byWorksite: [], topByKm: [], topByHours: [] }} period={period} />)
    expect(count(empty, "data-kpi-card")).toBe(0)
    expect(empty).toContain("Aún no hay equipos con GPS vinculado")
    expect(empty).toContain("Vincular dispositivos")
  })

  it("compara con el período anterior sólo si éste tiene cobertura comparable", () => {
    expect(html).toContain("+20 % vs. período anterior") // km: 1.200 contra 1.000
    expect(html).toContain("-10 % vs. período anterior") // horas: 90 contra 100
    const sparse = renderToStaticMarkup(<UsageSection usage={{ ...usage, readingDays: { current: 40, previous: 6 } }} period={period} />)
    expect(sparse).not.toContain("vs. período anterior")
  })

  it("las celdas de gráficos no dejan una fila a medias en xl ni en 2xl", () => {
    // Con el ranking de faenas oculto, las celdas restantes se reparten solas.
    const two = renderToStaticMarkup(<UsageSection usage={{ ...usage, byWorksite: [usage.byWorksite[0]!] }} period={period} />)
    expect(two).not.toContain("Uso por faena")
    expect(two).toContain("xl:col-span-2 2xl:col-span-1") // el último gráfico cierra la fila de xl, no queda solo al lado de un hueco
  })

  it("«Uso por faena» trae km y horas de motor, un ranking por unidad", () => {
    // Sólo con km, una faena de grúas o cargadores (horas) no aparecía y la celda quedaba a medias (crítica 2026-11-15).
    expect(html).toContain("Km recorridos y horas de motor ·")
    expect(html).toContain(">Horas de motor</p>")
    const soloKm = renderToStaticMarkup(<UsageSection usage={{ ...usage, byWorksite: usage.byWorksite.map((row) => ({ ...row, hours: 0 })) }} period={period} />)
    expect(soloKm).not.toContain(">Horas de motor</p>")
  })

  it("con una sola faena no dibuja el ranking de faenas", () => {
    const one = renderToStaticMarkup(<UsageSection usage={{ ...usage, byWorksite: [usage.byWorksite[0]!] }} period={period} />)
    expect(one).not.toContain("Uso por faena")
  })
})

describe("UsageSection con la ventana del gráfico", () => {
  const monthly: GpsUsageIndicators = {
    ...usage,
    buckets: ["2026-06", "2026-07", "2026-08", "2026-09", "2026-10", "2026-11"].map((key) => ({ key, km: 100, hours: 10 })),
  }
  const html = renderToStaticMarkup(<UsageSection usage={monthly} period={periodWithHistory} />)

  it("la serie dice la ventana y su granularidad; los rankings, el período", () => {
    expect(html).toContain('data-chart="uso" data-granularity="month"')
    expect(html).toContain("Por mes · Últimos 6 meses, hasta noviembre de 2026")
    expect(html).toContain("Km recorridos y horas de motor · 01-11-2026 al 10-11-2026") // uso por faena: el período
    expect(html).toContain("Km recorridos por equipo · 01-11-2026 al 10-11-2026")
  })

  it("sin ventana larga la serie dice las fechas del período", () => {
    const plain = renderToStaticMarkup(<UsageSection usage={usage} period={period} />)
    expect(plain).toContain('data-chart="uso" data-granularity="day"')
    expect(plain).toContain("Por día · 01-11-2026 al 10-11-2026")
  })

  it("con el período sin uso pero historia en la serie, pinta la serie", () => {
    const quiet = renderToStaticMarkup(<UsageSection usage={{ ...monthly, km: { current: 0, previous: 0 }, hours: { current: 0, previous: 0 }, vehiclesWithReadings: 0, vehiclesWithUse: 0, byWorksite: [], topByKm: [], topByHours: [] }} period={periodWithHistory} />)
    expect(quiet).toContain('data-chart="uso"')
  })
})

describe("DrivingSection", () => {
  it("las series siguen a la ventana del gráfico y la leyenda lo dice", () => {
    const html = renderToStaticMarkup(<DrivingSection idle={idle} driving={driving} period={periodWithHistory} canViewIdle />)
    expect(html).toContain("Por mes · Últimos 6 meses, hasta noviembre de 2026 · telemetría VisionLink")
    expect(html).toContain('data-chart="viajes" data-granularity="month"')
    expect(html).toContain("Por mes · Últimos 6 meses, hasta noviembre de 2026 · Entel OnWay")
    expect(html).toContain("Por semana · Últimos 6 meses, hasta noviembre de 2026 · Entel OnWay · sin encendido")
    expect(html).toContain("Alertas de exceso de velocidad por equipo · 01-11-2026 al 10-11-2026") // el ranking, del período
  })

  it("con todos los permisos resume tres cifras en la tira, con el vínculo a Motor en vacío", () => {
    const html = renderToStaticMarkup(<DrivingSection idle={idle} driving={driving} period={period} canViewIdle />)
    expect(count(html, "data-kpi-card")).toBe(0)
    expect(html).toContain("% de horas de motor en vacío")
    expect(html).toContain("Viajes")
    expect(html).toContain("Excesos de velocidad")
    expect(html).toContain('href="/combustibles/consumo/motor-en-vacio"')
    expect(html).toContain("data-chart=\"ralenti\"")
    expect(html).toContain("data-chart=\"viajes\"")
    expect(html).toContain("data-chart=\"alertas\"")
    expect(html).toContain("data-chart=\"ranking\"") // equipos con más excesos
    expect(html).toContain('href="/flota/v1"')
  })

  it("sin base comparable en OnWay o VisionLink no muestra variaciones", () => {
    const html = renderToStaticMarkup(<DrivingSection idle={{ ...idle, operatingHours: { current: 100, previous: 10 } }} driving={{ ...driving, coverageDays: { current: 10, previous: 2 } }} period={period} canViewIdle />)
    expect(html).not.toContain("vs. período anterior")
  })

  it("sin permiso de combustibles no muestra el motor en vacío", () => {
    const html = renderToStaticMarkup(<DrivingSection idle={null} driving={driving} period={period} canViewIdle={false} />)
    expect(html).not.toContain("% de horas de motor en vacío")
    expect(html).toContain("Excesos de velocidad")
    expect(html).not.toContain("data-chart=\"ralenti\"")
    expect(html).not.toContain("motor-en-vacio")
  })

  it("sin viajes, alertas ni horas de motor dice qué significa", () => {
    const empty: GpsDrivingIndicators = { ...driving, trips: { current: 0, previous: 0, km: 0 }, tripBuckets: [], alertBuckets: [], alertTotals: { speeding: 0, harsh_driving: 0, pothole: 0, idle: 0, other: 0 }, speeding: { current: 0, previous: 0 }, topSpeeding: [] }
    const html = renderToStaticMarkup(<DrivingSection idle={{ ...idle, months: [], idlePct: null }} driving={empty} period={period} canViewIdle />)
    expect(count(html, "data-kpi-card")).toBe(0)
    expect(html).toContain("Sin viajes, alertas ni horas de motor en este período")
  })
})
