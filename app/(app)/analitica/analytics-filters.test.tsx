// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/analitica",
  useSearchParams: () => new URLSearchParams(""),
}))
vi.mock("@/components/layout/header-context", () => ({ useWorksiteFilterPresence: () => {} }))
vi.mock("@/lib/hooks/use-url-filters", () => ({
  useUrlFilters: () => ({ setFilter: vi.fn(), clearFilters: vi.fn(), isPending: false }),
}))
// `normalizeAnalyticsFilters` vive junto a consultas a la base: aquí sólo se necesita su aritmética de fechas.
vi.mock("@/db", () => ({ db: {} }))
vi.mock("@/lib/auth/scope", () => ({ isGlobalRole: vi.fn(), visibleWorksiteIds: vi.fn() }))

import { defaultRangePresets } from "@/components/ui/period-control"
import { normalizeAnalyticsFilters } from "@/lib/services/analytics-module/helpers"
import { AnalyticsFiltersBar } from "./analytics-filters"

// 12:00 en Chile (UTC-3 en noviembre): el día civil es el 6 en cualquier huso del servidor.
const NOW = new Date("2026-11-06T15:00:00Z")
const TODAY = "2026-11-06"

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] })
  vi.setSystemTime(NOW)
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

function renderBar(filters: { fromDate: string; toDate: string }) {
  const defaults = normalizeAnalyticsFilters({}, NOW)
  return render(
    <AnalyticsFiltersBar
      filters={filters}
      defaultRange={{ from: defaults.fromDate, to: defaults.toDate }}
      worksites={[]}
      suppliers={[]}
      vehicles={[]}
    />,
  )
}
const openPanel = () => fireEvent.click(screen.getByRole("button", { name: /Cambiar período/ }))

describe("rango por defecto de Analítica", () => {
  it("es el acceso rápido «Últimos 30 días» del selector, no uno parecido", () => {
    const preset = defaultRangePresets(TODAY).find((candidate) => candidate.key === "30d")
    expect(preset).toBeDefined()
    const defaults = normalizeAnalyticsFilters({}, NOW)
    expect({ from: defaults.fromDate, to: defaults.toDate }).toEqual(preset?.period)
    // 30 días corridos con hoy incluido (no 31).
    expect(defaults).toMatchObject({ fromDate: "2026-10-08", toDate: TODAY })
  })

  it("sin parámetros, la pantalla abre con «Últimos 30 días» marcado y sin «Volver a…»", () => {
    const defaults = normalizeAnalyticsFilters({}, NOW)
    renderBar({ fromDate: defaults.fromDate, toDate: defaults.toDate })
    openPanel()
    expect(screen.getByRole("button", { name: "Últimos 30 días" })).toHaveAttribute("aria-pressed", "true")
    expect(screen.getByRole("button", { name: "Últimos 90 días" })).toHaveAttribute("aria-pressed", "false")
    expect(screen.queryByRole("button", { name: /^Volver a/ })).toBeNull()
    expect(screen.queryByRole("button", { name: "Limpiar filtros" })).toBeNull()
  })

  it("con otro rango, «Volver a los últimos 30 días» y «Limpiar filtros» aparecen", () => {
    renderBar({ fromDate: "2026-08-09", toDate: TODAY })
    openPanel()
    expect(screen.getByRole("button", { name: "Últimos 30 días" })).toHaveAttribute("aria-pressed", "false")
    expect(screen.getByRole("button", { name: "Volver a los últimos 30 días" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Limpiar filtros" })).toBeInTheDocument()
  })
})
