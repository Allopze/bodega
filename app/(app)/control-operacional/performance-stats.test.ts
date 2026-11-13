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
  it("muestra sólo la disponibilidad con flota:view (la cobertura va en su aviso, no en una cifra aparte)", () => {
    expect(keys(buildPerformanceStats(METRICS, ALL))).toEqual(["availability"])
  })

  it("la tira es de tres cifras como máximo y no repite licencias ni canales de combustible", () => {
    const stats = keys(buildPerformanceStats({ ...METRICS, workshopHours: 10, mttrHours: 5 }, { canViewFleet: true, canViewWorkOrders: true }))
    expect(stats).toEqual(["availability", "workshop-hours", "mttr"])
    expect(stats).not.toContain("driver-licenses")
    expect(stats).not.toContain("tae-tct-coverage")
  })

  it("avisa un historial incompleto junto a la disponibilidad, sin pintar la cobertura como cifra", () => {
    const at = (stateCoveragePercent: number | null) =>
      buildPerformanceStats({ ...METRICS, availabilityPercent: 95, stateCoveragePercent }, ALL).find((s) => s.key === "availability")!
    expect(at(98)).not.toHaveProperty("hint")
    expect(at(null)).not.toHaveProperty("hint")
    expect(at(60)).toMatchObject({ hint: "historial al 60%" })
    expect(buildPerformanceStats({ ...METRICS, availabilityPercent: 85, stateCoveragePercent: 60 }, ALL)[0])
      .toMatchObject({ tone: "signal", hint: "Bajo 90% · historial al 60%" })
  })

  it("la disponibilidad es de Flota: sin flota:view no aparece", () => {
    expect(buildPerformanceStats(METRICS, { canViewFleet: false })).toEqual([])
  })

  it("no pinta cifras del módulo de mantenciones retirado", () => {
    const stats = keys(buildPerformanceStats(METRICS, { ...ALL, canViewWorkOrders: true }))
    for (const key of ["mtbf", "preventive", "plan-adherence", "downtime", "overdue-sla", "unassigned", "period-backlog", "cost"]) {
      expect(stats).not.toContain(key)
    }
  })

  it("las cifras de OT (horas en taller y tiempo de reparación) sólo se pintan con la capacidad de OT, sin depender de flota", () => {
    const withMetrics = { ...METRICS, workshopHours: 120.4, mttrHours: 36.25 }
    expect(keys(buildPerformanceStats(withMetrics, ALL))).not.toContain("workshop-hours")
    expect(keys(buildPerformanceStats(withMetrics, { canViewFleet: true, canViewWorkOrders: true })))
      .toEqual(["availability", "workshop-hours", "mttr"])
    expect(keys(buildPerformanceStats(withMetrics, { canViewFleet: false, canViewWorkOrders: true })))
      .toEqual(["workshop-hours", "mttr"])
  })

  it("formatea horas en taller y tiempo de reparación; 0 h es un dato y el MTTR sin reparaciones cerradas es «Sin datos»", () => {
    const stats = buildPerformanceStats({ ...METRICS, workshopHours: 0, mttrHours: null }, { canViewFleet: false, canViewWorkOrders: true })
    expect(stats.find((s) => s.key === "workshop-hours")).toMatchObject({ value: "0 h", valueKind: "number" })
    expect(stats.find((s) => s.key === "mttr")).toMatchObject({
      label: "Tiempo de reparación",
      value: "Sin datos",
      valueKind: "text",
      secondary: "Sin reparaciones cerradas en el período",
    })
    const measured = buildPerformanceStats({ ...METRICS, workshopHours: 120.4, mttrHours: 36.25 }, { canViewFleet: false, canViewWorkOrders: true })
    expect(measured.find((s) => s.key === "workshop-hours")).toMatchObject({ value: "120 h" })
    expect(measured.find((s) => s.key === "mttr")).toMatchObject({ value: "36,3 h", valueKind: "number" })
  })

  it("si no se pudo calcular el taller, dice «Sin datos» en vez de 0 h", () => {
    const stats = buildPerformanceStats({ ...METRICS, workshopHours: null, mttrHours: null }, { canViewFleet: false, canViewWorkOrders: true })
    expect(stats.find((s) => s.key === "workshop-hours")).toMatchObject({ value: "Sin datos", secondary: "No se pudo calcular" })
  })

  it("sin datos pinta «Sin datos» como texto, no 0", () => {
    const stats = buildPerformanceStats(
      { availabilityPercent: null, stateCoveragePercent: null },
      ALL,
    )
    const stat = stats.find((s) => s.key === "availability")!
    expect(stat.value).toBe("Sin datos")
    expect(stat.valueKind).toBe("text")
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
    expect(buildPerformanceGlossary(ALL).map((e) => e.key)).toEqual(["availability", "state-coverage", "gps-providers"])
    expect(buildPerformanceGlossary({ canViewFleet: false })).toEqual([])
  })

  it("define las fuentes GPS, el rendimiento y la estimación de mantención con sus capacidades", () => {
    expect(buildPerformanceGlossary({ canViewFleet: true, canViewFuel: true, canViewMaintenance: true }).map((e) => e.key))
      .toEqual(expect.arrayContaining(["gps-providers", "gps-performance", "gps-maintenance"]))
    expect(buildPerformanceGlossary({ canViewFleet: true, canViewFuel: true }).map((e) => e.key))
      .not.toContain("gps-maintenance")
  })

  it("no trae definiciones de mantenciones retiradas", () => {
    const keys = buildPerformanceGlossary({ canViewFleet: true, canViewInspections: true, canViewCapa: true, canViewFuel: true, canViewCosts: true, canViewWorkOrders: true }).map((e) => e.key)
    for (const key of ["mtbf", "preventive", "plan-adherence", "overdue-sla", "unassigned", "maintenance-cost"]) {
      expect(keys).not.toContain(key)
    }
  })

  it("no filtra jerga de implementación: ni columnas, ni rutas, ni siglas en inglés, ni sumatorias", () => {
    const all = buildPerformanceGlossary({
      canViewFleet: true, canViewInspections: true, canViewCapa: true, canViewFuel: true, canViewCosts: true,
      canViewWorkOrders: true, canViewPurchaseCosts: true, canViewTaeCoverage: true, canViewMaintenance: true,
    })
    const text = all.map((e) => `${e.term} ${e.definition}`).join("\n")
    expect(text).not.toMatch(/inspection_finding_id|\/flota\/|mean time|MTTR|Σ|TAE|TCT/)
    expect(all.find((e) => e.key === "mttr")!.term).toBe("Tiempo medio de reparación")
  })

  it("define horas en taller y tiempo de reparación sólo con la capacidad de OT", () => {
    expect(buildPerformanceGlossary(ALL).map((e) => e.key)).not.toContain("mttr")
    const entries = buildPerformanceGlossary({ canViewFleet: false, canViewWorkOrders: true })
    expect(entries.map((e) => e.key)).toEqual(["ot-maintenance-cost", "workshop-hours", "mttr"])
    expect(entries[2]!.definition).toContain("reparación cerradas")
  })

  it("define mano de obra, compras vinculadas y el costo total sólo con sus capacidades", () => {
    const keysOf = (permissions: Parameters<typeof buildPerformanceGlossary>[0]) => buildPerformanceGlossary(permissions).map((e) => e.key)

    // La mano de obra va con la capacidad de OT y ya no se llama «mantención»: los repuestos no están ahí.
    const labour = buildPerformanceGlossary({ canViewFleet: false, canViewWorkOrders: true }).find((e) => e.key === "ot-maintenance-cost")!
    expect(labour.term).toBe("Mano de obra / taller externo (OT)")
    expect(labour.definition).toContain("Los repuestos y servicios comprados por OC van en su propia cifra")
    expect(labour.definition).toContain("sin OT cerradas en el período marca $0")

    // Las compras vinculadas las abre purchasing:view, sin depender de OT ni de combustible.
    expect(keysOf({ canViewFleet: false, canViewPurchaseCosts: true })).toEqual(["vehicle-purchases"])
    expect(keysOf({ canViewFleet: false, canViewWorkOrders: true })).not.toContain("vehicle-purchases")
    const purchases = buildPerformanceGlossary({ canViewFleet: false, canViewPurchaseCosts: true })[0]!
    expect(purchases.term).toBe("Repuestos y servicios (OC)")
    expect(purchases.definition).toContain("excluyendo OC anuladas")

    // El costo total exige las tres series: OT, costos de combustible y compras.
    const total = { canViewFleet: false, canViewWorkOrders: true, canViewCosts: true }
    expect(keysOf(total)).not.toContain("ot-total-cost")
    expect(keysOf({ ...total, canViewPurchaseCosts: true })).toContain("ot-total-cost")
    expect(keysOf({ canViewFleet: false, canViewCosts: true, canViewPurchaseCosts: true })).not.toContain("ot-total-cost")
    const definition = buildPerformanceGlossary({ ...total, canViewPurchaseCosts: true }).find((e) => e.key === "ot-total-cost")!.definition
    expect(definition).toContain("Combustible del proveedor, mano de obra de OT cerradas y compras vinculadas")
    // Un equipo sin movimientos en una serie aporta $0; sólo una consulta fallida deja «—».
    expect(definition).toContain("aporta $0")
    expect(definition).toContain("no se pudo consultar")
  })
})
