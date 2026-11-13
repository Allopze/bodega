import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import type { EquipmentStatRow, WorksiteStatRow } from "@/lib/combustibles/control/queries/performance"
import type { LoadDetailRow } from "@/lib/combustibles/control/queries/performance-detail"
import { buildCrosstab } from "@/lib/combustibles/control/view-helpers"
import { OverviewCrosstab } from "../../_components/charts/overview-crosstab"
import { ReviewExclusionNote } from "../../_components/charts/performance-review-note"
import { LoadDetailTable } from "./load-detail-table"
import { EquipmentStatisticsTable, EquipmentStatsTable, WorksiteStatsTable } from "./stats-tables"
import { WorksiteRanking } from "./worksite-ranking"

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
    expect(out).toMatch(/<td[^>]*font-semibold[^>]*>1\.730<\/td>/)
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
    n: 3, mean: 4, sd: 1, cv: 0.25, modelMean: 5, deltaModelPct: -20, historyMean: 6, deltaHistoryPct: -33.3, worseThanModel: true, worseThanHistory: true,
  }

  it("marca «Rinde peor» una sola vez por equipo, con texto, signo explícito y contra qué se mide", () => {
    const out = html(<EquipmentStatsTable rows={[row]} />)
    expect(out.match(/>Rinde peor</g)?.length).toBe(1)
    expect(out).toContain("−20 %")
    expect(out).toContain("−33,3 %")
    expect(out).toContain("su modelo y su propio historial")
  })

  it("solo dice contra qué empeora cuando es una de las dos comparaciones", () => {
    const out = html(<EquipmentStatsTable rows={[{ ...row, worseThanHistory: false, deltaHistoryPct: -5 }]} />)
    expect(out).toContain("Rinde más de 10 % peor que su modelo")
    expect(out).not.toContain("su propio historial\"")
  })

  it("«parejo» o «irregular» en vez de la desviación estándar, que queda en los datos estadísticos", () => {
    const parejo = html(<EquipmentStatsTable rows={[{ ...row, cv: 0.07, worseThanModel: false, worseThanHistory: false }]} />)
    expect(parejo).toContain(">Parejo<")
    expect(parejo).not.toContain("Desv. estándar")
    const irregular = html(<EquipmentStatsTable rows={[{ ...row, cv: 0.31 }]} />)
    expect(irregular).toContain(">Irregular<")
    expect(irregular).not.toContain(">Parejo<")
  })

  it("con una sola carga no inventa «parejo»: dice «—» y por qué", () => {
    const out = html(<EquipmentStatsTable rows={[{ ...row, n: 1, sd: null, cv: null, worseThanModel: false, worseThanHistory: false }]} />)
    expect(out).not.toContain(">Parejo<")
    expect(out).not.toContain(">Irregular<")
    expect(out).toContain("Se necesitan 2 o más cargas válidas")
  })

  it("sin comparación posible muestra «—» y no marca nada", () => {
    const out = html(<EquipmentStatsTable rows={[{ ...row, modelMean: null, deltaModelPct: null, worseThanModel: false, historyMean: null, deltaHistoryPct: null, worseThanHistory: false }]} />)
    expect(out).not.toContain(">Rinde peor<")
    expect(out.match(/—/g)?.length).toBeGreaterThanOrEqual(4)
  })

  it("un equipo sin ninguna cifra no se lista como una fila de «—» y se dice cuántos quedaron fuera", () => {
    const empty: EquipmentStatRow = { ...row, vehicleId: "v2", code: "KA-02", plate: "CD5678", n: 0, mean: null, sd: null, cv: null, modelMean: null, deltaModelPct: null, historyMean: null, deltaHistoryPct: null, worseThanModel: false, worseThanHistory: false }
    const out = html(<EquipmentStatsTable rows={[row, empty]} />)
    expect(out).toContain("KA-01")
    expect(out).not.toContain("KA-02")
    expect(out).toContain("1 equipo de la lista no tiene rendimiento calculado y no se muestra aquí")
  })

  it("si ninguno tiene cifras explica por qué y ofrece quitar los filtros", () => {
    const empty: EquipmentStatRow = { ...row, mean: null, sd: null, cv: null, modelMean: null, deltaModelPct: null, historyMean: null, deltaHistoryPct: null, worseThanModel: false, worseThanHistory: false }
    const out = html(<EquipmentStatsTable rows={[empty]} clearFiltersHref="?periodo=2026-03" />)
    expect(out).toContain("Ningún equipo tiene rendimiento calculado")
    expect(out).not.toContain("<table")
    expect(out).toContain('href="?periodo=2026-03"')
    expect(out).toContain("Quitar filtros")
  })

  it("el código del equipo abre su ficha cuando se le da el enlace", () => {
    const out = html(<EquipmentStatsTable rows={[row]} equipmentHref={(id) => `/combustibles/consumo/equipos/${id}?periodo=2026-03`} />)
    expect(out).toContain('href="/combustibles/consumo/equipos/v1?periodo=2026-03"')
    expect(out).toContain(">KA-01<")
  })

  it("las cifras estadísticas siguen a mano: cargas, desviación estándar y variación", () => {
    const out = html(<EquipmentStatisticsTable rows={[row]} />)
    expect(out).toContain("Desv. estándar")
    expect(out).toContain("Variación (CV)")
    expect(out).toContain("25 %")
    expect(out).toContain("Volvo")
  })
})

