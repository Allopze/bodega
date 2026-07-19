// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, render, screen } from "@testing-library/react"
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
vi.mock("./indicator-denominator-dialog", () => ({ IndicatorDenominatorDialog: () => <button type="button">Denominador</button> }))
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
    formulaVersion: "ds44-art73-2025-v1",
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

describe("CanonicalIndicatorsDashboard", () => {
  it("shows non-calculable values, protected sex groups and source drill-down", () => {
    const monthly = Array.from({ length: 12 }, (_, index) => ({ ...result(index + 1), legacyComparison }))
    const annual = result(1, {
      startMonth: 1,
      endMonth: 12,
      sexBreakdown: [{ sex: "F", value: null, suppressed: true }],
    })
    const view = {
      year: 2026,
      groups: [{
        worksiteId: "ws-own",
        worksiteName: "Faena Norte",
        monthly,
        semesters: [result(1, { endMonth: 6 }), result(7, { endMonth: 12 })],
        annual,
      }],
      denominators: [],
      closedPeriods: [],
      snapshots: [],
    } as unknown as CanonicalIndicatorYearView

    render(<CanonicalIndicatorsDashboard view={view} currentYear={2026} canManage={false} canClose={false} currentUserId="user-1" />)

    expect(screen.getAllByText("No calculable").length).toBeGreaterThan(0)
    expect(screen.getByText("Oculto por grupo pequeño (<5)")).toBeDefined()
    expect(screen.getByRole("link", { name: /Frecuencia · Enero/i })).toHaveAttribute(
      "href",
      "/prevencion/incidentes?year=2026&monthFrom=1&monthTo=1&indicator=frequency&worksiteId=ws-own",
    )
  })
})
