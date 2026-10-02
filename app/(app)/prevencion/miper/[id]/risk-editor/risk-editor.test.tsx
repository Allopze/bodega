// @vitest-environment jsdom
import { act, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import type { MiperEntrySnapshot } from "@/lib/prevention/miper/snapshot"
import type { WorkspaceMode } from "@/lib/prevention/miper/workspace-mode"

const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }))
vi.mock("next/navigation", () => ({ useRouter: () => router, usePathname: () => "/prevencion/miper/m1", useSearchParams: () => new URLSearchParams("fila=e1") }))
vi.mock("../../actions", () => ({ duplicateMiperEntryAction: vi.fn(), deleteMiperEntryAction: vi.fn(), deleteMiperControlAction: vi.fn(), addMiperObservationAction: vi.fn(), saveMiperControlAction: vi.fn(), respondMiperObservationAction: vi.fn(), resolveMiperObservationAction: vi.fn(), reopenMiperObservationAction: vi.fn() }))

import { RiskEditor, type RiskEditorProps } from "./risk-editor"

const entry = (id: string, rowNumber: number, overrides: Partial<MiperEntrySnapshot> = {}) => ({
  id, rowNumber, activity: "Transporte", task: "Carga", position: "Conductor", location: null, exposedFemale: 0, exposedMale: 1, exposedOther: 0,
  riskFactorId: "f1", riskFactor: "Mecánico", isRoutine: true, hazard: `Peligro ${rowNumber}`, risk: "R", probableDamage: "D",
  probability: 2, consequence: 4, magnitude: 8, classification: "important", controlledStatus: "no", controls: [], ...overrides,
}) as MiperEntrySnapshot
const mode = { canEdit: true, canReviewTechnical: false, canApproveLegal: false, canObserve: false, canRespond: false, isSubmitter: false, canExecuteProgram: false, readOnlyReason: null } as WorkspaceMode
const commit = vi.fn(async () => true)
const props = (overrides: Partial<RiskEditorProps> = {}): RiskEditorProps => ({
  data: { matrixId: "m1", published: false, riskFactors: [{ id: "f1", name: "Mecánico", isActive: true }], dictionaries: { activities: [], tasks: [], positions: [], locations: [], hazards: [], risks: [], damages: [], measures: [] }, responsibleOptions: [], controlVersions: {}, controlActionLinks: [], observations: [] },
  rows: [entry("e1", 1), entry("e2", 2), entry("e3", 3, { task: "Otra" })],
  entryId: "e1", step: null,
  issuesByEntry: new Map([["e1", [{ scope: "entry", entryId: "e1", field: "controls", message: "Un riesgo Importante o Intolerable exige al menos una medida de control.", severity: "error" }]]]),
  incomplete: new Set(["e1", "e3"]), matching: null, editable: true, mode, change: null, baselineEntry: null,
  autosave: { commit, status: { state: "idle", savedAt: null, message: null }, fieldError: () => undefined, versionOf: () => 1 },
  ...overrides,
})

describe("RiskEditor", () => {
  it("abre en el primer paso con errores y muestra el mensaje en el chequeo", () => {
    render(<RiskEditor {...props()} />)
    expect(screen.getByRole("tab", { name: /Medidas de control/, selected: true })).toBeTruthy()
    expect(screen.getAllByText(/exige al menos una medida/).length).toBeGreaterThan(0)
  })
  it("respeta el paso de la URL", () => {
    render(<RiskEditor {...props({ step: "evaluacion" })} />)
    expect(screen.getByRole("tab", { name: /Evaluación/, selected: true })).toBeTruthy()
  })
  it("«Siguiente pendiente» salta al próximo riesgo con errores aunque sea de otra tarea", () => {
    render(<RiskEditor {...props()} />)
    expect(screen.getByRole("link", { name: "Siguiente pendiente" }).getAttribute("href")).toBe("/prevencion/miper/m1?fila=e3")
    expect(screen.getByRole("link", { name: "Siguiente ›" }).getAttribute("href")).toBe("/prevencion/miper/m1?fila=e2")
  })
  it("«Volver a la tarea» usa la tarea actual del riesgo (también después de moverlo)", () => {
    const { rerender } = render(<RiskEditor {...props()} />)
    const before = screen.getByRole("link", { name: /Volver a la tarea/ }).getAttribute("href")
    rerender(<RiskEditor {...props({ rows: [entry("e1", 1, { task: "Nueva tarea" })] })} />)
    expect(screen.getByRole("link", { name: /Volver a la tarea/ }).getAttribute("href")).not.toBe(before)
  })
  it("en modo lectura no hay controles editables", () => {
    render(<RiskEditor {...props({ editable: false, step: "identificacion" })} />)
    expect(screen.queryByRole("combobox")).toBeNull()
    expect(screen.getByText("Peligro 1", { selector: "h2" })).toBeTruthy()
  })
  it("un riesgo que no existe pide recargar y después avisa", async () => {
    router.refresh.mockClear()
    vi.useFakeTimers()
    render(<RiskEditor {...props({ entryId: "zzz" })} />)
    expect(router.refresh).toHaveBeenCalledTimes(1)
    await act(async () => { await vi.advanceTimersByTimeAsync(2600) })
    expect(screen.getByText("Este riesgo ya no existe")).toBeTruthy()
    vi.useRealTimers()
  })
})
