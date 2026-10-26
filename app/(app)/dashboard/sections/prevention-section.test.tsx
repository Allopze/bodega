// @vitest-environment jsdom

import { render, screen, within } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { ReactNode } from "react"
import type { Session } from "next-auth"

const getCapaDashboardCounts = vi.hoisted(() => vi.fn())
const getIncidentDashboardCounts = vi.hoisted(() => vi.fn())
const getLegalDashboard = vi.hoisted(() => vi.fn())
const getRiskDashboard = vi.hoisted(() => vi.fn())
const getCanonicalSafetyIndicatorYear = vi.hoisted(() => vi.fn())
const getMaterialEnvironmentalEvents = vi.hoisted(() => vi.fn())
const getPdtpComplianceIndicatorsForScope = vi.hoisted(() => vi.fn())
const getPdtpOperationalYears = vi.hoisted(() => vi.fn())
const loadPdtpComplianceSummary = vi.hoisted(() => vi.fn())

vi.mock("@/lib/services/prevention-capa", () => ({ getCapaDashboardCounts }))
vi.mock("@/lib/services/prevention-incidents", () => ({ getIncidentDashboardCounts }))
vi.mock("@/lib/services/prevention-risk-legal", () => ({ getLegalDashboard, getRiskDashboard }))
vi.mock("@/lib/services/prevention-indicadores", () => ({ getCanonicalSafetyIndicatorYear, getMaterialEnvironmentalEvents }))
vi.mock("@/lib/services/pdtp/compliance", () => ({ getPdtpComplianceIndicatorsForScope }))
vi.mock("@/lib/services/pdtp/operational-years", () => ({ getPdtpOperationalYears }))
// La tarjeta real se conserva (el test mira su lugar en el árbol); sólo se
// sustituye la carga, que es la que habla con la base.
vi.mock("../pdtp-compliance-card", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../pdtp-compliance-card")>()),
  loadPdtpComplianceSummary,
}))

import { EmptyState } from "@/components/ui/empty-state"
import { ChartSlot } from "@/components/ui/dashboard-panel"
import { KpiCard } from "@/components/ui/kpi-card"
import { RankedList } from "@/components/ui/ranked-list"
import { PreventionSection } from "./prevention-section"
import type { DomainSectionsProps } from "./shared"

const scope = { worksiteId: "all", worksiteName: null, period: "mes", view: "prevencion" } as const

const ALL_PERMISSIONS = [
  "prevention:pdtp:view",
  "prevention:legal:view",
  "prevention:risk:view",
  "prevention:capa:view",
  "prevention:incidents:view",
]

function props(permissions: string[] = ALL_PERMISSIONS): DomainSectionsProps {
  return {
    session: { user: { id: "u1", permissions, isGlobal: true, worksiteIds: [] } } as unknown as Session,
    scope,
    worksiteScope: { mode: "all", ids: [] },
    pdtpScope: "all",
    worksiteIds: ["ws-0", "ws-1"],
    currentYear: 2026,
    moduleWorkload: [],
    queueTotal: 0,
  }
}

type Element = { type: unknown; props: Record<string, unknown> }

/** Recorre un árbol React sin renderizarlo, incluidas las props que llevan nodos (`action`, `headline`). */
function find(node: unknown, match: (element: Element) => boolean, result: Element[] = []): Element[] {
  if (Array.isArray(node)) {
    node.forEach((child) => find(child, match, result))
    return result
  }
  if (!node || typeof node !== "object" || !("props" in node) || !("type" in node)) return result
  const element = node as Element
  if (match(element)) result.push(element)
  Object.values(element.props).forEach((value) => find(value, match, result))
  return result
}

const ofType = (type: unknown) => (element: Element) => element.type === type

function sectionProps(section: unknown) {
  return (section as { props: { kpis: ReactNode; summary: ReactNode; charts: ReactNode } }).props
}

function pdtpIndicators(entries: Array<{ worksiteId: string; percent: number | null; executed: number; planned: number }>) {
  return {
    annual: { percent: 0, planned: 0, executed: 0 },
    perWorksite: entries.map((entry) => ({
      worksiteId: entry.worksiteId,
      indicators: { annual: { percent: entry.percent, executed: entry.executed, planned: entry.planned } },
    })),
  }
}

