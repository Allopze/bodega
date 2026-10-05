// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { MiperHeaderSnapshot } from "@/lib/prevention/miper/snapshot"
import type { WorkspaceMode } from "@/lib/prevention/miper/workspace-mode"
import type { ProgramActionView, ProgramHeaderView, ProgramWorkspace } from "@/lib/services/miper/program-queries"

const nav = vi.hoisted(() => ({ query: "" }))
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), prefetch: vi.fn(), back: vi.fn(), forward: vi.fn() }),
  usePathname: () => "/prevencion/miper/m1",
  useSearchParams: () => new URLSearchParams(nav.query),
}))
vi.mock("@/lib/toast", () => ({ toast: { error: vi.fn(), success: vi.fn(), info: vi.fn(), warning: vi.fn() } }))

const navigateWorkspace = vi.hoisted(() => vi.fn())
vi.mock("./workspace-nav", async (importOriginal) => ({ ...(await importOriginal<typeof import("./workspace-nav")>()), navigateWorkspace }))

const actionsMock = vi.hoisted(() => ({
  saveProgramHeaderAction: vi.fn(), saveProgramActionAction: vi.fn(), retireProgramActionAction: vi.fn(),
  applyProgramGenerationAction: vi.fn(), proposeProgramActionsAction: vi.fn(), recordOccurrenceAction: vi.fn(),
  addOccurrenceEvidenceAction: vi.fn(), uploadProgramEvidenceAction: vi.fn(), voidOccurrenceRecordAction: vi.fn(),
  withdrawOccurrenceEvidenceAction: vi.fn(),
}))
vi.mock("../actions", () => actionsMock)
vi.mock("./program-actions", () => ({ loadProgramActionDetailAction: vi.fn() }))
vi.mock("./program-activity-view", () => ({ ProgramActivityView: ({ action }: { action: { id: string } }) => <p>detalle {action.id}</p> }))

import { ProgramPanel, ProgramPageActions } from "./program-panel"

const HEADER: MiperHeaderSnapshot = {
  period: 2026, iperCode: "RE-04", elaboratedOn: null, updatedOn: null, companyName: "Empresa Ficha", companyRut: "11.111.111-1",
  companyAddress: "Calle 1", companyCommune: "Panguipulli", economicActivity: null, adherentNumber: null, worksiteName: "Planta",
  siteRepresentativeUserId: null, siteRepresentativeName: "Representante Ficha", headcountTotal: null, headcountMale: null,
  headcountFemale: null, headcountOther: null, participationSummary: "", consultationEvidenceReference: "",
}
const PROGRESS = { done: 1, late: 0, pending: 1, overdue: 0, failed: 0, planned: 2, ratio: 0.5 }
const PROGRAM_HEADER = {
  id: "p1", matrixId: "m1", version: 3, period: 2026, elaboratedOn: "2026-09-01", programManagerUserId: null, programManagerName: null,
  worksiteName: "Planta", worksiteCount: 4, lastReviewedOn: null, companyName: "Empresa Programa",
} as unknown as ProgramHeaderView

function actionOf(overrides: Partial<ProgramActionView> = {}): ProgramActionView {
  return {
    id: "a1", actionNumber: 1, processName: "Despacho", processId: "pr1", description: "Revisar extintores", responsibleUserId: "u1", responsibleName: "Ana",
    locationLabel: null, scheduleKind: "monthly", startsOn: "2026-01-01", status: "active", retiredReason: null, version: 1, controls: [],
    occurrences: [
      { id: "o2", dueOn: "2026-12-10", outcome: "pending", late: false, effectiveOn: null, reason: null, evidenceCount: 0 },
      { id: "o1", dueOn: "2026-11-10", outcome: "pending", late: false, effectiveOn: null, reason: null, evidenceCount: 0 },
    ],
    progress: PROGRESS, ...overrides,
  } as ProgramActionView
}

const programOf = (overrides: Partial<ProgramWorkspace> = {}): ProgramWorkspace => ({
  program: PROGRAM_HEADER, actions: [actionOf(), actionOf({ id: "a2", actionNumber: 2, description: "Capacitar", scheduleKind: "annual" })],
  proposals: null, progress: PROGRESS, processes: [{ id: "pr1", name: "Despacho" }], ...overrides,
})
const mode: WorkspaceMode = { canEdit: true, canReviewTechnical: false, canApproveLegal: false, canObserve: false, canRespond: false, isSubmitter: false, canExecuteProgram: true, readOnlyReason: null }
const users = [{ id: "u1", name: "Ana" }]

