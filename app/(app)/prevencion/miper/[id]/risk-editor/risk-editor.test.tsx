// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { taskKeyOf } from "@/lib/prevention/miper/matrix-tree"
import type { MiperEntrySnapshot } from "@/lib/prevention/miper/snapshot"
import type { WorkspaceMode } from "@/lib/prevention/miper/workspace-mode"

const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }))
vi.mock("next/navigation", () => ({ useRouter: () => router, usePathname: () => "/prevencion/miper/m1", useSearchParams: () => new URLSearchParams("fila=e1") }))
const deleteMiperEntryAction = vi.hoisted(() => vi.fn(async () => ({ ok: true, message: "Eliminado" })))
vi.mock("@/lib/toast", () => ({ toast: { error: vi.fn(), success: vi.fn(), info: vi.fn(), warning: vi.fn() } }))
vi.mock("../../actions", () => ({ duplicateMiperEntryAction: vi.fn(), deleteMiperEntryAction, deleteMiperControlAction: vi.fn(), addMiperObservationAction: vi.fn(), saveMiperControlAction: vi.fn(), respondMiperObservationAction: vi.fn(), resolveMiperObservationAction: vi.fn(), reopenMiperObservationAction: vi.fn() }))

import { RiskEditor, type RiskEditorProps } from "./risk-editor"

const entry = (id: string, rowNumber: number, overrides: Partial<MiperEntrySnapshot> = {}) => ({
  id, rowNumber, activity: "Transporte", task: "Carga", position: "Conductor", location: null, exposedFemale: 0, exposedMale: 1, exposedOther: 0,
  riskFactorId: "f1", riskFactor: "Mecánico", isRoutine: true, hazard: `Peligro ${rowNumber}`, risk: "R", probableDamage: "D",
  probability: 2, consequence: 4, magnitude: 8, classification: "important", controlledStatus: "no", controls: [], ...overrides,
}) as MiperEntrySnapshot
const mode = { canEdit: true, canReviewTechnical: false, canApproveLegal: false, canObserve: false, canRespond: false, isSubmitter: false, canExecuteProgram: false, readOnlyReason: null } as WorkspaceMode
const commit = vi.fn(async () => true)
const clearErrors = vi.fn()
const props = (overrides: Partial<RiskEditorProps> = {}): RiskEditorProps => ({
  data: { matrixId: "m1", published: false, riskFactors: [{ id: "f1", name: "Mecánico", isActive: true }], dictionaries: { activities: [], tasks: [], positions: [], locations: [], hazards: [], risks: [], damages: [], measures: [] }, responsibleOptions: [], controlVersions: {}, controlActionLinks: [], observations: [] },
  rows: [entry("e1", 1), entry("e2", 2), entry("e3", 3, { task: "Otra" })],
  entryId: "e1", step: null,
  issuesByEntry: new Map([["e1", [{ scope: "entry", entryId: "e1", field: "controls", message: "Un riesgo Importante o Intolerable exige al menos una medida de control.", severity: "error" }]]]),
  incomplete: new Set(["e1", "e3"]), matching: null, editable: true, mode, change: null, baselineEntry: null,
  autosave: { commit, status: { state: "idle", savedAt: null, message: null }, fieldError: () => undefined, versionOf: () => 1, clearErrors },
  ...overrides,
})

