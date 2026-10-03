import { describe, expect, it } from "vitest"
import {
  filterPortfolioRows, hasPortfolioFilters, parsePortfolioParams, pickCurrentMatrices, PORTFOLIO_SUMMARY_HREF, portfolioActionOrder,
  portfolioHref, portfolioStatusOf, portfolioSummary, type MiperPortfolioRow,
} from "./portfolio"

const m = (id: string, worksiteId: string, period: number | null, status = "draft", updatedAt = "2026-01-01T00:00:00.000Z") => ({ id, worksiteId, period, status, updatedAt })

describe("pickCurrentMatrices: qué MIPER representa a cada faena", () => {
  it("la no reemplazada de mayor período; la vigente aparte; las reemplazadas no cuentan", () => {
    const picks = pickCurrentMatrices([m("a-2025", "a", 2025, "superseded"), m("a-2026", "a", 2026, "published"), m("a-2027", "a", 2027), m("b-leg", "b", null, "published")])
    expect(picks.get("a")!.primary.id).toBe("a-2027")
    expect(picks.get("a")!.published?.id).toBe("a-2026")
    expect(picks.get("a")!.all.map((row) => row.id)).toEqual(["a-2027", "a-2026"])
    expect(picks.get("b")!.primary.id).toBe("b-leg")
    expect(picks.get("b")!.published?.id).toBe("b-leg")
  })

  it("sin período va al final; con empate, la modificada más reciente", () => {
    const picks = pickCurrentMatrices([
      m("leg", "a", null, "published", "2026-09-01T00:00:00.000Z"),
      m("re04", "a", 2026, "draft", "2026-01-01T00:00:00.000Z"),
      m("x-vieja", "x", null, "draft", "2026-01-01T00:00:00.000Z"),
      m("x-nueva", "x", null, "draft", "2026-05-01T00:00:00.000Z"),
    ])
    expect(picks.get("a")!.primary.id).toBe("re04")
    expect(picks.get("x")!.primary.id).toBe("x-nueva")
  })

  it("una faena con sólo MIPER reemplazadas no tiene MIPER", () => {
    expect(pickCurrentMatrices([m("z", "z", 2024, "superseded")]).has("z")).toBe(false)
  })

  it("las acciones se ofrecen en orden: la de la fila, la vigente y el resto, sin repetir", () => {
    const pick = pickCurrentMatrices([m("p", "a", 2026, "published"), m("d27", "a", 2027), m("d28", "a", 2028)]).get("a")!
    expect(portfolioActionOrder(pick).map((row) => row.id)).toEqual(["d28", "p", "d27"])
  })
})

describe("portfolioStatusOf", () => {
  it("cinco estados, en español en la UI", () => {
    expect(portfolioStatusOf(null)).toBe("sin_miper")
    expect(portfolioStatusOf({ status: "draft", reviewState: "none" })).toBe("borrador")
    expect(portfolioStatusOf({ status: "draft", reviewState: "in_review" })).toBe("en_revision")
    expect(portfolioStatusOf({ status: "published", reviewState: "pending_approval" })).toBe("en_revision")
    expect(portfolioStatusOf({ status: "published", reviewState: "observed" })).toBe("observada")
    expect(portfolioStatusOf({ status: "published", reviewState: "none" })).toBe("vigente")
  })
})

