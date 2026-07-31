import { describe, expect, it } from "vitest"
import { buildOperationalPeriodComparison, getOperationalCalendarBounds } from "./operational-period-metrics"

describe("operational period metrics", () => {
  it("uses the Chile calendar month at a UTC month boundary", () => {
    const bounds = getOperationalCalendarBounds(new Date("2026-07-01T02:30:00.000Z"))

    expect(bounds.currentStart).toBe("2026-06-01T00:00:00.000Z")
    expect(bounds.currentEnd).toBe("2026-07-01T00:00:00.000Z")
    expect(bounds.previousStart).toBe("2026-05-01T00:00:00.000Z")
  })

  it("does not manufacture a comparison before there is historical coverage", () => {
    expect(buildOperationalPeriodComparison(4, 0, 0)).toEqual({ current: 4, previous: null })
    expect(buildOperationalPeriodComparison(4, 0, 2)).toEqual({ current: 4, previous: 0 })
  })

  // El alcance global del dashboard permite comparar trimestre y año, no sólo mes.
  describe("ventanas por período", () => {
    it("encuadra el trimestre que contiene al mes, no los últimos 3 meses", () => {
      // Mayo (mes 5) cae en el segundo trimestre: abril–junio.
      const bounds = getOperationalCalendarBounds(new Date("2026-05-20T12:00:00.000Z"), "trimestre")

      expect(bounds.currentStart).toBe("2026-04-01T00:00:00.000Z")
      expect(bounds.currentEnd).toBe("2026-07-01T00:00:00.000Z")
      expect(bounds.previousStart).toBe("2026-01-01T00:00:00.000Z")
      expect(bounds.previousEnd).toBe("2026-04-01T00:00:00.000Z")
    })

    it("cruza el año hacia atrás en el primer trimestre", () => {
      const bounds = getOperationalCalendarBounds(new Date("2026-02-10T12:00:00.000Z"), "trimestre")

      expect(bounds.currentStart).toBe("2026-01-01T00:00:00.000Z")
      expect(bounds.previousStart).toBe("2025-10-01T00:00:00.000Z")
      expect(bounds.previousEnd).toBe("2026-01-01T00:00:00.000Z")
    })

    it("encuadra el año calendario y lo compara con el anterior", () => {
      const bounds = getOperationalCalendarBounds(new Date("2026-09-15T12:00:00.000Z"), "anio")

      expect(bounds.currentStart).toBe("2026-01-01T00:00:00.000Z")
      expect(bounds.currentEnd).toBe("2027-01-01T00:00:00.000Z")
      expect(bounds.previousStart).toBe("2025-01-01T00:00:00.000Z")
      expect(bounds.previousEnd).toBe("2026-01-01T00:00:00.000Z")
    })

    it("resuelve el período en hora de Chile, igual que el mes", () => {
      // 1 de enero 02:30 UTC = 31 de diciembre en Chile: el año en curso es el
      // anterior. Es el mismo error de UTC que arregló D-06 para el mes.
      const bounds = getOperationalCalendarBounds(new Date("2027-01-01T02:30:00.000Z"), "anio")

      expect(bounds.currentStart).toBe("2026-01-01T00:00:00.000Z")
      expect(bounds.currentEnd).toBe("2027-01-01T00:00:00.000Z")
    })

    it("por defecto sigue siendo el mes", () => {
      const explicit = getOperationalCalendarBounds(new Date("2026-05-20T12:00:00.000Z"), "mes")
      const implicit = getOperationalCalendarBounds(new Date("2026-05-20T12:00:00.000Z"))

      expect(implicit).toEqual(explicit)
      expect(implicit.currentStart).toBe("2026-05-01T00:00:00.000Z")
    })
  })
})
