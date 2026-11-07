/**
 * Dos contratos de la página:
 *
 * - «Ver datos» del calendario de cumplimiento ofrece Excel sólo a quien puede exportar capacitación
 *   (`prevention:training:export`): ver el calendario no da la descarga.
 * - UX-01: la lista se pagina y se filtra en el servidor. Lo que la URL dice
 *   (`estado`, `q`, `page`, `faena`, `mes`) es lo que llega a la consulta, y las
 *   celdas del calendario aterrizan en «Todas», no en una pestaña que puede estar vacía.
 */
import type { ReactNode } from "react"
import { isValidElement } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const session = vi.hoisted(() => ({ permissions: ["prevention:training:view"] as string[] }))
const listPage = vi.hoisted(() => vi.fn())
const listSlots = vi.hoisted(() => vi.fn())
const emptyCounts = { all: 0, pending: 0, completed: 0, not_completed: 0, not_applicable: 0 }

vi.mock("next/navigation", () => ({ redirect: (href: string) => { throw new Error(`redirect:${href}`) } }))
vi.mock("@/lib/auth/can", () => ({
  requirePermission: async () => ({ user: { id: "u-1", permissions: session.permissions } }),
  can: (current: { user?: { permissions?: string[] } } | null, permission: string) => Boolean(current?.user?.permissions?.includes(permission)),
}))
vi.mock("@/lib/auth/scope", () => ({ resolveWorksiteScope: () => ({ mode: "some", ids: ["ws-1"] }) }))
vi.mock("@/lib/services/prevention-training-occurrences", () => ({
  resolveTrainingOccurrenceYear: async () => 2026,
  listTrainingOccurrencesPage: listPage,
  listTrainingOccurrenceWorksites: async () => [],
  listTrainingComplianceSlots: listSlots,
}))
vi.mock("@/lib/services/prevention-program-slots", () => ({
  resolveProgramActivationPeriods: async (ids: string[]) => new Map(ids.map((id) => [id, null])),
}))
// El resto del módulo es lógica pura que el calendario sí usa: sólo se fija «hoy».
vi.mock("@/lib/services/pdtp/period", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/services/pdtp/period")>()),
  currentPdtpPeriod: () => ({ year: 2026, month: 11, week: 1 }),
}))
vi.mock("@/components/prevention/program-compliance-section", () => ({ ProgramComplianceSection: () => null }))
vi.mock("@/components/ui/page-header", () => ({ PageHeader: () => null, Breadcrumbs: () => null }))
vi.mock("@/components/ui/export-button", () => ({ ExportLink: () => null }))
vi.mock("./training-occurrence-list", () => ({ TrainingOccurrenceList: () => null }))
vi.mock("@/components/prevention/pdtp-scheduled-activity-panel-server", () => ({ PdtpScheduledActivityPanelServer: () => null }))

import CapacitacionPage from "./page"
import { ProgramComplianceSection } from "@/components/prevention/program-compliance-section"
import { TrainingOccurrenceList } from "./training-occurrence-list"

beforeEach(() => {
  listPage.mockReset()
  listPage.mockResolvedValue({ rows: [], total: 0, counts: emptyCounts })
  listSlots.mockReset()
  listSlots.mockResolvedValue([])
})
afterEach(() => { session.permissions = ["prevention:training:view"] })

function findElement(node: ReactNode, type: unknown): { props: Record<string, unknown> } | null {
  if (!isValidElement(node)) return null
  if (node.type === type) return node as unknown as { props: Record<string, unknown> }
  const children = (node.props as { children?: ReactNode }).children
  for (const child of Array.isArray(children) ? children : [children]) {
    const found = findElement(child as ReactNode, type)
    if (found) return found
  }
  return null
}

async function calendarSection() {
  const tree = await CapacitacionPage({ searchParams: Promise.resolve({}) })
  const section = findElement(tree, ProgramComplianceSection)
  if (!section) throw new Error("no se encontró el calendario de cumplimiento")
  return section
}

describe("/prevencion/capacitacion · «Ver datos» → Excel", () => {
  it("quien sólo puede ver no recibe la descarga", async () => {
    expect((await calendarSection()).props.excel).toBeUndefined()
  })

  it("con `prevention:training:export` el calendario ofrece Excel con ese permiso", async () => {
    session.permissions = ["prevention:training:view", "prevention:training:export"]
    expect((await calendarSection()).props.excel).toEqual({ permission: "prevention:training:export" })
  })
})

type PageParams = Record<string, string | string[] | undefined>

async function listProps(params: PageParams = {}) {
  const tree = await CapacitacionPage({ searchParams: Promise.resolve(params) })
  const list = findElement(tree, TrainingOccurrenceList)
  if (!list) throw new Error("no se encontró la lista de capacitación")
  return list.props
}