const pdtpSummary = (pendingCount: number) => ({
  year: 2026, closingYear: null, worksiteId: undefined, worksiteCount: 2, pendingCount, target: 0.9,
  percent: 0, integralPercent: null, planned: 2228, executed: 1, expectedPercent: 0.58, variancePercent: -58,
  lastExecutionUpdatedAt: null, month: 10, week: 2, versionLabels: ["v1", "v2"],
})

beforeEach(() => {
  vi.clearAllMocks()
  getCapaDashboardCounts.mockResolvedValue({ open: 4, overdue: 2, pendingVerification: 0, unreconciled: 0 })
  getIncidentDashboardCounts.mockResolvedValue({ totalOpen: 0, overdueNotifications: 0, fatalOrSerious: 0, pendingInvestigation: 0 })
  getLegalDashboard.mockResolvedValue({ counts: { applicable: 0, gaps: 0 }, worksites: [{ id: "ws-0", name: "Faena Cero" }] })
  getRiskDashboard.mockResolvedValue({
    criticalBlockers: [],
    coverage: { activeProcesses: 17, coveredProcesses: 0, activePositions: 6, coveredPositions: 0 },
    worksites: [],
  })
  getCanonicalSafetyIndicatorYear.mockResolvedValue(null)
  getMaterialEnvironmentalEvents.mockResolvedValue(null)
  getPdtpOperationalYears.mockResolvedValue({ primary: 2026, closing: null })
  getPdtpComplianceIndicatorsForScope.mockResolvedValue(pdtpIndicators([
    { worksiteId: "ws-0", percent: 0, executed: 0, planned: 40 },
    { worksiteId: "ws-1", percent: 0, executed: 0, planned: 30 },
  ]))
  loadPdtpComplianceSummary.mockResolvedValue(pdtpSummary(25))
})

describe("PreventionSection · PDTP por faena", () => {
  // A4: un ranking con todas las barras en cero no compara nada. Debe decir qué
  // significa, qué hacer y ofrecer un botón real.
  it("con todas las faenas en 0 % muestra un estado vacío con acción en vez del ranking", async () => {
    const { charts } = sectionProps(await PreventionSection(props()))

    const empties = find(charts, ofType(EmptyState))
    expect(empties).toHaveLength(1)
    expect(empties[0]!.props.title).toBe("Ninguna faena tiene avance acreditado en 2026")
    // Con aprobaciones pendientes el estado vacío las menciona (dato que ya se cargó).
    expect(empties[0]!.props.description).toContain("25 actividades esperando aprobación")

    // Sin el ranking: ninguna lista del PDTP por faena en el panel de gráficos.
    const lists = find(charts, ofType(RankedList)).filter((list) => list.props.ariaLabel === "Cumplimiento del PDTP por faena")
    expect(lists).toHaveLength(0)

    // La acción es un enlace real; sin permiso de aprobar va a las actividades.
    const href = find(empties[0]!.props.action, (element) => typeof element.props.href === "string")[0]?.props.href
    expect(href).toBe("/prevencion/pdtp/actividades")
  })

  it("un aprobador con pendientes va directo a la bandeja de aprobaciones", async () => {
    const { charts } = sectionProps(await PreventionSection(props([...ALL_PERMISSIONS, "prevention:pdtp:approve"])))

    const empty = find(charts, ofType(EmptyState))[0]!
    const link = find(empty.props.action, (element) => typeof element.props.href === "string")[0]!
    expect(link.props.href).toBe("/prevencion/pdtp/aprobaciones")
    expect(link.props.children).toBe("Revisar las 25 por aprobar")
  })

  // El ranking anterior cortaba con `slice(-8)` tras ordenar y la faena peor
  // podía quedar fuera. Ahora la sección entrega TODAS las filas y delega el
  // orden "peor primero" y el "y N más" a `RankedList`.
  it("con más de 8 faenas entrega todas las filas, incluida la peor, a un ranking por umbral", async () => {
    const entries = Array.from({ length: 10 }, (_, index) => ({
      worksiteId: `ws-${index}`, percent: index === 4 ? 0 : 0.6 + index / 100, executed: 10 + index, planned: 20,
    }))
    getPdtpComplianceIndicatorsForScope.mockResolvedValue(pdtpIndicators(entries))
    getLegalDashboard.mockResolvedValue({
      counts: { applicable: 0, gaps: 0 },
      worksites: entries.map((entry, index) => ({ id: entry.worksiteId, name: `Faena ${index}` })),
    })

    const { charts } = sectionProps(await PreventionSection(props()))
    const list = find(charts, ofType(RankedList)).find((element) => element.props.ariaLabel === "Cumplimiento del PDTP por faena")!

    expect(find(charts, ofType(EmptyState))).toHaveLength(0)
    expect(list.props.mode).toBe("threshold")
    // Los mismos umbrales que usaba el gráfico anterior: 80 verde, 50 ámbar.
    expect(list.props.thresholds).toEqual({ good: 80, warn: 50 })
    const items = list.props.items as Array<{ key: string; label: string; value: number; detail: string }>
    expect(items).toHaveLength(10)
    expect(items.find((item) => item.label === "Faena 4")).toMatchObject({ value: 0, detail: "14 de 20" })
    // Lo que no cabe se resume con un enlace, no se descarta en silencio.
    expect(list.props.moreHref).toBe("/prevencion/pdtp?anio=2026")
  })
})

