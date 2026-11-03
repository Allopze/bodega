// @vitest-environment jsdom
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import type { PropsWithChildren } from "react"
import type { CanonicalIndicatorResult } from "@/lib/prevention/safety-indicators-calc"
import type { CanonicalIndicatorYearView } from "@/lib/services/prevention-indicadores"

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }))
vi.mock("next/link", () => ({
  default: ({ children, href, ...props }: PropsWithChildren<{ href: string }>) => <a href={href} {...props}>{children}</a>,
}))
vi.mock("@/components/ui/select", () => ({
  Select: ({ children }: PropsWithChildren) => <div>{children}</div>,
  SelectTrigger: ({ children }: PropsWithChildren) => <button type="button">{children}</button>,
  SelectValue: () => null,
  SelectContent: ({ children }: PropsWithChildren) => <div>{children}</div>,
  SelectItem: ({ children }: PropsWithChildren) => <div>{children}</div>,
}))
vi.mock("@/components/ui/tabs", () => ({
  Tabs: ({ children }: PropsWithChildren) => <div>{children}</div>,
  TabsList: ({ children }: PropsWithChildren) => <div>{children}</div>,
  TabsTrigger: ({ children }: PropsWithChildren) => <button type="button">{children}</button>,
  TabsContent: ({ children }: PropsWithChildren) => <div>{children}</div>,
}))
vi.mock("./indicator-denominator-dialog", () => ({
  IndicatorDenominatorDialog: ({ month }: { month: number }) => <button type="button" data-testid="denominator-dialog">Denominador mes {month}</button>,
  denominatorDialogLabel: () => "Registrar",
}))
vi.mock("./indicator-period-close-button", () => ({ IndicatorPeriodCloseButton: () => <button type="button">Cerrar período</button> }))

import { CanonicalIndicatorsDashboard } from "./canonical-indicators-dashboard"

afterEach(cleanup)

function result(month: number, overrides: Partial<CanonicalIndicatorResult> = {}): CanonicalIndicatorResult {
  const metrics = {
    accidents: 0,
    injuredPeople: 0,
    absenceDays: 0,
    chargeDays: 0,
    accidentabilityRate: null,
    frequencyRate: null,
    severityRate: null,
  }
  return {
    formulaVersion: "ds44-art73-2026-v3",
    year: 2026,
    startMonth: month,
    endMonth: month,
    status: "non_calculable",
    confirmed: metrics,
    provisional: metrics,
    workerAverage: 100,
    workedHours: 0,
    denominatorSlots: month === 1 ? 1 : 0,
    expectedDenominatorSlots: 1,
    pendingCaseCount: 0,
    errors: [],
    reconciliationIssues: [],
    incidentIds: [],
    personCaseKeys: [],
    denominatorIds: [],
    denominatorVersions: [],
    eventCounts: { incidents: 0, materialDamage: 0, environmentalDamage: 0 },
    sexBreakdown: [],
    ...overrides,
  }
}

const legacyComparison = {
  legacyId: null,
  status: "missing_legacy" as const,
  legacy: null,
  derived: { trabajadores: 100, horasHombre: 0, accConTiempoPerdido: 0, diasPerdidos: 0, incidentes: 0, danoMaterial: 0, danoAmbiental: 0 },
  differences: {},
}

function makeView(): CanonicalIndicatorYearView {
  const monthly = Array.from({ length: 12 }, (_, index) => ({ ...result(index + 1), legacyComparison }))
  return {
    year: 2026,
    groups: [{
      worksiteId: "ws-own",
      worksiteName: "Faena Norte",
      monthly,
      semesters: [result(1, { endMonth: 6 }), result(7, { endMonth: 12 })],
      annual: result(1, { startMonth: 1, endMonth: 12, sexBreakdown: [{ sex: "female", value: null, suppressed: true }, { sex: "unspecified", value: 6, suppressed: false }] }),
    }],
    denominators: [],
    closedPeriods: [],
    snapshots: [],
  } as unknown as CanonicalIndicatorYearView
}

