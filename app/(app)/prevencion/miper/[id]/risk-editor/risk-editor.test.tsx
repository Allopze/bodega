// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { taskKeyOf } from "@/lib/prevention/miper/matrix-tree"
import type { MiperEntrySnapshot } from "@/lib/prevention/miper/snapshot"
import type { WorkspaceMode } from "@/lib/prevention/miper/workspace-mode"

const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }))
vi.mock("next/navigation", () => ({ useRouter: () => router, usePathname: () => "/prevencion/miper/m1", useSearchParams: () => new URLSearchParams("fila=e1") }))
const deleteMiperEntryAction = vi.hoisted(() => vi.fn(async () => ({ ok: true, message: "Eliminado" })))
vi.mock("@/lib/toast", () => ({ toast: { error: vi.fn(), success: vi.fn(), info: vi.fn(), warning: vi.fn() } }))
const deleteMiperControlAction = vi.hoisted(() => vi.fn(async () => ({ ok: true, message: "Medida eliminada" })))
const saveMiperControlAction = vi.hoisted(() => vi.fn(async () => ({ ok: true, message: "Medida guardada", data: { id: "c2", version: 1 } })))
const duplicateMiperEntryAction = vi.hoisted(() => vi.fn(async () => ({ ok: true, message: "Duplicado", data: { id: "e9", version: 1 } })))
vi.mock("../../actions", () => ({ duplicateMiperEntryAction, deleteMiperEntryAction, deleteMiperControlAction, addMiperObservationAction: vi.fn(), saveMiperControlAction, respondMiperObservationAction: vi.fn(), resolveMiperObservationAction: vi.fn(), reopenMiperObservationAction: vi.fn() }))

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
  autosave: { commit, statusOf: () => ({ state: "idle", savedAt: null, message: null }), fieldError: () => undefined, versionOf: () => 1, clearErrors },
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
  it("un riesgo que no existe pide la foto nueva una vez y avisa cuando esa recarga termina, sin temporizador", async () => {
    router.refresh.mockClear()
    const { rerender } = render(<RiskEditor {...props({ entryId: "zzz" })} />)
    expect(router.refresh).toHaveBeenCalledTimes(1)
    // Sin reloj falso: el aviso no espera 2,5 s, sale al terminar la transición.
    expect(await screen.findByText("Este riesgo ya no existe")).toBeTruthy()
    rerender(<RiskEditor {...props({ entryId: "zzz", rows: [entry("e1", 1)] })} />)
    expect(router.refresh).toHaveBeenCalledTimes(1)
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
    render(<RiskEditor {...props({ entryId: "zzz" })} />)
    expect((await screen.findByRole("link", { name: "Volver a la matriz" })).getAttribute("href")).toBe("/prevencion/miper/m1")
  })
  it("si el riesgo llega con la foto nueva, se abre el editor y no el aviso", async () => {
    router.refresh.mockClear()
    const { rerender } = render(<RiskEditor {...props({ entryId: "e9", rows: [entry("e1", 1)] })} />)
    rerender(<RiskEditor {...props({ entryId: "e9", rows: [entry("e1", 1), entry("e9", 2, { hazard: "Recién creado" })] })} />)
    expect(await screen.findByRole("heading", { level: 2, name: "Recién creado" })).toBeTruthy()
    expect(screen.queryByText("Este riesgo ya no existe")).toBeNull()
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
    const autosave = { ...props().autosave, statusOf: (id: string) => (id === "e1" ? { state: "error" as const, savedAt: null, message: "Versión desactualizada" } : { state: "idle" as const, savedAt: null, message: null }) }
    render(<RiskEditor {...props({ autosave })} />)
    fireEvent.click(screen.getByRole("button", { name: "Recargar riesgo" }))
    expect(router.refresh).toHaveBeenCalledTimes(1)
    expect(clearErrors).toHaveBeenCalledWith("e1")
  })

  it("el estado de guardado es el del riesgo abierto: el rechazo de otro riesgo no aparece ni ofrece «Recargar riesgo»", () => {
    const statuses: Record<string, { state: "error" | "saved"; savedAt: number | null; message: string | null }> = {
      e1: { state: "saved", savedAt: Date.UTC(2026, 9, 2, 15, 30), message: null },
      e2: { state: "error", savedAt: null, message: "La fila cambió mientras la editabas." },
    }
    const autosave = { ...props().autosave, statusOf: (id: string) => statuses[id] ?? { state: "idle" as const, savedAt: null, message: null } }
    render(<RiskEditor {...props({ autosave })} />)
    expect(screen.getByText(/^Guardado a las \d{2}:\d{2}$/).getAttribute("role")).toBe("status")
    expect(screen.queryByText(/No se guardó/)).toBeNull()
    expect(screen.queryByRole("button", { name: "Recargar riesgo" })).toBeNull()
  })

  it("guardar o borrar una medida no pide un router.refresh(): la acción ya revalida la página", async () => {
    const control = { id: "c1", hierarchy: "administrative" as const, description: "Pausas activas", responsibleUserId: null, responsibleName: "Supervisor", dueDate: "2026-10-30", status: "proposed" }
    router.refresh.mockClear()
    render(<RiskEditor {...props({ step: "medidas", rows: [entry("e1", 1, { controls: [control] })], data: { ...props().data, controlVersions: { c1: 1 } } })} />)
    // Borrar.
    fireEvent.click(screen.getByRole("button", { name: "Eliminar la medida: Pausas activas" }))
    fireEvent.click(await screen.findByRole("button", { name: "Eliminar medida" }))
    await waitFor(() => expect(deleteMiperControlAction).toHaveBeenCalledWith({ matrixId: "m1", controlId: "c1", expectedVersion: 1 }))
    // Editar y guardar: el formulario se cierra (vuelve la tarjeta).
    fireEvent.click(screen.getByRole("button", { name: "Editar la medida: Pausas activas" }))
    fireEvent.click(screen.getByRole("button", { name: "Guardar medida" }))
    await waitFor(() => expect(saveMiperControlAction).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(screen.getByRole("button", { name: "Editar la medida: Pausas activas" })).toBeTruthy())
    expect(router.refresh).not.toHaveBeenCalled()
  })

  it("el rótulo visible de la descripción de la medida es su nombre accesible (WCAG 2.5.3)", () => {
    render(<RiskEditor {...props({ step: "medidas" })} />)
    fireEvent.click(screen.getByRole("button", { name: "Agregar medida" }))
    const group = screen.getByRole("group", { name: "Nueva medida de control" })
    expect(within(group).getByRole("textbox", { name: "Descripción de la medida" })).toBeTruthy()
    expect(within(group).getByText("Descripción de la medida")).toBeTruthy()
    expect(within(group).queryByText("Medida de control")).toBeNull()
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

  it("«Duplicar riesgo» guarda el scroll del riesgo y olvida el de la copia antes del router.push", async () => {
    window.history.replaceState(null, "", "/prevencion/miper/m1?fila=e1")
    sessionStorage.setItem("miper:scroll:/prevencion/miper/m1?fila=e9", "300")
    const well = document.createElement("div")
    well.setAttribute("data-shell-scroll", "")
    well.scrollTop = 120
    document.body.appendChild(well)
    router.push.mockClear()
    try {
      render(<RiskEditor {...props()} />)
      fireEvent.keyDown(screen.getByRole("button", { name: "Más acciones del riesgo 1" }), { key: "Enter" })
      fireEvent.click(screen.getByRole("menuitem", { name: "Duplicar riesgo" }))
      await waitFor(() => expect(router.push).toHaveBeenCalledWith("/prevencion/miper/m1?fila=e9"))
      expect(sessionStorage.getItem("miper:scroll:/prevencion/miper/m1?fila=e9")).toBeNull()
      expect(sessionStorage.getItem("miper:scroll:/prevencion/miper/m1?fila=e1")).toBe("120")
    } finally {
      well.remove()
      sessionStorage.clear()
    }
  })

  it("a < sm sólo el paso activo muestra su rótulo; los demás lo conservan para el lector de pantalla", () => {
    render(<RiskEditor {...props({ step: "evaluacion" })} />)
    const active = screen.getByRole("tab", { name: /Evaluación/, selected: true })
    const inactive = screen.getByRole("tab", { name: /Identificación/ })
    expect(within(active).getByText("Evaluación").className).not.toMatch(/max-sm:sr-only/)
    expect(within(inactive).getByText("Identificación").className).toMatch(/max-sm:sr-only/)
    // El nombre accesible del inactivo sigue completo: «1. Identificación…».
    expect(inactive.textContent).toMatch(/^1\.\s*Identificación/)
    // El paso es `inline-flex`: el espacio de «2. » queda al final de su ítem anónimo y el
    // navegador lo recorta («2.Evaluación», QA A2). La separación la da el margen del rótulo.
    expect(within(active).getByText("Evaluación").className).toMatch(/(^|\s)ml-1(\s|$)/)
  })

  it("el conteo de pendientes del paso usa plural real en el nombre accesible", () => {
    render(<RiskEditor {...props()} />)
    // jsdom no inserta los espacios entre los `sr-only` como lo hace el navegador («· 1 pendiente»): `\s*`.
    expect(screen.getByRole("tab", { name: /^3\. Medidas de control \(0\)\s*·\s*1\s*pendiente$/, selected: true })).toBeTruthy()
    const two = new Map([["e1", [
      { scope: "entry", entryId: "e1", field: "controls", message: "Un riesgo Importante o Intolerable exige al menos una medida de control.", severity: "error" },
      { scope: "entry", entryId: "e1", field: "controlledStatus", message: "Falta indicar si el riesgo está controlado.", severity: "error" },
    ]]]) as RiskEditorProps["issuesByEntry"]
    render(<RiskEditor {...props({ issuesByEntry: two })} />)
    expect(screen.getByRole("tab", { name: /^3\. Medidas de control \(0\)\s*·\s*2\s*pendientes$/, selected: true })).toBeTruthy()
  })

  it("un peligro en blanco se titula «Peligro sin describir», no queda un título vacío", () => {
    render(<RiskEditor {...props({ rows: [entry("e1", 1, { hazard: "   " })], step: "identificacion" })} />)
    expect(screen.getByRole("heading", { level: 2, name: "Peligro sin describir" })).toBeTruthy()
  })

  it("con una medida en edición, «Agregar medida» y el «Editar» de las otras quedan deshabilitados", () => {
    const a = { id: "c1", hierarchy: "administrative" as const, description: "Pausas activas", responsibleUserId: null, responsibleName: "Supervisor", dueDate: "2026-10-30", status: "proposed" }
    const b = { ...a, id: "c2", description: "Rotación de puestos" }
    render(<RiskEditor {...props({ step: "medidas", rows: [entry("e1", 1, { controls: [a, b] })], data: { ...props().data, controlVersions: { c1: 1, c2: 1 } } })} />)
    fireEvent.click(screen.getByRole("button", { name: "Editar la medida: Pausas activas" }))
    expect(screen.getByRole("button", { name: "Agregar medida" })).toBeDisabled()
    expect(screen.getByRole("button", { name: "Editar la medida: Rotación de puestos" })).toBeDisabled()
  })

  it("el resumen lateral es una región con título, no un complementary anidado, y sus bloques no repiten el título en aria-label", () => {
    const { container } = render(<RiskEditor {...props()} />)
    expect(screen.queryByRole("complementary")).toBeNull()
    expect(screen.getByRole("region", { name: "Resumen del riesgo" })).toBeTruthy()
    expect(container.querySelector('section[aria-label="Contexto"], section[aria-label="Chequeo del riesgo"], section[aria-label="Nivel de riesgo"]')).toBeNull()
  })
  it("la observación nueva dice a la vista que pide al menos 5 caracteres", () => {
    render(<RiskEditor {...props({ step: "seguimiento", mode: { ...mode, canObserve: true } })} />)
    expect(screen.getByRole("textbox", { name: "Nueva observación" })).toHaveAccessibleDescription("Mínimo 5 caracteres.")
  })

  it("sin otros pendientes el pie lo dice y, con filtro, aclara «en este filtro»", () => {
    const { unmount } = render(<RiskEditor {...props({ incomplete: new Set(["e1"]) })} />)
    expect(screen.getByText("No quedan otros riesgos pendientes.")).toBeTruthy()
    expect(screen.queryByRole("link", { name: "Siguiente pendiente" })).toBeNull()
    unmount()
    render(<RiskEditor {...props({ incomplete: new Set(["e1"]), matching: new Set(["e1"]) })} />)
    expect(screen.getByText("No quedan otros riesgos pendientes en este filtro.")).toBeTruthy()
  })

  it("el revisor con filtro ve Siguiente del filtro y quien edita ve Siguiente pendiente", () => {
    const scope = new Set(["e1", "e3"])
    const { unmount } = render(<RiskEditor {...props({ editable: false, matching: scope, step: "seguimiento" })} />)
    // Conserva el paso en el que va el revisor.
    expect(screen.getByRole("link", { name: "Siguiente del filtro" }).getAttribute("href")).toBe("/prevencion/miper/m1?fila=e3&paso=seguimiento")
    expect(screen.queryByRole("link", { name: "Siguiente pendiente" })).toBeNull()
    unmount()
    const solo = render(<RiskEditor {...props({ editable: false, matching: new Set(["e1"]) })} />)
    expect(screen.queryByRole("link", { name: "Siguiente del filtro" })).toBeNull()
    expect(screen.getByText("No hay otros riesgos en este filtro.")).toBeTruthy()
    solo.unmount()
    render(<RiskEditor {...props({ editable: true, matching: scope })} />)
    expect(screen.getByRole("link", { name: "Siguiente pendiente" })).toBeTruthy()
    expect(screen.queryByRole("link", { name: "Siguiente del filtro" })).toBeNull()
  })
  it("en los extremos de la tarea, «‹ Anterior» y «Siguiente ›» quedan como botones deshabilitados", () => {
    const { unmount } = render(<RiskEditor {...props()} />)
    expect(screen.getByRole("button", { name: "‹ Anterior" })).toBeDisabled()
    expect(screen.getByRole("link", { name: "Siguiente ›" })).toBeTruthy()
    unmount()
    render(<RiskEditor {...props({ entryId: "e2" })} />)
    expect(screen.getByRole("button", { name: "Siguiente ›" })).toBeDisabled()
    expect(screen.getByText("2 de 2 en la tarea")).toBeTruthy()
  })

  it("en modo lectura, un riesgo sin medidas lo dice en el paso Medidas", () => {
    render(<RiskEditor {...props({ editable: false, step: "medidas" })} />)
    expect(screen.getByText("Sin medidas de control.")).toBeTruthy()
    expect(screen.queryByRole("button", { name: "Agregar medida" })).toBeNull()
  })
})
