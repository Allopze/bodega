import { describe, expect, it } from "vitest"
import {
  buildPerformanceGlossary,
  buildPerformanceStats,
  formatKpi,
  type PerformanceMetrics,
} from "./performance-stats"

const METRICS: PerformanceMetrics = {
  availabilityPercent: 95.5,
  stateCoveragePercent: 98.5,
}

const ALL = { canViewFleet: true }

function keys(stats: ReturnType<typeof buildPerformanceStats>) {
  return stats.map((stat) => stat.key)
}

describe("buildPerformanceStats", () => {
  it("muestra disponibilidad y cobertura de estado con flota:view", () => {
    expect(keys(buildPerformanceStats(METRICS, ALL))).toEqual(["availability", "state-coverage"])
  })

  it("la disponibilidad es de Flota: sin flota:view no aparece", () => {
    expect(buildPerformanceStats(METRICS, { canViewFleet: false })).toEqual([])
  })

  it("no pinta cifras del módulo de mantenciones retirado", () => {
    const stats = keys(buildPerformanceStats(METRICS, ALL))
    for (const key of ["mtbf", "mttr", "preventive", "plan-adherence", "downtime", "overdue-sla", "unassigned", "period-backlog", "cost"]) {
      expect(stats).not.toContain(key)
    }
  })

  it("sin datos pinta «Sin datos» como texto, no 0", () => {
    const stats = buildPerformanceStats(
      { availabilityPercent: null, stateCoveragePercent: null },
      ALL,
    )
    for (const key of ["availability", "state-coverage"]) {
      const stat = stats.find((s) => s.key === key)!
      expect(stat.value).toBe("Sin datos")
      expect(stat.valueKind).toBe("text")
    }
  })

  it("marca bajo 90% con el umbral escrito, y más bajo todavía con el umbral crítico", () => {
    const at = (availabilityPercent: number) =>
      buildPerformanceStats({ ...METRICS, availabilityPercent }, ALL).find((s) => s.key === "availability")!
    expect(at(95)).not.toHaveProperty("tone")
    expect(at(95)).not.toHaveProperty("hint")
    expect(at(85)).toMatchObject({ tone: "signal", hint: "Bajo 90%" })
    expect(at(60)).toMatchObject({ tone: "danger", hint: "Bajo 80%" })
  })

  it("el rojo empieza justo bajo el umbral crítico: 80 es naranja y 79,9 es rojo", () => {
    const at = (availabilityPercent: number) =>
      buildPerformanceStats({ ...METRICS, availabilityPercent }, ALL).find((s) => s.key === "availability")!
    expect(at(80)).toMatchObject({ tone: "signal", hint: "Bajo 90%" })
    expect(at(79.9)).toMatchObject({ tone: "danger", hint: "Bajo 80%" })
  })

  it("el tono se pide también para el 0 %, que es el caso más grave y no debe quedar atenuado", () => {
    const stats = buildPerformanceStats({ ...METRICS, availabilityPercent: 0 }, ALL)
    expect(stats.find((s) => s.key === "availability")).toMatchObject({ tone: "danger", toneWhenZero: true })
  })

  it("una cifra sana no pide tono ni lo pide para el cero", () => {
    const stats = buildPerformanceStats(METRICS, ALL)
    expect(stats.find((s) => s.key === "availability")).not.toHaveProperty("toneWhenZero")
  })

  it("un umbral exacto no alerta", () => {
    const stats = buildPerformanceStats({ ...METRICS, availabilityPercent: 90 }, ALL)
    expect(stats.find((s) => s.key === "availability")).not.toHaveProperty("hint")
  })
})

describe("formatKpi", () => {
  it("formatea con el sufijo y la precisión pedidos", () => {
    expect(formatKpi(92.34, "%")).toBe("92,3%")
    expect(formatKpi(450.4, " h", 0)).toBe("450 h")
  })
  it("null es «Sin datos»", () => {
    expect(formatKpi(null, "%")).toBe("Sin datos")
  })
})

describe("buildPerformanceGlossary", () => {
  it("trae las definiciones de las cifras visibles y nada más", () => {
    expect(buildPerformanceGlossary(ALL).map((e) => e.key)).toEqual(["availability", "state-coverage"])
    expect(buildPerformanceGlossary({ canViewFleet: false })).toEqual([])
  })

  it("no trae definiciones de mantenciones retiradas", () => {
    const keys = buildPerformanceGlossary({ canViewFleet: true, canViewInspections: true, canViewCapa: true, canViewFuel: true, canViewCosts: true }).map((e) => e.key)
    for (const key of ["mtbf", "mttr", "preventive", "plan-adherence", "overdue-sla", "unassigned", "maintenance-cost"]) {
      expect(keys).not.toContain(key)
    }
  })
})