describe("rendimiento por faena: ranking", () => {
  const rows: WorksiteStatRow[] = [
    { worksiteId: "wa", worksiteName: "Faena A", unit: "km_per_liter", n: 10, mean: 2.9, sd: 0.2, cv: 0.07 },
    { worksiteId: "wb", worksiteName: "Faena B", unit: "km_per_liter", n: 4, mean: 3.4, sd: 1.1, cv: 0.32 },
    { worksiteId: "wc", worksiteName: "Faena C", unit: "liters_per_hour", n: 1, mean: 15, sd: null, cv: null },
  ]

  it("un ranking por unidad (km/L y L/h no comparten escala), con «parejo» o «irregular» en texto", () => {
    const out = html(<WorksiteRanking rows={rows} />)
    expect(out).toContain("Promedio de rendimiento en km/L por faena")
    expect(out).toContain("Promedio de rendimiento en L/h por faena")
    expect(out).toContain("más es mejor")
    expect(out).toContain("menos es mejor")
    expect(out).toContain("Parejo · 10 cargas")
    expect(out).toContain("Irregular · 4 cargas")
    expect(out).toContain("Aún sin 2 cargas para saber si es parejo")
  })

  it("sin rendimientos por faena el vacío trae su acción", () => {
    const out = html(<WorksiteRanking rows={[]} clearFiltersHref="?periodo=2026-03" />)
    expect(out).toContain("Sin rendimientos calculados")
    expect(out).toContain('href="?periodo=2026-03"')
  })

  it("km/L pone la mejor faena arriba: más es mejor", () => {
    const out = html(<WorksiteRanking rows={rows.slice(0, 2)} />)
    expect(out.indexOf("Faena B")).toBeLessThan(out.indexOf("Faena A"))
  })

  it("cada faena puede enlazar al mismo filtro de la vista", () => {
    const out = html(<WorksiteRanking rows={rows.slice(0, 2)} hrefForWorksite={(id) => `?faena=${id}`} />)
    expect(out).toContain('href="?faena=wa"')
  })

  it("sin promedios explica qué hacer en vez de un ranking vacío", () => {
    const out = html(<WorksiteRanking rows={[]} />)
    expect(out).toContain("Sin rendimientos calculados")
    expect(out).toContain("Amplía el período")
  })
})

describe("detalle de cargas (R-05)", () => {
  const row: LoadDetailRow = {
    id: "l1", occurredAt: "2026-03-10T15:00:00Z", worksiteName: "Faena A", code: "KA-01", plate: "AB1234", meterType: "odometer", meterReading: 12345.6,
    unit: "km_per_liter", performanceValue: 3.5, performanceStatus: "computed", declaredPerformance: 9.9, liters: 40, supervisor: "Ana Pérez",
    reviewStatus: "flagged", source: "operations_import", mediumName: "TCT", href: "/combustibles/cargas/planilla/rec-1",
  }

  it("muestra el rendimiento calculado y el declarado aparte, con estado y origen en español", () => {
    const out = html(<LoadDetailTable rows={[row]} canViewPersonal />)
    expect(out).toContain("3,5")
    expect(out).toContain("9,9 km/L")
    expect(out).toContain("Por decidir")
    expect(out).not.toContain("En revisión")
    expect(out).toContain("Planilla de cargas")
    expect(out).toContain("Ana Pérez")
    expect(out).toContain("12.345,6 km")
    expect(out).not.toContain("flagged")
  })

  it("sin rendimiento calculado muestra el estado en español, no un valor", () => {
    const out = html(<LoadDetailTable rows={[{ ...row, performanceStatus: "first_load", performanceValue: null }]} canViewPersonal />)
    expect(out).toContain("Primera carga del equipo")
  })

  it("la fecha abre la ficha de la carga", () => {
    const out = html(<LoadDetailTable rows={[row]} canViewPersonal />)
    expect(out).toContain('href="/combustibles/cargas/planilla/rec-1"')
    expect(html(<LoadDetailTable rows={[{ ...row, href: null }]} canViewPersonal />)).not.toContain("/combustibles/cargas/planilla")
  })

  it("sin permiso de datos personales el supervisor es «Reservado» aunque el dato no llegue", () => {
    const out = html(<LoadDetailTable rows={[{ ...row, supervisor: null }]} canViewPersonal={false} />)
    expect(out).toContain("Reservado")
    expect(out).not.toContain("Ana Pérez")
  })
})

describe("aviso de cargas por decidir", () => {
  it("dice cuántas quedan fuera del promedio y enlaza a «Por revisar»", () => {
    const out = html(<ReviewExclusionNote count={3} href="/combustibles/revisar?tipo=carga" />)
    expect(out).toContain("cargas por decidir no entran")
    expect(out).toContain("al promedio")
    expect(out).toContain('href="/combustibles/revisar?tipo=carga"')
    expect(out).not.toContain("en revisión")
  })

  it("en singular y en cero", () => {
    expect(html(<ReviewExclusionNote count={1} href="/x" />)).toContain("carga por decidir no entra")
    expect(html(<ReviewExclusionNote count={0} href="/x" />)).toContain("Ninguna carga por decidir queda fuera del promedio")
  })
})
