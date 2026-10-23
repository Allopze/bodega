import { describe, expect, it } from "vitest"
import {
  buildPerformanceGlossary,
  buildPerformanceStats,
  formatKpi,
  type PerformanceMetrics,
} from "./performance-stats"

const METRICS: PerformanceMetrics = {
  availabilityPercent: 95.5,
  mtbfHours: 450,
  mttrHours: 20.25,
  preventiveCompliancePercent: 92,
  downtimeHours: 140,
  backlog: 3,
  maintenanceCost: 500_000,
}

const ALL = { canViewFleet: true, canViewMaintenance: true, canViewCosts: true }

function keys(stats: ReturnType<typeof buildPerformanceStats>) {
  return stats.map((stat) => stat.key)
}

describe("buildPerformanceStats", () => {
  it("conserva todas las cifras que el panel mostraba antes, con las tres capacidades", () => {
    expect(keys(buildPerformanceStats(METRICS, ALL))).toEqual([
      "availability", "mtbf", "mttr", "preventive", "downtime", "period-backlog", "cost",
    ])
  })

  it("la disponibilidad es de Flota: sin flota:view no aparece", () => {
    expect(keys(buildPerformanceStats(METRICS, { ...ALL, canViewFleet: false }))).not.toContain("availability")
  })

  it("las cifras de mantención exigen mantenciones:view", () => {
    expect(keys(buildPerformanceStats(METRICS, { canViewFleet: true, canViewMaintenance: false, canViewCosts: true }))).toEqual(["availability"])
  })

  it("el costo exige además combustibles:view_costs", () => {
    expect(keys(buildPerformanceStats(METRICS, { ...ALL, canViewCosts: false }))).not.toContain("cost")
  })

  it("expande MTBF y MTTR en la etiqueta (A6)", () => {
    const stats = buildPerformanceStats(METRICS, ALL)
    expect(stats.find((s) => s.key === "mtbf")?.label).toContain("Tiempo entre fallas")
    expect(stats.find((s) => s.key === "mttr")?.label).toContain("Tiempo de reparación")
  })

  it("rotula el backlog como del período para no confundirlo con el tile de OT abiertas de hoy", () => {
    const backlog = buildPerformanceStats(METRICS, ALL).find((s) => s.key === "period-backlog")
    expect(backlog?.label).toBe("OT abiertas del período")
    expect(backlog?.value).toBe("3")
  })

  it("sin datos pinta «Sin datos» como texto, no 0", () => {
    const stats = buildPerformanceStats(
      { ...METRICS, availabilityPercent: null, mtbfHours: null, mttrHours: null, preventiveCompliancePercent: null },
      ALL,
    )
    for (const key of ["availability", "mtbf", "mttr", "preventive"]) {
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
    expect(at(60)).toMatchObject({ tone: "signal", hint: "Bajo 80%" })
  })

  it("el cumplimiento preventivo usa sus propios umbrales (70 y 90)", () => {
    const at = (preventiveCompliancePercent: number) =>
      buildPerformanceStats({ ...METRICS, preventiveCompliancePercent }, ALL).find((s) => s.key === "preventive")!
    expect(at(95)).not.toHaveProperty("hint")
    expect(at(80)).toMatchObject({ tone: "signal", hint: "Bajo 90%" })
    expect(at(0)).toMatchObject({ tone: "signal", hint: "Bajo 70%" })
  })

  it("un umbral exacto no alerta", () => {
    const stats = buildPerformanceStats({ ...METRICS, availabilityPercent: 90, preventiveCompliancePercent: 90 }, ALL)
    expect(stats.find((s) => s.key === "availability")).not.toHaveProperty("hint")
    expect(stats.find((s) => s.key === "preventive")).not.toHaveProperty("hint")
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
    expect(buildPerformanceGlossary(ALL).map((e) => e.key)).toEqual(["availability", "mtbf", "mttr", "preventive"])
    expect(buildPerformanceGlossary({ canViewFleet: true, canViewMaintenance: false }).map((e) => e.key)).toEqual(["availability"])
    expect(buildPerformanceGlossary({ canViewFleet: false, canViewMaintenance: false })).toEqual([])
  })

  it("expande las siglas en el término", () => {
    const terms = buildPerformanceGlossary(ALL).map((e) => e.term).join(" | ")
    expect(terms).toContain("Mean Time Between Failures")
    expect(terms).toContain("Mean Time To Repair")
  })
})