describe("PreventionSection · contrato del panel", () => {
  it("cada gráfico y cada tarjeta de cobertura va en un ChartSlot, sin contenedores sueltos", async () => {
    const { charts } = sectionProps(await PreventionSection(props()))
    const children = (charts as { props: { children: unknown[] } }).props.children.flat().filter(Boolean) as Element[]

    expect(children.length).toBeGreaterThan(0)
    // Un `div xl:col-span-2` alrededor de un gráfico que devuelve null dejaba un
    // hueco de dos columnas; el slot se oculta solo (`empty:hidden`).
    for (const child of children) expect(child.type).toBe(ChartSlot)
  })

  it("todos los tiles llevan la variante del tablero (cifra sans, celda plana)", async () => {
    const { kpis } = sectionProps(await PreventionSection(props()))
    const tiles = find(kpis, ofType(KpiCard))

    expect(tiles.length).toBeGreaterThanOrEqual(4)
    for (const tile of tiles) expect(tile.props).toMatchObject({ numerals: "sans", surface: "flat" })
  })

  it("la cobertura MIPER es un ranking por umbral con 'X de Y'", async () => {
    const { charts } = sectionProps(await PreventionSection(props()))
    const list = find(charts, ofType(RankedList)).find((element) => element.props.ariaLabel === "Cobertura de la matriz de riesgos por procesos y cargos")!

    expect(list.props.mode).toBe("threshold")
    expect(list.props.items).toEqual([
      expect.objectContaining({ label: "Procesos", value: 0, detail: "0 de 17" }),
      expect.objectContaining({ label: "Cargos", value: 0, detail: "0 de 6" }),
    ])
  })
})

describe("PreventionSection · tiles y bloques sin dato", () => {
  it("sin programa PDTP el tile dice qué falta y lleva a crearlo si el rol puede gestionarlo", async () => {
    getPdtpComplianceIndicatorsForScope.mockResolvedValue(null)
    const { kpis } = sectionProps(await PreventionSection(props([...ALL_PERMISSIONS, "prevention:pdtp:program:manage"])))
    const tile = find(kpis, ofType(KpiCard)).find((element) => element.props.label === "Cumplimiento PDTP")!

    expect(tile.props.empty).toEqual({ message: "Aún no hay un programa activo", actionLabel: "Crear el programa" })
    expect(tile.props.href).toBe("/prevencion/pdtp/nuevo")
  })

  it("sin permiso de ver el PDTP no hay tile: ni un '—' ni un enlace a un 403", async () => {
    const { kpis } = sectionProps(await PreventionSection(props(ALL_PERMISSIONS.filter((permission) => permission !== "prevention:pdtp:view"))))

    expect(find(kpis, ofType(KpiCard)).map((tile) => tile.props.label)).not.toContain("Cumplimiento PDTP")
  })

  it("sin requisitos evaluados el cumplimiento legal ofrece evaluarlos en vez de mostrar '—'", async () => {
    const { summary } = sectionProps(await PreventionSection(props()))
    const empty = find(summary, ofType(EmptyState))[0]!
    const link = find(empty.props.action, (element) => typeof element.props.href === "string")[0]!

    expect(empty.props.title).toBe("Aún no hay requisitos evaluados")
    expect(link.props.href).toBe("/prevencion/requisitos-legales")
    expect(link.props.children).toBe("Evaluar requisitos")
  })

  it("con requisitos evaluados muestra el porcentaje y no el estado vacío", async () => {
    getLegalDashboard.mockResolvedValue({ counts: { applicable: 40, gaps: 10 }, worksites: [] })
    const { summary } = sectionProps(await PreventionSection(props()))

    expect(find(summary, ofType(EmptyState))).toHaveLength(0)
    const values = find(summary, (element) => typeof element.props.children === "object" && Array.isArray(element.props.children) && element.props.children[0] === 75)
    expect(values.length).toBeGreaterThan(0)
  })
})

