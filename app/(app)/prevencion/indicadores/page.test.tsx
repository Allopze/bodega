/**
 * Fase 0.6 (AUDITORIA_VISUALIZACIONES_CHOME): el año por defecto de «Indicadores»
 * salía de `new Date().getFullYear()`, que mide en la zona del proceso. El
 * servidor de producción corre en UTC: desde las 21:00 del 31 de diciembre
 * chileno ya es 1 de enero allí, y la página abría el año siguiente (vacío) en
 * vez del año que el equipo todavía está cerrando.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({ indicatorYear: vi.fn() }))

vi.mock("next/navigation", () => ({ redirect: (href: string) => { throw new Error(`redirect:${href}`) } }))
vi.mock("@/db", () => ({ db: {} }))
vi.mock("@/lib/auth/can", () => ({
  requireAuth: async () => ({ user: { id: "u-1", permissions: ["prevention:indicadores:view"] } }),
  can: () => true,
}))
vi.mock("@/lib/auth/scope", () => ({ resolveWorksiteScope: () => ({ mode: "all", ids: [] }) }))
vi.mock("@/lib/services/prevention-indicadores", () => ({ getCanonicalSafetyIndicatorYear: mocks.indicatorYear }))
vi.mock("@/components/ui/page-header", () => ({ PageHeader: () => null, Breadcrumbs: () => null }))
vi.mock("@/components/prevention/pdtp-scheduled-activity-panel-server", () => ({ PdtpScheduledActivityPanelServer: () => null }))
vi.mock("./indicadores-export-button", () => ({ ExportIndicadoresButton: () => null }))
vi.mock("./canonical-indicators-dashboard", () => ({ CanonicalIndicatorsDashboard: () => null }))

import IndicadoresPage from "./page"

/** 23:00 del 31 de diciembre en Chile (UTC-3): en UTC ya es 1 de enero de 2027. */
const NOCHEVIEJA_CHILE = "2027-01-01T02:00:00Z"

let previousTz: string | undefined
beforeAll(() => {
  // El servidor de producción corre en UTC; la zona del proceso es la que mide `getFullYear()`.
  previousTz = process.env.TZ
  process.env.TZ = "UTC"
})
afterAll(() => {
  if (previousTz === undefined) delete process.env.TZ
  else process.env.TZ = previousTz
})

beforeEach(() => {
  mocks.indicatorYear.mockResolvedValue({ year: 2026, groups: [], denominators: [], closedPeriods: [], snapshots: [] })
  vi.useFakeTimers({ toFake: ["Date"] })
  vi.setSystemTime(new Date(NOCHEVIEJA_CHILE))
})
afterEach(() => {
  vi.useRealTimers()
  vi.clearAllMocks()
})

describe("página de Indicadores — año por defecto", () => {
  it("la noche del 31 de diciembre chileno sigue en el año chileno, aunque el servidor ya esté en UTC del año siguiente", async () => {
    // Control: en UTC el reloj del proceso ya está en 2027.
    expect(new Date().getFullYear()).toBe(2027)

    await IndicadoresPage({ searchParams: Promise.resolve({}) })

    expect(mocks.indicatorYear).toHaveBeenCalledTimes(1)
    expect(mocks.indicatorYear.mock.calls[0]![0]).toBe(2026)
  })

  it("entrega al tablero el mismo año como `currentYear`", async () => {
    const element = await IndicadoresPage({ searchParams: Promise.resolve({}) })
    const dashboard = findElement(element, "CanonicalIndicatorsDashboard")

    expect(dashboard?.props.currentYear).toBe(2026)
  })

  it("un `?year=` explícito manda sobre el año por defecto", async () => {
    await IndicadoresPage({ searchParams: Promise.resolve({ year: "2025" }) })

    expect(mocks.indicatorYear.mock.calls[0]![0]).toBe(2025)
  })
})

type AnyElement = { type?: { name?: string } | string; props: Record<string, unknown> }

/** Busca, en el árbol de elementos sin renderizar, el primero cuyo componente se llame `name`. */
function findElement(node: unknown, name: string): AnyElement | null {
  if (!node || typeof node !== "object") return null
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findElement(child, name)
      if (found) return found
    }
    return null
  }
  const element = node as AnyElement
  if (typeof element.type === "function" && (element.type as { name?: string }).name === name) return element
  return findElement(element.props?.children, name)
}
