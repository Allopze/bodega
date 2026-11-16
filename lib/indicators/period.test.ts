import { describe, expect, it } from "vitest"
import {
  bucketKey,
  bucketLabel,
  chartWindow,
  chartWindowCaption,
  defaultIndicatorRange,
  indicatorPeriodLabel,
  indicatorGranularity,
  isPartialBucket,
  listBuckets,
  previousRange,
  rangeLengthDays,
  resolveIndicatorPeriod,
} from "./period"

const TODAY = "2026-11-13"

describe("período de Indicadores", () => {
  it("sin parámetros usa este mes, como el Panel de combustible, y mide hasta hoy", () => {
    expect(defaultIndicatorRange(TODAY)).toEqual({ from: "2026-11-01", to: "2026-11-30" })
    const period = resolveIndicatorPeriod({}, TODAY)
    // El control muestra el mes completo («Noviembre 2026»); las consultas llegan hasta hoy.
    expect(period).toMatchObject({ from: "2026-11-01", to: TODAY, requested: { from: "2026-11-01", to: "2026-11-30" }, isDefault: true, invalid: false })
    expect(defaultIndicatorRange("2026-02-10")).toEqual({ from: "2026-02-01", to: "2026-02-28" })
  })

  it("lo que va del mes se compara con los mismos días del mes anterior, no con un mes entero", () => {
    expect(resolveIndicatorPeriod({}, TODAY).previous).toEqual({ from: "2026-10-01", to: "2026-10-13" })
    expect(previousRange("2026-10-01", "2026-10-31")).toEqual({ from: "2026-09-01", to: "2026-09-30" })
    expect(previousRange("2026-03-01", "2026-03-31")).toEqual({ from: "2026-02-01", to: "2026-02-28" })
    expect(previousRange("2026-01-01", "2026-01-15")).toEqual({ from: "2025-12-01", to: "2025-12-15" })
  })

  it("cualquier otro rango se compara con el anterior de igual largo", () => {
    expect(previousRange("2026-10-15", "2026-11-13")).toEqual({ from: "2026-09-15", to: "2026-10-14" })
    expect(rangeLengthDays("2026-09-15", "2026-10-14")).toBe(30)
  })

  it("los gráficos de evolución de un período corto muestran los seis meses que terminan en él", () => {
    const period = resolveIndicatorPeriod({}, TODAY)
    expect(period.chart).toEqual({ from: "2026-06-01", to: TODAY, granularity: "month", isHistory: true })
    expect(chartWindow({ from: "2026-01-01", to: "2026-01-31" })).toMatchObject({ from: "2025-08-01", isHistory: true })
    expect(chartWindowCaption(period.chart, () => "fechas")).toBe("Últimos 6 meses, hasta noviembre de 2026")
  })

  it("un período de tres meses o más es su propia ventana, con la granularidad por largo", () => {
    const window = chartWindow({ from: "2026-06-01", to: "2026-11-13" })
    expect(window).toEqual({ from: "2026-06-01", to: "2026-11-13", granularity: "month", isHistory: false })
    expect(chartWindowCaption(window, (range) => `${range.from} al ${range.to}`)).toBe("2026-06-01 al 2026-11-13")
    expect(chartWindow({ from: "2026-09-20", to: "2026-11-13" }).granularity).toBe("day")
  })

  it("nombra un mes completo como el control y cualquier otro rango por sus fechas", () => {
    expect(indicatorPeriodLabel({ from: "2026-11-01", to: "2026-11-30" }, () => "fechas")).toBe("Noviembre 2026")
    expect(indicatorPeriodLabel({ from: "2026-11-01", to: "2026-11-13" }, () => "fechas")).toBe("fechas")
  })

  it("toma el rango de la URL y deriva la granularidad por largo", () => {
    expect(resolveIndicatorPeriod({ desde: "2026-10-01", hasta: "2026-11-13" }, TODAY).granularity).toBe("day")
    expect(indicatorGranularity("2026-01-01", "2026-03-03")).toBe("day") // 62 días
    expect(indicatorGranularity("2026-01-01", "2026-03-04")).toBe("month") // 63 días
  })

  it("un rango invertido, una fecha imposible o uno que empieza en el futuro cae al por defecto y lo dice", () => {
    expect(resolveIndicatorPeriod({ desde: "2026-11-10", hasta: "2026-11-01" }, TODAY)).toMatchObject({ from: "2026-11-01", invalid: true })
    expect(resolveIndicatorPeriod({ desde: "2026-02-30", hasta: "2026-03-01" }, TODAY)).toMatchObject({ from: "2026-11-01", invalid: true })
    expect(resolveIndicatorPeriod({ desde: "2026-12-01", hasta: "2026-12-31" }, TODAY)).toMatchObject({ from: "2026-11-01", invalid: true })
  })

  it("un rango de más de cinco años cae al por defecto (no arma siglos de baldes)", () => {
    expect(resolveIndicatorPeriod({ desde: "1001-01-01", hasta: "9999-12-31" }, TODAY)).toMatchObject({ from: "2026-11-01", invalid: true })
    expect(resolveIndicatorPeriod({ desde: "2022-01-01", hasta: "2026-11-13" }, TODAY)).toMatchObject({ from: "2022-01-01", invalid: false })
  })

  it("lista baldes vacíos incluidos", () => {
    expect(listBuckets("2026-10-30", "2026-11-02", "day")).toEqual(["2026-10-30", "2026-10-31", "2026-11-01", "2026-11-02"])
    expect(listBuckets("2025-11-15", "2026-02-01", "month")).toEqual(["2025-11", "2025-12", "2026-01", "2026-02"])
  })

  it("rotula y marca el balde en curso", () => {
    expect(bucketKey("2026-11-13", "month")).toBe("2026-11")
    expect(bucketLabel("2026-11-03", "day")).toBe("3 nov")
    expect(bucketLabel("2026-09", "month")).toBe("sept 2026")
    expect(isPartialBucket("2026-11", "month", TODAY)).toBe(true)
    expect(isPartialBucket("2026-10", "month", TODAY)).toBe(false)
  })
})