describe("CanonicalIndicatorsDashboard", () => {
  it("shows non-calculable values, protected sex groups and source drill-down", () => {
    render(<CanonicalIndicatorsDashboard view={makeView()} currentYear={2026} canManage={false} canClose={false} currentUserId="user-1" />)

    expect(screen.getAllByText("No calculable").length).toBeGreaterThan(0)
    expect(screen.getByText("Oculto por grupo pequeño (<5)")).toBeDefined()
    // Etiquetas en español; la clave `unspecified` agrupa lo no registrado.
    expect(screen.getByText("Mujer:")).toBeDefined()
    expect(screen.getByText("Sin dato:")).toBeDefined()
    expect(screen.getByRole("link", { name: /Frecuencia · Enero/i })).toHaveAttribute(
      "href",
      "/prevencion/incidentes?year=2026&monthFrom=1&monthTo=1&indicator=frequency&worksiteId=ws-own",
    )
  })

  it("abre el primer mes sin HH desde el aviso accionable", () => {
    render(<CanonicalIndicatorsDashboard view={makeView()} currentYear={2026} canManage canClose={false} currentUserId="user-1" />)

    expect(screen.getByText("Sin denominadores cargados para 2026")).toBeDefined()
    fireEvent.click(screen.getByRole("button", { name: "Cargar dotación y HH" }))

    expect(screen.getByTestId("denominator-dialog")).toHaveTextContent("mes 1")
  })

  it("explica el dato faltante sin ofrecer edición a quien no puede gestionarlo", () => {
    render(<CanonicalIndicatorsDashboard view={makeView()} currentYear={2026} canManage={false} canClose={false} currentUserId="user-1" />)

    expect(screen.getByText(/Las tasas de frecuencia, gravedad y accidentabilidad/)).toBeDefined()
    expect(screen.queryByRole("button", { name: "Cargar dotación y HH" })).toBeNull()
  })

  /**
   * La columna "Acción" de la pestaña Denominadores no tenía gate de permiso
   * —a diferencia de la del cálculo mensual—, así que un usuario de sólo
   * lectura veía doce botones que abrían un modal sin formulario ni panel.
   */
  it("no ofrece la acción del denominador a quien sólo puede ver", () => {
    render(<CanonicalIndicatorsDashboard view={makeView()} currentYear={2026} canManage={false} canClose={false} currentUserId="user-1" />)

    expect(screen.queryByRole("button", { name: "Registrar" })).toBeNull()
    expect(screen.queryByRole("columnheader", { name: "Acción" })).toBeNull()
  })

  it("sí la ofrece a quien puede aprobar aunque no pueda gestionar", () => {
    render(<CanonicalIndicatorsDashboard view={makeView()} currentYear={2026} canManage={false} canClose currentUserId="user-1" />)

    expect(screen.getAllByRole("button", { name: "Registrar" }).length).toBeGreaterThan(0)
  })
})

/**
 * Fase 0.6 (AUDITORIA_VISUALIZACIONES_CHOME): sin ningún mes con denominadores,
 * el «mes vigente» salía de `new Date().getMonth()`, que mide en la zona de
 * quien renderiza (UTC en el servidor, la del navegador en el cliente). El 31 de
 * enero a las 23:00 de Chile ya es febrero en UTC: la tira mostraba «Febrero», y
 * en Nochevieja «Enero» del año siguiente con el semestre equivocado.
 */
describe("CanonicalIndicatorsDashboard — mes vigente sin denominadores", () => {
  let previousTz: string | undefined
  beforeAll(() => {
    previousTz = process.env.TZ
    process.env.TZ = "UTC"
  })
  afterAll(() => {
    if (previousTz === undefined) delete process.env.TZ
    else process.env.TZ = previousTz
  })
  afterEach(() => vi.useRealTimers())

  function viewWithoutDenominators(): CanonicalIndicatorYearView {
    const view = makeView()
    const group = view.groups[0]!
    group.monthly = group.monthly.map((item) => ({ ...item, denominatorSlots: 0 }))
    return view
  }

  it.each([
    // Chile 2026-01-31 23:00 (UTC-3); en UTC ya es 1 de febrero.
    ["2026-02-01T02:00:00Z", "Enero", "S1"],
    // Chile 2026-12-31 23:00 (UTC-3); en UTC ya es 1 de enero de 2027.
    ["2027-01-01T02:00:00Z", "Diciembre", "S2"],
  ])("a las 23:00 de Chile (%s) muestra %s y el semestre %s", (instant, month, semester) => {
    vi.useFakeTimers({ toFake: ["Date"] })
    vi.setSystemTime(new Date(instant))

    render(<CanonicalIndicatorsDashboard view={viewWithoutDenominators()} currentYear={2026} canManage={false} canClose={false} currentUserId="user-1" />)

    expect(screen.getByText(`Frecuencia · ${month}`)).toBeDefined()
    expect(screen.getByText(`Gravedad · ${semester}`)).toBeDefined()
  })
})
