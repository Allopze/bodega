// @vitest-environment jsdom

/**
 * El tile «Tasa de detención PPA» del tablero muestra la misma magnitud que la tira de
 * `/prevencion/ppa` (detenidos sobre el total de PPA), así que sigue su misma regla
 * (`lib/ppa/detention-rate.ts`): con menos de `PPA_RATE_MIN_SAMPLE` PPA no hay
 * porcentaje, hay el conteo («3 de 11») y la nota de que la base es demasiado chica.
 */
import { render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { ReactNode } from "react"
import type { Session } from "next-auth"

const getDashboardCounters = vi.hoisted(() => vi.fn())
const getPpaStats = vi.hoisted(() => vi.fn())
const getDashboardStats = vi.hoisted(() => vi.fn())
const countTrainingOccurrencesByStatus = vi.hoisted(() => vi.fn())
const resolveTrainingOccurrenceYear = vi.hoisted(() => vi.fn())

vi.mock("@/lib/services/prevention-documents/search", () => ({ getDashboardCounters }))
vi.mock("@/lib/services/ppa-module/calculos", () => ({ getPpaStats }))
vi.mock("@/lib/services/sst-module/dashboard", () => ({ getDashboardStats }))
vi.mock("@/lib/services/prevention-training-occurrences", () => ({ countTrainingOccurrencesByStatus, resolveTrainingOccurrenceYear }))

import { KpiCard } from "@/components/ui/kpi-card"
import { GovernanceSection } from "./governance-section"
import type { DomainSectionsProps } from "./shared"

const scope = { worksiteId: "all", worksiteName: null, period: "mes", view: "gobernanza" } as const

function props(permissions: string[]): DomainSectionsProps {
  return {
    session: { user: { id: "u1", permissions, isGlobal: true, worksiteIds: [] } } as unknown as Session,
    scope,
    worksiteScope: { mode: "all", ids: [] },
    pdtpScope: "all",
    worksiteIds: [],
    currentYear: 2026,
    moduleWorkload: [],
    queueTotal: 0,
  }
}

type Element = { type: unknown; props: Record<string, unknown> }

function findAll(node: ReactNode, matches: (element: Element) => boolean, result: Element[] = []): Element[] {
  if (Array.isArray(node)) {
    node.forEach((child) => findAll(child, matches, result))
    return result
  }
  if (!node || typeof node !== "object" || !("props" in node)) return result
  const element = node as Element
  if (matches(element)) result.push(element)
  findAll(element.props.children as ReactNode, matches, result)
  return result
}

const ppaStats = (over: Record<string, unknown>) => ({
  total: 0, detenidos: 0, aprobadosAuto: 0, autorizados: 0, rechazados: 0, pendientes: 0,
  porcentajeDesviaciones: 0, avgResponseMinutes: null, topReasons: [], topTareas: [], topFaenas: [],
  ...over,
})

async function renderKpis(permissions = ["ppa:view"]) {
  const section = await GovernanceSection(props(permissions))
  const { kpis } = section.props as unknown as { kpis: ReactNode }
  const { container } = render(<>{kpis}</>)
  const tile = findAll(kpis, (element) => element.type === KpiCard && element.props.label === "Tasa de detención PPA")[0]
  return { container, tile }
}

const trainingCounts = (over: Record<string, number> = {}) => ({
  all: 0, pending: 0, completed: 0, not_completed: 0, not_applicable: 0, ...over,
})

beforeEach(() => {
  vi.clearAllMocks()
  getDashboardCounters.mockResolvedValue(null)
  getDashboardStats.mockResolvedValue(null)
  countTrainingOccurrencesByStatus.mockResolvedValue(trainingCounts())
  resolveTrainingOccurrenceYear.mockResolvedValue(2026)
})

describe("GovernanceSection · Tasa de detención PPA", () => {
  it("con los once PPA de hoy no hay porcentaje: «3 de 11» y la nota de base chica", async () => {
    getPpaStats.mockResolvedValue(ppaStats({ total: 11, detenidos: 3, porcentajeDesviaciones: 27 }))
    const { container, tile } = await renderKpis()

    expect(tile!.props.value).toBe("3 de 11")
    expect(tile!.props.detail).toBe("PPA detenidos. Base demasiado chica para un porcentaje (n = 11)")
    expect(screen.getByText("3 de 11")).toBeDefined()
    expect(screen.getByText(/Base demasiado chica para un porcentaje \(n = 11\)/)).toBeDefined()
    // Ni «27%» ni ningún otro porcentaje pelado.
    expect(container.textContent).not.toMatch(/\d\s?%/)
    expect(tile!.props.href).toBe("/prevencion/ppa")
  })

  it("con base suficiente muestra la tasa con un decimal, igual que /prevencion/ppa, y su base", async () => {
    getPpaStats.mockResolvedValue(ppaStats({ total: 22, detenidos: 6, porcentajeDesviaciones: 27 }))
    const { tile } = await renderKpis()

    expect(tile!.props.value).toBe("27,3%")
    expect(tile!.props.detail).toBe("6 de 22 PPA detenidos · acumulado")
  })

  it("justo en el mínimo ya hay tasa; un PPA menos, no", async () => {
    getPpaStats.mockResolvedValue(ppaStats({ total: 20, detenidos: 5 }))
    expect((await renderKpis()).tile!.props.value).toBe("25%")

    vi.clearAllMocks()
    getDashboardCounters.mockResolvedValue(null)
    getDashboardStats.mockResolvedValue(null)
    countTrainingOccurrencesByStatus.mockResolvedValue(trainingCounts())
    resolveTrainingOccurrenceYear.mockResolvedValue(2026)
    getPpaStats.mockResolvedValue(ppaStats({ total: 19, detenidos: 5 }))
    expect((await renderKpis()).tile!.props.value).toBe("5 de 19")
  })

  it("sin PPA no inventa un 0 %: dice qué falta y a dónde ir", async () => {
    getPpaStats.mockResolvedValue(ppaStats({}))
    const { container, tile } = await renderKpis()

    expect(tile!.props.value).toBe("—")
    expect(tile!.props.empty).toEqual({ message: "Aún no hay registros PPA", actionLabel: "Ir al PPA" })
    expect(container.textContent).not.toMatch(/\d\s?%/)
  })

  it("sin permiso ppa:view el tile no existe", async () => {
    const { tile } = await renderKpis(["prevention:docs:view"])
    expect(tile).toBeUndefined()
    expect(getPpaStats).not.toHaveBeenCalled()
  })
})

describe("GovernanceSection · Capacitaciones pendientes", () => {
  async function trainingTile(permissions: string[]) {
    const section = await GovernanceSection(props(permissions))
    const { kpis } = section.props as unknown as { kpis: ReactNode }
    return findAll(kpis, (element) => element.type === KpiCard && element.props.label === "Capacitaciones pendientes")[0]
  }

  it("sale del contador por estado del año, sin cargar la lista de ocurrencias, y pasa el número al tile", async () => {
    countTrainingOccurrencesByStatus.mockResolvedValue(trainingCounts({ all: 3900, pending: 2246, not_completed: 3 }))
    const tile = await trainingTile(["prevention:training:view"])

    // `KpiCard` formatea el número (2.246); `pending` y no «todo menos completed».
    expect(tile!.props.value).toBe(2246)
    expect(tile!.props.detail).toBe("3 declaradas no hechas · ahora")
    expect(tile!.props.tone).toBe("signal")
    expect(countTrainingOccurrencesByStatus).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "u1", permissions: ["prevention:training:view"] }),
      { year: 2026 },
    )
  })

  it("si el conteo falla, el tile queda en 0 en vez de romper la sección", async () => {
    countTrainingOccurrencesByStatus.mockRejectedValue(new Error("boom"))
    const tile = await trainingTile(["prevention:training:view"])

    expect(tile!.props.value).toBe(0)
    expect(tile!.props.detail).toBe("0 declaradas no hechas · ahora")
  })

  it("sin permiso de capacitación no consulta nada", async () => {
    await trainingTile(["prevention:docs:view"])
    expect(countTrainingOccurrencesByStatus).not.toHaveBeenCalled()
  })
})