function show(program = programOf(), activityId: string | null = null) {
  return render(<ProgramPanel matrixId="m1" mode={mode} userId="u1" users={users} program={program} rows={[]} header={HEADER} activityId={activityId} />)
}

beforeEach(() => { nav.query = "" })
afterEach(() => { vi.useRealTimers(); navigateWorkspace.mockClear(); Object.values(actionsMock).forEach((fn) => fn.mockReset()) })

describe("ProgramPanel", () => {
  it("pinta las tarjetas desde props sin llamar a ninguna acción al montar", () => {
    show()
    expect(screen.getAllByRole("article")).toHaveLength(2)
    expect(screen.getByText("Revisar extintores")).toBeTruthy()
    for (const fn of Object.values(actionsMock)) expect(fn).not.toHaveBeenCalled()
  })

  it("cada actividad es un article con h2 Actividad N° n y el enlace al detalle apunta a ?actividad=", () => {
    show()
    const article = screen.getByRole("article", { name: "Revisar extintores" })
    expect(within(article).getByRole("heading", { level: 2, name: "Revisar extintores" })).toBeTruthy()
    expect(within(article).getByRole("link", { name: "Abrir el detalle de la actividad N° 1" }).getAttribute("href")).toBe("/prevencion/miper/m1?tab=programa&actividad=a1")
    // La próxima ocurrencia pendiente es la de menor vencimiento.
    expect(within(article).getByRole("button", { name: /^Registrar la ejecución del 10-11-2026$/ })).toBeTruthy()
    expect(within(article).getByRole("button", { name: "Editar la actividad N° 1" })).toBeTruthy()
    expect(within(article).getByRole("button", { name: "Retirar la actividad N° 1" })).toBeTruthy()
  })

  it("la búsqueda y los filtros cambian la URL con replace y sin servidor", () => {
    vi.useFakeTimers()
    window.history.replaceState(null, "", "/prevencion/miper/m1?tab=programa")
    show()
    fireEvent.change(screen.getByRole("searchbox", { name: "Buscar actividad del programa" }), { target: { value: "extintor" } })
    act(() => { vi.advanceTimersByTime(300) })
    expect(navigateWorkspace).toHaveBeenCalledWith("/prevencion/miper/m1?tab=programa&q=extintor", "replace")

    fireEvent.click(screen.getByRole("combobox", { name: "Filtrar por estado de la actividad" }))
    fireEvent.click(screen.getByRole("option", { name: "Sólo retiradas" }))
    expect(navigateWorkspace).toHaveBeenLastCalledWith("/prevencion/miper/m1?tab=programa&estado=retiradas", "replace")
    expect(navigateWorkspace.mock.calls.every((call) => call[1] === "replace")).toBe(true)
  })

  it("«Limpiar filtros» sólo aparece con filtros y borra los del programa", () => {
    nav.query = "tab=programa&estado=activas"
    window.history.replaceState(null, "", "/prevencion/miper/m1?tab=programa&estado=activas")
    show()
    fireEvent.click(screen.getByRole("button", { name: "Limpiar filtros" }))
    expect(navigateWorkspace).toHaveBeenCalledWith("/prevencion/miper/m1?tab=programa", "replace")
  })

  it("con actividad en la URL muestra el detalle; con una inexistente, el vacío con Volver al programa", () => {
    const first = show(programOf(), "a2")
    expect(screen.getByText("detalle a2")).toBeTruthy()
    expect(screen.queryByRole("article")).toBeNull()
    first.unmount()
    nav.query = "tab=programa&actividad=nada&estado=activas"
    show(programOf(), "nada")
    expect(screen.getByText("Esta actividad ya no existe")).toBeTruthy()
    expect(screen.getByRole("link", { name: "Volver al programa" }).getAttribute("href")).toBe("/prevencion/miper/m1?tab=programa&estado=activas")
  })

  it("el encabezado muestra la empresa de la ficha y el diálogo sólo pide fecha y encargado", () => {
    show()
    fireEvent.click(screen.getByText("Datos del programa"))
    expect(screen.getByText(/Empresa Ficha/)).toBeTruthy()
    expect(screen.queryByText(/Empresa Programa/)).toBeNull()
    expect(screen.getByText("Representante Ficha")).toBeTruthy()
    expect(screen.getByRole("link", { name: "Datos de empresa" }).getAttribute("href")).toBe("/prevencion/miper/m1?ficha=1")
    fireEvent.click(screen.getByRole("button", { name: "Responsable y fecha del programa" }))
    const dialog = screen.getByRole("dialog", { name: "Responsable y fecha del programa" })
    expect(within(dialog).getAllByLabelText("Fecha de elaboración del programa").length).toBeGreaterThan(0)
    expect(within(dialog).getByRole("combobox", { name: "Encargado del programa" })).toBeTruthy()
    expect(within(dialog).queryByLabelText("Empresa")).toBeNull()
    expect(within(dialog).queryByLabelText("RUT")).toBeNull()
    expect(within(dialog).queryByLabelText("Trabajadores")).toBeNull()
    expect(within(dialog).getByRole("button", { name: "Guardar antecedentes" })).toBeTruthy()
  })

  it("Completar antecedentes sin programa envía expectedVersion 1", async () => {
    actionsMock.saveProgramHeaderAction.mockResolvedValue({ ok: true })
    show(programOf({ program: null, actions: [] }))
    fireEvent.click(screen.getByRole("button", { name: "Completar antecedentes" }))
    fireEvent.click(screen.getByRole("button", { name: "Guardar antecedentes" }))
    await waitFor(() => expect(actionsMock.saveProgramHeaderAction).toHaveBeenCalledTimes(1))
    expect(actionsMock.saveProgramHeaderAction).toHaveBeenCalledWith(expect.objectContaining({ matrixId: "m1", expectedVersion: 1, programManagerUserId: null }))
  })
  it("mantiene los datos administrativos plegados y muestra un solo avance del programa", () => {
    show()
    const details = screen.getByText("Datos del programa").closest("details")
    expect(details).not.toHaveAttribute("open")
    expect(screen.getAllByText("Avance del plan")).toHaveLength(1)
    expect(screen.queryByRole("button", { name: "Nueva actividad" })).toBeNull()
    expect(screen.queryByRole("button", { name: "Generar actividades" })).toBeNull()
  })

  it("prioriza las actividades con ejecuciones próximas antes de las que no tienen pendientes", () => {
    show(programOf({ actions: [actionOf({ id: "closed", description: "Actividad cerrada", occurrences: [] }), actionOf({ id: "late", description: "Actividad vencida", occurrences: [{ id: "o9", dueOn: "2025-01-01", outcome: "pending", late: false, effectiveOn: null, reason: null, evidenceCount: 0 }] }), actionOf()] }))
    expect(screen.getAllByRole("article").map((article) => article.getAttribute("aria-labelledby"))).toEqual(["programa-actividad-late", "programa-actividad-a1", "programa-actividad-closed"])
  })

  it("la cabecera ofrece un solo menú «Agregar actividades» cuyos ítems abren cada diálogo", async () => {
    actionsMock.proposeProgramActionsAction.mockResolvedValue({ ok: true, data: { measures: [], groups: [] } })
    render(<ProgramPageActions matrixId="m1" mode={mode} users={users} program={programOf()} />)
    expect(screen.getAllByRole("button")).toHaveLength(1)
    const openMenu = () => fireEvent.keyDown(screen.getByRole("button", { name: "Agregar actividades" }), { key: "Enter" })
    openMenu()
    fireEvent.click(await screen.findByRole("menuitem", { name: "Generar desde las medidas…" }))
    expect(await screen.findByRole("dialog", { name: "Generar actividades desde las medidas" })).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }))
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())
    // Abierto desde un ítem que ya no existe, el foco caía al `body`: vuelve al disparador.
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("button", { name: "Agregar actividades" })))
    openMenu()
    fireEvent.click(await screen.findByRole("menuitem", { name: "Agregar una a mano…" }))
    expect(await screen.findByRole("dialog", { name: "Nueva actividad del programa" })).toBeTruthy()
  })

  it("en sólo lectura la cabecera no pinta ningún botón", () => {
    render(<ProgramPageActions matrixId="m1" mode={{ ...mode, canEdit: false }} users={users} program={programOf()} />)
    expect(screen.queryByRole("button")).toBeNull()
  })

  it("sin programa, el vacío ofrece generar las actividades y los filtros no se pintan", async () => {
    actionsMock.proposeProgramActionsAction.mockResolvedValue({ ok: true, data: { measures: [], groups: [] } })
    show(programOf({ program: null, actions: [] }))
    expect(screen.getByText("Esta MIPER todavía no tiene plan de medidas")).toBeTruthy()
    expect(screen.queryByLabelText("Buscar actividad del programa")).toBeNull()
    fireEvent.click(screen.getByRole("button", { name: "Generar actividades desde las medidas" }))
    expect(await screen.findByRole("dialog", { name: "Generar actividades desde las medidas" })).toBeTruthy()
  })

  it("con actividades pinta los filtros", () => {
    show()
    expect(screen.getByLabelText("Buscar actividad del programa")).toBeTruthy()
  })
})