describe("RiskEditor", () => {
  afterEach(() => { vi.useRealTimers(); commit.mockClear() })
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
  })
  it("RF3: un guardado rechazado de «¿controlado?» muestra el mensaje y la selección refleja el valor del riesgo", () => {
    const autosave = { ...props().autosave, fieldError: (_id: string, field: string) => (field === "controlledStatus" ? "No se pudo guardar el estado" : undefined) }
    render(<RiskEditor {...props({ step: "medidas", autosave })} />)
    expect(screen.getByText("No se pudo guardar el estado")).toBeTruthy()
    const group = screen.getByRole("radiogroup", { name: "¿Está controlado el riesgo?" })
    const checked = Array.from(group.querySelectorAll('[role="radio"]')).filter((node) => node.getAttribute("aria-checked") === "true")
    expect(checked.map((node) => node.textContent)).toEqual(["No"])
  })
  it("RF5: un paso basura en la URL cae en el primer paso con errores", () => {
    render(<RiskEditor {...props({ step: "x" as never })} />)
    expect(screen.getByRole("tab", { name: /Medidas de control/, selected: true })).toBeTruthy()
  })
  it("RF4: «Volver a la matriz» conserva la ruta de la matriz", async () => {
    router.refresh.mockClear()
    vi.useFakeTimers()
    render(<RiskEditor {...props({ entryId: "zzz" })} />)
    await act(async () => { await vi.advanceTimersByTimeAsync(2600) })
    expect(screen.getByRole("link", { name: "Volver a la matriz" }).getAttribute("href")).toBe("/prevencion/miper/m1")
  })
  it("en modo lectura no hay campos, menú ni guardado desde las tarjetas", () => {
    commit.mockClear()
    const { unmount } = render(<RiskEditor {...props({ editable: false, step: "identificacion" })} />)
    expect(screen.queryByRole("spinbutton")).toBeNull()
    expect(screen.queryByRole("combobox")).toBeNull()
    expect(screen.queryByRole("button", { name: /Más acciones/ })).toBeNull()
    unmount()
    render(<RiskEditor {...props({ editable: false, step: "evaluacion" })} />)
    const radio = screen.getAllByRole("radio").find((node) => node.getAttribute("aria-checked") !== "true")!
    fireEvent.click(radio)
    expect(commit).not.toHaveBeenCalled()
  })
  it("RF2: tras mover el riesgo de tarea, «Volver a la tarea» apunta a la nueva", () => {
    render(<RiskEditor {...props({ rows: [entry("e1", 1, { task: "Nueva tarea" })] })} />)
    expect(screen.getByRole("link", { name: /Volver a la tarea/ }).getAttribute("href")).toBe(`/prevencion/miper/m1?tarea=${taskKeyOf({ activity: "Transporte", task: "Nueva tarea" })}`)
  })
  it("«Observar este riesgo» sólo con permiso y lleva a Seguimiento", () => {
    const { unmount } = render(<RiskEditor {...props()} />)
    expect(screen.queryByRole("button", { name: "Observar este riesgo" })).toBeNull()
    unmount()
    router.replace.mockClear()
    const replaceState = vi.spyOn(window.history, "replaceState").mockImplementation(() => {})
    render(<RiskEditor {...props({ mode: { ...mode, canObserve: true } })} />)
    fireEvent.click(screen.getByRole("button", { name: "Observar este riesgo" }))
    // Sin ida al servidor: el paso cambia con el historial nativo, no con router.replace.
    expect(replaceState).toHaveBeenCalledWith(null, "", expect.stringContaining("paso=seguimiento"))
    expect(router.replace).not.toHaveBeenCalled()
    replaceState.mockRestore()
  })
  it("tras un error de guardado ofrece «Recargar riesgo», que trae el riesgo del servidor y descarta el conflicto", () => {
    router.refresh.mockClear()
    clearErrors.mockClear()
    const autosave = { ...props().autosave, status: { state: "error" as const, savedAt: null, message: "Versión desactualizada" } }
    render(<RiskEditor {...props({ autosave })} />)
    fireEvent.click(screen.getByRole("button", { name: "Recargar riesgo" }))
    expect(router.refresh).toHaveBeenCalledTimes(1)
    expect(clearErrors).toHaveBeenCalledWith("e1")
  })

  it("borrar el único riesgo de una tarea vuelve a la matriz; si quedan otros, a la tarea", async () => {
    const remove = async (entryId: string, rowNumber: number) => {
      router.replace.mockClear()
      const { unmount } = render(<RiskEditor {...props({ entryId })} />)
      fireEvent.keyDown(screen.getByRole("button", { name: `Más acciones del riesgo ${rowNumber}` }), { key: "Enter" })
      fireEvent.click(screen.getByRole("menuitem", { name: "Eliminar riesgo" }))
      fireEvent.click(await screen.findByRole("button", { name: "Eliminar riesgo" }))
      await waitFor(() => expect(router.replace).toHaveBeenCalledTimes(1))
      unmount()
      return router.replace.mock.calls[0]![0]
    }
    // e3 es el único de «Otra»: la tarea quedaría vacía.
    expect(await remove("e3", 3)).toBe("/prevencion/miper/m1")
    expect(deleteMiperEntryAction).toHaveBeenLastCalledWith(expect.objectContaining({ matrixId: "m1", entryId: "e3" }))
    // e1 comparte «Carga» con e2: se vuelve a esa tarea.
    expect(await remove("e1", 1)).toBe(`/prevencion/miper/m1?tarea=${taskKeyOf({ activity: "Transporte", task: "Carga" })}`)
  })
})
