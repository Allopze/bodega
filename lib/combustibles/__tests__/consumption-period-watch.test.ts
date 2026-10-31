import { describe, expect, it } from "vitest"
import { consumptionChartWindow } from "../consumption-period"
import { buildWatchItems } from "../consumption-watch"
import { describeFuelPeriod } from "../period/parse"
import type { ConsumptionAlert, PatenteRankingRow } from "../consumption-dashboard"

const resolve = (period: Parameters<typeof describeFuelPeriod>[0]) => describeFuelPeriod(period, "url", "2026-11-15")

describe("ventana de los gráficos mes a mes", () => {
  it("un mes muestra los últimos 6 meses terminando en ese mes, y lo dice", () => {
    const window = consumptionChartWindow(resolve({ kind: "month", year: 2026, month: 10 }))
    expect(window).toMatchObject({ from: "2026-05-01", to: "2026-10-31", isHistory: true })
    expect(window.monthKeys).toEqual(["2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10"])
  })

  it("una semana que cruza de mes termina donde termina la semana", () => {
    const window = consumptionChartWindow(resolve({ kind: "week", year: 2026, week: 44 }))
    expect(window.isHistory).toBe(true)
    expect(window.to).toBe("2026-11-01")
    expect(window.monthKeys.at(-1)).toBe("2026-11")
    expect(window.monthKeys).toHaveLength(6)
  })

  it("cruza el cambio de año sin perder meses", () => {
    const window = consumptionChartWindow(resolve({ kind: "month", year: 2026, month: 2 }))
    expect(window.monthKeys).toEqual(["2025-09", "2025-10", "2025-11", "2025-12", "2026-01", "2026-02"])
    expect(window.from).toBe("2025-09-01")
  })

  it("un trimestre o un año se dibujan tal cual, sin historia agregada", () => {
    const quarter = consumptionChartWindow(resolve({ kind: "quarter", year: 2026, quarter: 3 }))
    expect(quarter).toMatchObject({ from: "2026-07-01", to: "2026-09-30", isHistory: false })
    expect(quarter.monthKeys).toEqual(["2026-07", "2026-08", "2026-09"])
    expect(consumptionChartWindow(resolve({ kind: "year", year: 2025 })).monthKeys).toHaveLength(12)
  })

  it("un rango de menos de 3 meses se trata como un mes corto; uno largo, tal cual", () => {
    expect(consumptionChartWindow(resolve({ kind: "range", from: "2026-09-10", to: "2026-10-05" })).isHistory).toBe(true)
    const long = consumptionChartWindow(resolve({ kind: "range", from: "2026-04-01", to: "2026-10-05" }))
    expect(long.isHistory).toBe(false)
    expect(long.monthKeys).toHaveLength(7)
  })
})

describe("patentes para mirar", () => {
  const alert = (overrides: Partial<ConsumptionAlert>): ConsumptionAlert => ({
    type: "consumo_alto", severity: "medium", entityLabel: "KA-01 (AB1234)", reason: "Consumió 1.840 L", action: "Revisar", linkQuery: "patente=KA-01%20(AB1234)", ...overrides,
  })
  const ranking: PatenteRankingRow[] = [
    { patente: "KA-01 (AB1234)", filterPatente: "AB1234", cantidad: 1840, monto: null, transacciones: 4, vehicleId: "veh-1" },
    { patente: "ZZ9999", cantidad: 100, monto: null, transacciones: 31, vehicleId: null },
  ]

  it("una patente que es un equipo abre su ficha", () => {
    const [item] = buildWatchItems({ alerts: [alert({})], rankings: [ranking] })
    expect(item).toMatchObject({ href: "/combustibles/consumo/equipos/veh-1", hrefLabel: "Abrir la ficha del equipo", label: "KA-01 (AB1234)" })
  })

  it("una patente que no es un equipo filtra las tarjetas por la patente real", () => {
    const [item] = buildWatchItems({ alerts: [alert({ type: "transacciones_altas", entityLabel: "ZZ9999", linkQuery: "patente=ZZ9999" })], rankings: [ranking] })
    expect(item!.href).toBe("/combustibles/consumo/litros?seccion=tarjetas&patente=ZZ9999")
    expect(item!.hrefLabel).toBe("Ver sus tarjetas")
  })

  it("las patentes sin vincular van a «Por revisar»; la variación de gasto no lleva a ningún lado", () => {
    const items = buildWatchItems({
      alerts: [
        alert({ type: "sin_asociacion", entityLabel: "3 patente(s)", linkQuery: "asociacion=no" }),
        alert({ type: "variacion_fuerte", entityLabel: "Gasto total", linkQuery: "" }),
      ],
      rankings: [ranking],
    })
    expect(items[0]!.href).toBe("/combustibles/revisar?tipo=patente")
    expect(items[1]).toMatchObject({ href: null, hrefLabel: null })
  })

  it("respeta el límite y conserva el orden de las alertas", () => {
    const alerts = [alert({ entityLabel: "A" }), alert({ entityLabel: "B" }), alert({ entityLabel: "C" })]
    expect(buildWatchItems({ alerts, rankings: [], limit: 2 }).map((item) => item.label)).toEqual(["A", "B"])
  })

  it("sin alertas no hay nada que mirar", () => {
    expect(buildWatchItems({ alerts: [], rankings: [ranking] })).toEqual([])
  })
})