describe("URL de la portada", () => {
  const read = (query: string) => parsePortfolioParams(new URLSearchParams(query))

  it("lee vista, estado, sincontrol y faena; lo que no conoce no filtra", () => {
    expect(read("vista=mias&estado=con_miper&sincontrol=1&faena=ws-a")).toEqual({ vista: "mias", estado: "con_miper", sinControl: true, faena: "ws-a" })
    expect(read("vista=otra&estado=published&sincontrol=si")).toEqual({ vista: "todas", estado: null, sinControl: false, faena: null })
    expect(hasPortfolioFilters(read(""))).toBe(false)
    expect(hasPortfolioFilters(read("vista=mias"))).toBe(true)
  })

  it("enlaces viejos: ?tab=porhacer abre «mías»; ?tab=todas|resumen, la vista por defecto; `vista` manda sobre `tab`", () => {
    expect(read("tab=porhacer").vista).toBe("mias")
    expect(read("tab=todas").vista).toBe("todas")
    expect(read("tab=resumen").vista).toBe("todas")
    expect(read("tab=porhacer&vista=todas").vista).toBe("todas")
  })

  it("portfolioHref aplica el cambio y borra SIEMPRE el `tab` heredado", () => {
    expect(portfolioHref(new URLSearchParams("tab=porhacer&estado=borrador"), { vista: null })).toBe("/prevencion/miper?estado=borrador")
    expect(portfolioHref(new URLSearchParams("tab=porhacer"), { vista: "mias" })).toBe("/prevencion/miper?vista=mias")
    expect(portfolioHref(new URLSearchParams("estado=borrador"), { estado: "" })).toBe("/prevencion/miper")
    expect(portfolioHref(new URLSearchParams(""), { faena: "ws-a" }, "/otra")).toBe("/otra?faena=ws-a")
  })
})

const row = (overrides: Partial<MiperPortfolioRow>): MiperPortfolioRow => ({
  id: "ws", worksiteId: "ws", worksiteName: "Faena", worksiteActive: true,
  matrix: { id: "m", period: 2026, versionNumber: 1, label: "Vigente · v1", isLegacy: false }, vigente: null,
  status: "vigente", stateLabel: "Vigente · v1", headcount: 0, headcountSource: "ficha", updatedAt: "2026-10-01T00:00:00.000Z",
  completeness: { complete: 1, total: 1 }, importantCount: 0, intolerableCount: 0, criticalWithoutControl: 0,
  requiresMyAction: false, myActions: [], submittedByName: null, programProgress: null,
  ...overrides,
})
const ROWS = [
  row({ id: "a", worksiteId: "a", criticalWithoutControl: 2 }),
  row({ id: "b", worksiteId: "b", status: "en_revision", requiresMyAction: true }),
  row({ id: "c", worksiteId: "c", matrix: null, status: "sin_miper", stateLabel: "Sin MIPER", completeness: null }),
  row({ id: "d", worksiteId: "d", status: "borrador", criticalWithoutControl: 1, requiresMyAction: true }),
]

describe("filtros y franja de la portada", () => {
  const ids = (query: string) => filterPortfolioRows(ROWS, parsePortfolioParams(new URLSearchParams(query))).map((item) => item.id)

  it("filtra por vista, estado (incluido «Con MIPER»), sin control y faena", () => {
    expect(ids("")).toEqual(["a", "b", "c", "d"])
    expect(ids("vista=mias")).toEqual(["b", "d"])
    expect(ids("estado=con_miper")).toEqual(["a", "b", "d"])
    expect(ids("estado=sin_miper")).toEqual(["c"])
    expect(ids("estado=en_revision")).toEqual(["b"])
    expect(ids("sincontrol=1")).toEqual(["a", "d"])
    expect(ids("faena=c")).toEqual(["c"])
    expect(ids("vista=mias&sincontrol=1")).toEqual(["d"])
  })

  it("A1: cada cifra cuenta exactamente lo que muestra su destino", () => {
    const summary = portfolioSummary(ROWS)
    expect(summary).toEqual({ total: 4, withMiper: 3, inReview: 1, mine: 2, critical: 3 })
    const at = (href: string) => filterPortfolioRows(ROWS, parsePortfolioParams(new URL(href, "http://localhost").searchParams))
    expect(at(PORTFOLIO_SUMMARY_HREF.withMiper)).toHaveLength(summary.withMiper)
    expect(at(PORTFOLIO_SUMMARY_HREF.inReview)).toHaveLength(summary.inReview)
    expect(at(PORTFOLIO_SUMMARY_HREF.mine)).toHaveLength(summary.mine)
    expect(at(PORTFOLIO_SUMMARY_HREF.critical).reduce((total, item) => total + item.criticalWithoutControl, 0)).toBe(summary.critical)
    expect(PORTFOLIO_SUMMARY_HREF.critical).toBe("/prevencion/miper?sincontrol=1")
  })
})