async function redirectedTo(params: PageParams) {
  try {
    await CapacitacionPage({ searchParams: Promise.resolve(params) })
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
  return null
}

describe("/prevencion/capacitacion · el contrato de la URL", () => {
  it("sin `estado` la vista es «Pendientes» de todo el año, 25 por página", async () => {
    await listProps()
    expect(listPage).toHaveBeenCalledTimes(1)
    expect(listPage.mock.calls[0]![1]).toMatchObject({
      year: 2026,
      status: "pending",
      limit: 25,
      offset: 0,
      month: null,
      worksiteId: undefined,
      includeInactiveWorksites: false,
      search: undefined,
    })
  })

  it.each([
    ["hecha", "completed"],
    ["no_hecha", "not_completed"],
    ["no_aplica", "not_applicable"],
    ["todas", "all"],
    ["", "pending"],
  ])("`estado=%s` pide el estado %s", async (estado, status) => {
    await listProps({ estado })
    expect(listPage.mock.calls[0]![1].status).toBe(status)
  })

  it("un `estado` desconocido se normaliza a la URL sin `estado` (y sin `page`), conservando lo demás", async () => {
    expect(await redirectedTo({ estado: "pendiente", faena: "ws-1", year: "2026", page: "3" }))
      .toBe("redirect:/prevencion/capacitacion?faena=ws-1&year=2026")
    expect(await redirectedTo({ estado: "pendiente" })).toBe("redirect:/prevencion/capacitacion")
    expect(listPage).not.toHaveBeenCalled()
  })

  it("`q`, `faena`, `mes` y `page` llegan a la consulta (faena elegida incluye las inactivas)", async () => {
    await listProps({ estado: "todas", q: "  extintor ", faena: "ws-1", mes: "4", page: "3" })
    expect(listPage.mock.calls[0]![1]).toMatchObject({
      status: "all",
      search: "extintor",
      worksiteId: "ws-1",
      includeInactiveWorksites: true,
      month: 4,
      offset: 50,
      limit: 25,
    })
  })

  it("una página fuera de rango se vuelve a pedir acotada a la última", async () => {
    listPage
      .mockResolvedValueOnce({ rows: [], total: 30, counts: { ...emptyCounts, pending: 30, all: 30 } })
      .mockResolvedValueOnce({ rows: [], total: 30, counts: { ...emptyCounts, pending: 30, all: 30 } })
    await listProps({ page: "9" })
    expect(listPage).toHaveBeenCalledTimes(2)
    expect(listPage.mock.calls[0]![1].offset).toBe(200)
    // 30 filas a 25 por página son dos páginas: la última empieza en 25.
    expect(listPage.mock.calls[1]![1].offset).toBe(25)
  })

  it("un número de página absurdo no llega a la base como offset", async () => {
    await listProps({ page: "99999999999999999999" })
    expect(listPage.mock.calls[0]![1].offset).toBeLessThanOrEqual(10_000 * 25)
  })

  it("el calendario manda a «Todas» con faena y mes; quitar el filtro conserva faena y año", async () => {
    session.permissions = ["prevention:training:view"]
    const tree = await CapacitacionPage({ searchParams: Promise.resolve({ faena: "ws-1", estado: "hecha", q: "x", mes: "3", page: "2" }) })
    const section = findElement(tree, ProgramComplianceSection)!
    const hrefFor = section.props.hrefFor as (rowId: string, month: number) => string
    expect(hrefFor("ws-2", 5)).toBe("/prevencion/capacitacion?faena=ws-2&year=2026&mes=5&estado=todas")
    expect(section.props.clearHref).toBe("/prevencion/capacitacion?faena=ws-1&year=2026")
    expect(section.props.selected).toEqual({ rowId: "ws-1", month: 3 })
  })

  it("sin faena no hay celda seleccionada aunque venga `mes`", async () => {
    const tree = await CapacitacionPage({ searchParams: Promise.resolve({ mes: "3" }) })
    expect(findElement(tree, ProgramComplianceSection)!.props.selected).toBeNull()
  })

  it("la lista recibe los contadores del servidor, el rótulo legible del programa y la paginación armada", async () => {
    listPage.mockResolvedValue({ rows: [], total: 40, counts: { all: 90, pending: 40, completed: 30, not_completed: 15, not_applicable: 5 } })
    const props = await listProps({ faena: "ws-1" })
    expect(props.counts).toEqual({ all: 90, pending: 40, completed: 30, not_completed: 15, not_applicable: 5 })
    expect(props.programLabel).toBe("Programa anual 2026 · versión 1")
    expect(props.clearFiltersHref).toBe("/prevencion/capacitacion?faena=ws-1&year=2026")
    expect(props.showAllHref).toBe("/prevencion/capacitacion?faena=ws-1&year=2026&estado=todas")
    expect(isValidElement(props.pagination)).toBe(true)
  })

  it("`hasProgram` lo decide el alcance completo, no la página: una página vacía con casillas sigue siendo «hay programa»", async () => {
    expect((await listProps()).hasProgram).toBe(false)

    listSlots.mockResolvedValue([
      { worksiteId: "ws-1", worksiteName: "Faena Uno", scheduledMonth: 3, scheduledWeek: 2, status: "pending" },
    ])
    // La página sale vacía (el filtro no deja nada) y aun así el programa existe.
    expect((await listProps({ estado: "hecha" })).hasProgram).toBe(true)
  })

  it("al calendario le llega la activación POR faena, la misma que usa la lista", async () => {
    listSlots.mockResolvedValue([
      { worksiteId: "ws-1", worksiteName: "Faena Uno", scheduledMonth: 3, scheduledWeek: 2, status: "pending" },
    ])
    const props = await listProps()
    expect(props.activationByWorksite).toEqual({ "ws-1": null })
  })
})
