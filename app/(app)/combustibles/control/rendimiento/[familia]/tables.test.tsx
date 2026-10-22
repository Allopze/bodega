import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import type { EquipmentStatRow, WorksiteStatRow } from "@/lib/combustibles/control/queries/performance"
import type { LoadDetailRow } from "@/lib/combustibles/control/queries/performance-detail"
import { buildCrosstab } from "@/lib/combustibles/control/view-helpers"
import { OverviewCrosstab } from "../../_charts/overview-crosstab"
import { ReviewExclusionNote } from "../../_charts/performance-review-note"
import { LoadDetailTable } from "./load-detail-table"
import { EquipmentStatsTable, WorksiteStatsTable } from "./stats-tables"

const html = (node: React.ReactElement) => renderToStaticMarkup(node)

describe("tabla cruzada", () => {
  const crosstab = buildCrosstab([
    { worksiteId: "w1", worksiteName: "Faena 1", mediumId: "fsm-tct", mediumName: "TCT", mediumOrder: 1, liters: 1200 },
    { worksiteId: "w1", worksiteName: "Faena 1", mediumId: null, mediumName: null, mediumOrder: null, liters: 30 },
    { worksiteId: "w2", worksiteName: "Faena 2", mediumId: "fsm-tct", mediumName: "TCT", mediumOrder: 1, liters: 500 },
  ])

  it("muestra una columna por medio presente, el sin-medio rotulado, totales en negrita y «—» en celdas vacías", () => {
    const out = html(<OverviewCrosstab crosstab={crosstab} label="Litros" emptyText="vacío" />)
    expect(out).toContain("TCT")
    expect(out).toContain("Sin medio informado")
    expect(out).toContain("1.730") // total general es-CL
    expect(out).toMatch(/<td[^>]*font-bold[^>]*>1\.730<\/td>/)
    expect(out).toContain("—")
    expect(out).not.toContain("vacío")
  })

  it("sin filas explica qué hacer en vez de mostrar una tabla vacía", () => {
    const out = html(<OverviewCrosstab crosstab={buildCrosstab([])} label="Litros" emptyText="Prueba con el año completo" />)
    expect(out).toContain("Prueba con el año completo")
    expect(out).not.toContain("<table")
  })
})

describe("rendimiento por faena (R-02)", () => {
  const base: WorksiteStatRow = { worksiteId: "w", worksiteName: "Faena A", unit: "km_per_liter", n: 10, mean: 4, sd: 0.5, cv: 0.125 }

  it("dispersión normal: porcentaje sin alerta", () => {
    const out = html(<WorksiteStatsTable rows={[base]} />)
    expect(out).toContain("13 %")
    expect(out).not.toContain("Alta: sobre")
  })

  it("dispersión sobre 25 %: lo dice en texto, no solo en color", () => {
    const out = html(<WorksiteStatsTable rows={[{ ...base, sd: 1.5, cv: 0.375 }]} />)
    expect(out).toContain("Alta: sobre 25 %")
  })

  it("con una sola carga la desviación y la dispersión son «—»", () => {
    const out = html(<WorksiteStatsTable rows={[{ ...base, n: 1, sd: null, cv: null }]} />)
    expect(out.match(/—/g)?.length).toBeGreaterThanOrEqual(2)
  })

  it("la unidad lleva su nombre completo como title", () => {
    expect(html(<WorksiteStatsTable rows={[base]} />)).toContain("Kilómetros recorridos por litro")
  })
})

describe("rendimiento por equipo (R-03, R-06)", () => {
  const row: EquipmentStatRow = {
    vehicleId: "v1", worksiteName: "Faena A", code: "KA-01", plate: "AB1234", brand: "Volvo", model: "FH", equipmentType: "Camión", unit: "km_per_liter",
    n: 3, mean: 4, sd: 1, modelMean: 5, deltaModelPct: -20, historyMean: 6, deltaHistoryPct: -33.3, worseThanModel: true, worseThanHistory: true,
  }

  it("marca «Rinde peor» con texto y signo explícito", () => {
    const out = html(<EquipmentStatsTable rows={[row]} />)
    expect(out.match(/>Rinde peor</g)?.length).toBe(2)
    expect(out).toContain("−20 %")
  })

  it("sin comparación posible muestra «—» y no marca nada", () => {
    const out = html(<EquipmentStatsTable rows={[{ ...row, modelMean: null, deltaModelPct: null, worseThanModel: false, historyMean: null, deltaHistoryPct: null, worseThanHistory: false }]} />)
    expect(out).not.toContain(">Rinde peor<")
    expect(out.match(/—/g)?.length).toBeGreaterThanOrEqual(4)
  })
})

describe("detalle de cargas (R-05)", () => {
  const row: LoadDetailRow = {
    id: "l1", occurredAt: "2026-03-10T15:00:00Z", worksiteName: "Faena A", code: "KA-01", plate: "AB1234", meterType: "odometer", meterReading: 12345.6,
    unit: "km_per_liter", performanceValue: 3.5, performanceStatus: "computed", declaredPerformance: 9.9, liters: 40, supervisor: "Ana Pérez",
    reviewStatus: "flagged", source: "operations_import", mediumName: "TCT",
  }

  it("muestra el rendimiento calculado y el declarado aparte, con estado y origen en español", () => {
    const out = html(<LoadDetailTable rows={[row]} canViewPersonal />)
    expect(out).toContain("3,5")
    expect(out).toContain("9,9 km/L")
    expect(out).toContain("En revisión")
    expect(out).toContain("Planilla de cargas")
    expect(out).toContain("Ana Pérez")
    expect(out).toContain("12.345,6 km")
    expect(out).not.toContain("flagged")
  })

  it("sin rendimiento calculado muestra el estado en español, no un valor", () => {
    const out = html(<LoadDetailTable rows={[{ ...row, performanceStatus: "first_load", performanceValue: null }]} canViewPersonal />)
    expect(out).toContain("Primera carga del equipo")
  })

  it("sin permiso de datos personales el supervisor es «Reservado» aunque el dato no llegue", () => {
    const out = html(<LoadDetailTable rows={[{ ...row, supervisor: null }]} canViewPersonal={false} />)
    expect(out).toContain("Reservado")
    expect(out).not.toContain("Ana Pérez")
  })
})

describe("aviso de cargas en revisión", () => {
  it("dice cuántas quedan fuera del promedio y enlaza a la revisión", () => {
    const out = html(<ReviewExclusionNote count={3} href="/combustibles/control/revision?anio=2026" />)
    expect(out).toContain("cargas en revisión no entran")
    expect(out).toContain('href="/combustibles/control/revision?anio=2026"')
  })

  it("en singular y en cero", () => {
    expect(html(<ReviewExclusionNote count={1} href="/x" />)).toContain("carga en revisión no entra")
    expect(html(<ReviewExclusionNote count={0} href="/x" />)).toContain("Ninguna carga en revisión queda fuera")
  })
})
