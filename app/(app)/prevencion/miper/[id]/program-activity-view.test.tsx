// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { MiperEntrySnapshot } from "@/lib/prevention/miper/snapshot"
import type { WorkspaceMode } from "@/lib/prevention/miper/workspace-mode"
import type { ProgramActionDetail, ProgramActionView } from "@/lib/services/miper/program-queries"

const mocks = vi.hoisted(() => ({
  load: vi.fn(),
  record: vi.fn(),
  voidRecord: vi.fn(),
  params: { value: "tab=programa&actividad=a1" },
}))
vi.mock("next/navigation", () => ({
  usePathname: () => "/prevencion/miper/m1",
  useSearchParams: () => new URLSearchParams(mocks.params.value),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}))
vi.mock("@/lib/toast", () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock("./program-actions", () => ({ loadProgramActionDetailAction: mocks.load }))
vi.mock("../actions", () => ({
  recordOccurrenceAction: mocks.record,
  voidOccurrenceRecordAction: mocks.voidRecord,
  addOccurrenceEvidenceAction: vi.fn(),
  withdrawOccurrenceEvidenceAction: vi.fn(),
  uploadProgramEvidenceAction: vi.fn(),
  linkProgramControlsAction: vi.fn(),
}))

import { ProgramActivityView } from "./program-activity-view"

const progress = { done: 0, late: 0, pending: 3, overdue: 0, failed: 0, planned: 3, ratio: 0 }
const occurrence = (id: string, dueOn: string) => ({ id, dueOn, outcome: "pending" as const, late: false, effectiveOn: null, reason: null, evidenceCount: 0 })
const action = {
  id: "a1", actionNumber: 3, processName: "Mantención", description: "Revisar arneses", responsibleUserId: "u-resp", responsibleName: "Carla",
  locationLabel: "Planta", scheduleKind: "monthly", startsOn: "2026-01-05", status: "active", retiredReason: null, version: 1,
  controls: [{ id: "c1", rowNumber: 7, description: "Arnés" }],
  occurrences: [occurrence("o1", "2026-02-05"), occurrence("o2", "2026-03-05"), occurrence("o3", "2026-04-05")],
  progress,
} as unknown as ProgramActionView
const rows = [{ id: "e7", rowNumber: 7, hazard: "Caída", controls: [{ id: "c1", description: "Arnés", status: "proposed" }] }] as unknown as MiperEntrySnapshot[]
const mode = (patch: Partial<WorkspaceMode> = {}): WorkspaceMode => ({
  canEdit: true, canReviewTechnical: false, canApproveLegal: false, canObserve: false, canRespond: false,
  isSubmitter: false, canExecuteProgram: true, readOnlyReason: null, ...patch,
})
const detail = (patch: Partial<ProgramActionDetail> = {}): ProgramActionDetail => ({
  actionId: "a1",
  occurrences: [{
    occurrenceId: "o1", currentRecordId: null,
    records: [{
      id: "r1", outcome: "done", effectiveOn: "2026-02-04", late: false, reason: null, notes: null,
      recordedAt: "2026-02-04T12:00:00Z", recordedByName: "Carla", voidedAt: "2026-02-06T12:00:00Z",
      voidReason: "Registro duplicado", voidedByName: "Ana", evidence: [],
    }],
  }],
  ...patch,
})

function renderView(options: { mode?: WorkspaceMode; action?: ProgramActionView } = {}) {
  return render(
    <ProgramActivityView
      matrixId="m1" programId="p1" action={options.action ?? action} mode={options.mode ?? mode()} userId="u1"
      users={[]} rows={rows} processes={[]}
    />,
  )
}

beforeEach(() => { mocks.load.mockResolvedValue({ ok: true, data: detail() }) })
afterEach(() => { vi.clearAllMocks(); mocks.params.value = "tab=programa&actividad=a1" })

describe("ProgramActivityView", () => {
  it("al montar hace una sola llamada aunque haya tres ocurrencias", async () => {
    renderView()
    await screen.findByText("Motivo de la anulación: Registro duplicado · Ana")
    expect(mocks.load).toHaveBeenCalledTimes(1)
    expect(mocks.load).toHaveBeenCalledWith({ matrixId: "m1", actionId: "a1" })
  })

  it("marca Anulado el registro anulado", async () => {
    renderView()
    expect(await screen.findByText("Anulado")).toBeTruthy()
    expect(screen.queryByRole("button", { name: /^Anular el registro/ })).toBeNull()
  })

  it("Ver la fila n enlaza a ?fila= de su riesgo", () => {
    renderView()
    const link = screen.getByRole("link", { name: "Ver el riesgo 7 en la MIPER" })
    expect(link.getAttribute("href")).toContain("fila=e7")
    expect(screen.getByRole("region", { name: "Revisar arneses" })).toBeTruthy()
  })

  // Regresión: el `Sheet` que esta vista reemplaza mostraba el avance en la ficha
  // y el porte lo perdió; tras «Registrar» la persona no veía el avance cambiar.
  it("la ficha muestra el avance de la actividad y lo relee de las props", () => {
    const view = renderView({ action: { ...action, occurrences: [], progress: { ...progress, pending: 0, planned: 0, ratio: null } } })
    const region = () => screen.getByRole("region", { name: "Revisar arneses" })
    expect(region().textContent).toContain("0/0 · Sin ejecuciones programadas")
    view.rerender(
      <ProgramActivityView
        matrixId="m1" programId="p1" action={{ ...action, progress: { ...progress, done: 1, pending: 2, ratio: 1 / 3 } }} mode={mode()} userId="u1"
        users={[]} rows={rows} processes={[]}
      />,
    )
    expect(region().textContent).toContain("1/3 · 33% realizado")
    expect(region().textContent).toContain("2 pendientes · 0 incumplidas · 0 vencidas")
    expect(screen.getByRole("progressbar", { name: "Avance: 1 de 3 ejecuciones realizadas" })).toBeTruthy()
  })

  it("Volver al programa apunta a tab=programa sin actividad", () => {
    renderView()
    const href = screen.getByRole("link", { name: "Volver al programa" }).getAttribute("href") ?? ""
    expect(href).toContain("tab=programa")
    expect(href).not.toContain("actividad")
  })

  it("sin edición no ofrece Vincular medidas", () => {
    renderView({ mode: mode({ canEdit: false }) })
    expect(screen.queryByRole("button", { name: "Vincular medidas" })).toBeNull()
    cleanupAndRenderEditable()
  })

  it("tras registrar vuelve a pedir el detalle una vez", async () => {
    mocks.record.mockResolvedValue({ ok: true, message: "Ocurrencia registrada: no se hizo" })
    renderView()
    await waitFor(() => expect(mocks.load).toHaveBeenCalledTimes(1))
    fireEvent.click(screen.getByRole("button", { name: "Registrar la ejecución del 05-02-2026" }))
    fireEvent.click(screen.getByRole("combobox", { name: "Resultado de la ejecución" }))
    fireEvent.click(screen.getByRole("option", { name: "No se hizo" }))
    fireEvent.change(screen.getByRole("textbox", { name: /^Motivo/ }), { target: { value: "No hubo personal disponible" } })
    fireEvent.click(screen.getByRole("button", { name: "Registrar ejecución" }))
    await waitFor(() => expect(mocks.load).toHaveBeenCalledTimes(2))
    expect(mocks.record).toHaveBeenCalledWith(expect.objectContaining({ matrixId: "m1", occurrenceId: "o1", outcome: "not_done" }))
  })

  it("descarta la respuesta de otra actividad", async () => {
    mocks.load.mockResolvedValue({ ok: true, data: detail({ actionId: "otra" }) })
    renderView()
    await waitFor(() => expect(mocks.load).toHaveBeenCalledTimes(1))
    await Promise.resolve()
    expect(screen.queryByText("Anulado")).toBeNull()
    expect(screen.queryByText(/Motivo de la anulación/)).toBeNull()
  })
  it("separa pendientes del historial sin perder resultados, evidencia ni registros anulados", async () => {
    const completed = { ...occurrence("o1", "2026-02-05"), outcome: "done" as const }
    const replaced = { ...occurrence("o4", "2026-01-05"), outcome: "superseded" as const }
    renderView({ action: { ...action, occurrences: [completed, occurrence("o3", "2026-04-05"), replaced, occurrence("o2", "2026-03-05")] } })
    const pending = screen.getByRole("region", { name: "Ejecuciones programadas" })
    expect(within(pending).getAllByRole("button", { name: /Registrar la ejecución/ }).map((button) => button.getAttribute("aria-label"))).toEqual(["Registrar la ejecución del 05-03-2026", "Registrar la ejecución del 05-04-2026"])
    const history = screen.getByText("Historial de ejecuciones (2)").closest("details")!
    expect(history).not.toHaveAttribute("open")
    fireEvent.click(within(history).getByText("Historial de ejecuciones (2)"))
    expect(await within(history).findByText("Motivo de la anulación: Registro duplicado · Ana")).toBeTruthy()
    expect(within(history).getByText("Vence el 05-01-2026")).toBeTruthy()
    expect(within(history).getByRole("button", { name: "Registrar la ejecución del 05-02-2026" })).toBeTruthy()
    expect(within(history).queryByRole("button", { name: "Registrar la ejecución del 05-01-2026" })).toBeNull()
  })

})

function cleanupAndRenderEditable() {
  // El contrapunto: con edición y actividad activa, el botón sí está.
  const { unmount } = renderView()
  expect(screen.getByRole("button", { name: "Vincular medidas" })).toBeTruthy()
  unmount()
}