// Lo anterior inspecciona el árbol de elementos; esto lo renderiza de verdad,
// con el `RankedList` real, porque el defecto original (la peor faena fuera del
// recorte) sólo existe en la composición de los dos.
describe("PreventionSection · renderizada", () => {
  it("con más de 8 faenas la peor sigue visible, primera, y lo que no cabe se resume con un enlace", async () => {
    const entries = Array.from({ length: 10 }, (_, index) => ({
      worksiteId: `ws-${index}`, percent: index === 4 ? 0.05 : 0.6 + index / 100, executed: 10 + index, planned: 20,
    }))
    getPdtpComplianceIndicatorsForScope.mockResolvedValue(pdtpIndicators(entries))
    getLegalDashboard.mockResolvedValue({
      counts: { applicable: 0, gaps: 0 },
      worksites: entries.map((entry, index) => ({ id: entry.worksiteId, name: `Faena ${index}` })),
    })

    render(await PreventionSection(props()))
    const list = screen.getByRole("list", { name: "Cumplimiento del PDTP por faena" })
    const rows = within(list).getAllByRole("listitem")

    expect(rows).toHaveLength(8)
    // Peor primero: la faena con 5 % abre la lista (con `slice(-8)` desaparecía).
    expect(within(rows[0]!).getByText("Faena 4")).toBeDefined()
    expect(within(rows[0]!).getByText("14 de 20")).toBeDefined()
    // Dos filas quedan fuera y se dice cuántas, con un enlace al programa.
    const more = screen.getByRole("link", { name: "y 2 más" })
    expect(more.getAttribute("href")).toBe("/prevencion/pdtp?anio=2026")
  })

  it("con todas las faenas en 0 % renderiza el estado vacío con su botón y ninguna lista", async () => {
    render(await PreventionSection(props([...ALL_PERMISSIONS, "prevention:pdtp:approve"])))

    expect(screen.getByText("Ninguna faena tiene avance acreditado en 2026")).toBeDefined()
    expect(screen.getByRole("link", { name: "Revisar las 25 por aprobar" }).getAttribute("href")).toBe("/prevencion/pdtp/aprobaciones")
    expect(screen.queryByRole("list", { name: "Cumplimiento del PDTP por faena" })).toBeNull()
    // El título del bloque sigue ahí: el estado vacío no borra de qué se trata.
    expect(screen.getByRole("heading", { level: 3, name: "Cumplimiento del PDTP por faena" })).toBeDefined()
  })

  it("el cumplimiento legal vacío y la tarjeta del PDTP comparten el panel de resumen", async () => {
    render(await PreventionSection(props()))

    expect(screen.getByRole("link", { name: "Evaluar requisitos" }).getAttribute("href")).toBe("/prevencion/requisitos-legales")
    expect(screen.getByRole("heading", { level: 3, name: "PDTP 2026" })).toBeDefined()
    const panels = document.querySelectorAll("[data-dashboard-panel]")
    // KPIs, resumen (PDTP + legal) y gráficos: tres paneles, no tarjetas sueltas.
    expect(panels).toHaveLength(3)
  })
})
