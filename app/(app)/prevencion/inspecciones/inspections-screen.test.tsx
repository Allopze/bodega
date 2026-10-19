// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  permissions: [] as string[],
  listProps: vi.fn(),
  actionsProps: vi.fn(),
  worksites: vi.fn(),
  templates: vi.fn(),
  subjects: vi.fn(),
  runs: vi.fn(),
  summary: vi.fn(),
  programs: vi.fn(),
  assignees: vi.fn(),
}))

vi.mock("next/navigation", () => ({ redirect: (href: string) => { throw new Error(href) } }))
vi.mock("@/db", () => ({ db: {} }))
vi.mock("@/db/schema", () => ({ pdtpAccreditationBindings: {} }))
vi.mock("@/lib/auth/can", () => ({
  requirePermission: async () => ({ user: { id: "u-lectura", permissions: mocks.permissions } }),
}))
vi.mock("@/lib/auth/scope", () => ({ resolveWorksiteScope: () => ({ mode: "some", ids: ["ws-1", "ws-2", "ws-3"] }) }))
vi.mock("@/components/ui/page-header", () => ({
  PageHeader: ({ title, actions }: { title: string; actions?: React.ReactNode }) => <header><h1>{title}</h1>{actions}</header>,
  Breadcrumbs: () => null,
}))
vi.mock("@/components/prevention/pdtp-scheduled-activity-panel-server", () => ({
  PdtpScheduledActivityPanelServer: () => null,
}))
vi.mock("./inspection-run-list", () => ({
  InspectionRunList: (props: unknown) => { mocks.listProps(props); return <div data-testid="run-list" /> },
  InspectionPageActions: (props: unknown) => { mocks.actionsProps(props); return null },
}))
vi.mock("@/lib/services/prevention-inspections", () => ({
  INSPECTION_PAGE_SIZE: 50,
  listInspectionRuns: mocks.runs,
  summarizeInspectionRuns: mocks.summary,
  listInspectionPrograms: mocks.programs,
  listInspectionTemplates: mocks.templates,
  listInspectionWorksites: mocks.worksites,
  listInspectionSubjectsByWorksite: mocks.subjects,
  listInspectionAssignees: mocks.assignees,
}))

import { InspectionsScreen } from "./inspections-screen"

const WORKSITES = [
  { id: "ws-1", name: "Faena Norte" },
  { id: "ws-2", name: "Faena Sur" },
  { id: "ws-3", name: "Faena Centro" },
]

const VIEW = "prevention:inspections:view"
const REVIEW = "prevention:inspections:review"
const EXECUTE = "prevention:inspections:execute"

beforeEach(() => {
  mocks.runs.mockResolvedValue([])
  mocks.summary.mockResolvedValue({ total: 0, pendingReview: 0, withOpenFindings: 0, withCriticalFindings: 0, overdueRuns: 0 })
  mocks.programs.mockResolvedValue([])
  mocks.assignees.mockResolvedValue([])
  mocks.worksites.mockResolvedValue(WORKSITES)
  mocks.templates.mockResolvedValue([
    { id: "tpl-1", name: "Inspección de extintores", versionLabel: "01", kind: "inspection", status: "approved", sourceDefinitionCode: null },
  ])
  mocks.subjects.mockResolvedValue({ "ws-1": [] })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

async function renderScreen(permissions: string[]) {
  mocks.permissions = permissions
  render(await InspectionsScreen({ searchParams: {} }))
  return mocks.listProps.mock.calls.at(-1)![0] as Record<string, unknown>
}

describe("bandeja de inspecciones — la pantalla del servidor", () => {
  it("una sesión de solo lectura recibe todas las faenas de su alcance (P1-10)", async () => {
    // Jefatura, CPHS y mantención tienen `view` sin `execute`: sin la lista de
    // faenas el filtro «Faena» sólo ofrecía las de las 50 filas de la página.
    const props = await renderScreen([VIEW])

    expect(mocks.worksites).toHaveBeenCalledTimes(1)
    expect(mocks.worksites).toHaveBeenCalledWith({
      userId: "u-lectura",
      scope: { mode: "some", ids: ["ws-1", "ws-2", "ws-3"] },
      permissions: [VIEW],
    })
    expect(props.worksites).toEqual(WORKSITES)
    expect(props.canExecute).toBe(false)
  })

  it("lo que pide `execute` sigue sin cargarse para quien no ejecuta", async () => {
    // Cargar las faenas para todos no abre la alta: plantillas e inventario de
    // sujetos siguen siendo de quien puede crear.
    const props = await renderScreen([VIEW])

    expect(mocks.templates).not.toHaveBeenCalled()
    expect(mocks.subjects).not.toHaveBeenCalled()
    expect(props.templates).toEqual([])
    expect(props.subjectsByWorksite).toEqual({})
    expect(mocks.actionsProps.mock.calls.at(-1)![0]).toMatchObject({ canCreate: false })
  })

  it("quien ejecuta recibe las mismas faenas, las plantillas y el inventario de sujetos", async () => {
    const props = await renderScreen([VIEW, EXECUTE])

    expect(mocks.worksites).toHaveBeenCalledTimes(1)
    expect(props.worksites).toEqual(WORKSITES)
    expect(props.canExecute).toBe(true)
    expect(mocks.templates).toHaveBeenCalledTimes(1)
    expect(mocks.subjects).toHaveBeenCalledWith(["ws-1", "ws-2", "ws-3"], expect.objectContaining({ userId: "u-lectura" }))
    expect(props.subjectsByWorksite).toEqual({ "ws-1": [] })
    expect(mocks.actionsProps.mock.calls.at(-1)![0]).toMatchObject({ canCreate: true })
  })

  it("pasa `canReview` según el permiso de revisión, para el texto del tile de pendientes", async () => {
    expect((await renderScreen([VIEW, REVIEW])).canReview).toBe(true)
    cleanup()
    expect((await renderScreen([VIEW])).canReview).toBe(false)
    // Ejecutar no es revisar: el permiso de revisión es el que decide.
    cleanup()
    expect((await renderScreen([VIEW, EXECUTE])).canReview).toBe(false)
  })

  it("los KPI y la lista se piden con el mismo filtro (el servidor decide qué ignora cada uno)", async () => {
    mocks.permissions = [VIEW, REVIEW]
    render(await InspectionsScreen({ searchParams: { estado: "planned", faena: "ws-1", pagina: "2" } }))

    const expectedFilter = { status: "planned", worksiteId: "ws-1" }
    expect(mocks.runs).toHaveBeenCalledWith(expect.anything(), expectedFilter, { offset: 50 })
    expect(mocks.summary).toHaveBeenCalledWith(expect.anything(), expectedFilter)
  })
})
