// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { buildMatrixTree, taskKeyOf } from "@/lib/prevention/miper/matrix-tree"
import type { MiperEntrySnapshot } from "@/lib/prevention/miper/snapshot"

const nav = vi.hoisted(() => ({ query: "" }))
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }), usePathname: () => "/prevencion/miper/m1", useSearchParams: () => new URLSearchParams(nav.query) }))
const bulkPatchMiperEntriesAction = vi.hoisted(() => vi.fn())
vi.mock("../actions", () => ({ bulkPatchMiperEntriesAction }))
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }))
vi.mock("@/lib/toast", () => ({ toast }))

import type { BulkContext } from "./bulk-shared"
import { contextChanges, TaskContextDialog } from "./task-context-dialog"

const e = (id: string, rowNumber: number, overrides: Partial<MiperEntrySnapshot> = {}): MiperEntrySnapshot => ({
  id, rowNumber, activity: "Transporte", task: "Carga", position: "Conductor", location: "Planta", exposedFemale: 0, exposedMale: 2, exposedOther: 0,
  riskFactorId: "f1", riskFactor: "Mecánico", isRoutine: true, hazard: `Peligro ${rowNumber}`, risk: "Choque", probableDamage: "Fracturas",
  probability: 2, consequence: 2, magnitude: 4, classification: "moderate", controlledStatus: "no", controls: [], ...overrides,
})
const taskOf = (rows: MiperEntrySnapshot[]) => buildMatrixTree(rows, { incomplete: new Set(), observed: new Set(), modified: new Set(), matching: null })[0]!.tasks[0]!
function context(): BulkContext {
  return {
    matrixId: "m1", sync: { versionOf: (id) => ({ a: 3, b: 1 })[id], whenIdle: vi.fn(async () => {}), acknowledge: vi.fn() }, setRows: vi.fn(), riskFactors: [],
    responsibleOptions: [], measureSuggestions: [], dictionaries: { activities: ["Transporte"], tasks: ["Carga", "Descarga"], positions: [], locations: [] }, controlVersions: {},
  }
}
const type = (label: string, value: string) => {
  const input = screen.getByRole("combobox", { name: label })
  fireEvent.focus(input)
  fireEvent.change(input, { target: { value } })
  fireEvent.blur(input)
}

afterEach(() => {
  vi.clearAllMocks()
  nav.query = ""
  window.history.replaceState(null, "", "/")
})

describe("contextChanges", () => {
  const task = taskOf([e("a", 4), e("b", 7, { position: "Peoneta" })])
  it("envía sólo lo que cambió; mayúsculas, tildes y espacios no son un cambio", () => {
    expect(contextChanges(task, { activity: " transporte ", task: "CARGA", position: "", location: "Planta" })).toEqual({})
    expect(contextChanges(task, { activity: "Transporte", task: "Carga de lodo", position: "", location: "" })).toEqual({ task: "Carga de lodo" })
  })
  it("un puesto distinto por riesgo: vacío se conserva y escrito se aplica a todos", () => {
    expect(contextChanges(task, { activity: "Transporte", task: "Carga", position: "Conductor", location: "Planta" })).toEqual({ position: "Conductor" })
  })
})

describe("TaskContextDialog (Fase D)", () => {
  it("prellena la actividad, la tarea y lo común; sin cambios no deja guardar", () => {
    render(<TaskContextDialog task={taskOf([e("a", 4), e("b", 7, { position: "Peoneta" })])} context={context()} onOpenChange={vi.fn()} />)
    expect(screen.getByRole("combobox", { name: "Actividad" })).toHaveValue("Transporte")
    expect(screen.getByRole("combobox", { name: "Tarea" })).toHaveValue("Carga")
    expect(screen.getByRole("combobox", { name: "Puesto de trabajo" })).toHaveValue("")
    expect(screen.getByRole("combobox", { name: "Puesto de trabajo" })).toHaveAccessibleDescription("Hoy los riesgos tienen distintos puestos. Si lo dejas vacío, cada uno conserva el suyo.")
    expect(screen.getByRole("combobox", { name: "Lugar específico" })).toHaveAccessibleDescription("Si lo dejas vacío, cada riesgo conserva su lugar actual.")
    expect(screen.getByRole("combobox", { name: "Lugar específico" })).toHaveValue("Planta")
    expect(screen.getByRole("button", { name: "Guardar cambios" })).toBeDisabled()
  })

  it("renombrar la tarea: envía la versión de cada riesgo, actualiza las filas y navega con replace a la clave nueva", async () => {
    nav.query = `tarea=${taskOf([e("a", 4)]).key}&clasificacion=moderate`
    window.history.replaceState(null, "", `/prevencion/miper/m1?${nav.query}`)
    const length = window.history.length
    const ctx = context()
    const onOpenChange = vi.fn()
    bulkPatchMiperEntriesAction.mockResolvedValueOnce({ ok: true, message: "2 riesgos actualizados", data: { entries: [{ id: "a", version: 4 }, { id: "b", version: 2 }] } })
    render(<TaskContextDialog task={taskOf([e("a", 4), e("b", 7)])} context={ctx} onOpenChange={onOpenChange} />)
    type("Tarea", "Carga de lodo")
    fireEvent.click(screen.getByRole("button", { name: "Guardar cambios" }))
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
    expect(ctx.sync.whenIdle).toHaveBeenCalledWith(["a", "b"])
    expect(bulkPatchMiperEntriesAction).toHaveBeenCalledWith({ matrixId: "m1", items: [{ entryId: "a", expectedVersion: 3 }, { entryId: "b", expectedVersion: 1 }], values: { task: "Carga de lodo" } })
    expect(ctx.sync.acknowledge).toHaveBeenCalledWith({ a: 4, b: 2 })
    // Las filas cambian en pantalla antes de navegar: la tarea nueva ya existe cuando la URL la pide.
    const rows = vi.mocked(ctx.setRows).mock.calls[0]![0]([e("a", 4), e("z", 9)])
    expect(rows.map((row) => [row.id, row.task])).toEqual([["a", "Carga de lodo"], ["z", "Carga"]])
    const key = taskKeyOf({ activity: "Transporte", task: "Carga de lodo" })
    expect(`${window.location.pathname}${window.location.search}`).toBe(`/prevencion/miper/m1?tarea=${key}&clasificacion=moderate`)
    // Replace, no push: «atrás» no vuelve a la clave vieja, que ya no existe.
    expect(window.history.length).toBe(length)
    expect(toast.success).toHaveBeenCalledWith("Tarea actualizada (2 riesgos)")
  })

  it("renombrar a una tarea que ya existe (otra grafía) la junta con ella: navega a la clave de esa tarea", async () => {
    const onOpenChange = vi.fn()
    bulkPatchMiperEntriesAction.mockResolvedValueOnce({ ok: true, data: { entries: [{ id: "a", version: 4 }] } })
    render(<TaskContextDialog task={taskOf([e("a", 4)])} context={context()} onOpenChange={onOpenChange} />)
    type("Tarea", "DESCARGA ")
    fireEvent.click(screen.getByRole("button", { name: "Guardar cambios" }))
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
    expect(window.location.search).toBe(`?tarea=${taskKeyOf({ activity: "Transporte", task: "Descarga" })}`)
  })

  it("sólo cambiar el puesto no cambia la clave: no navega", async () => {
    window.history.replaceState(null, "", "/prevencion/miper/m1?tarea=k")
    const onOpenChange = vi.fn()
    bulkPatchMiperEntriesAction.mockResolvedValueOnce({ ok: true, data: { entries: [{ id: "a", version: 4 }] } })
    render(<TaskContextDialog task={taskOf([e("a", 4)])} context={context()} onOpenChange={onOpenChange} />)
    type("Puesto de trabajo", "Operador de grúa")
    fireEvent.click(screen.getByRole("button", { name: "Guardar cambios" }))
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
    expect(bulkPatchMiperEntriesAction.mock.calls[0]![0].values).toEqual({ position: "Operador de grúa" })
    expect(window.location.search).toBe("?tarea=k")
  })

  it("más de 300 riesgos: dice por qué y no deja guardar", () => {
    const many = Array.from({ length: 301 }, (_, index) => e(`r${index}`, index + 1))
    render(<TaskContextDialog task={taskOf(many)} context={context()} onOpenChange={vi.fn()} />)
    type("Tarea", "Carga de lodo")
    expect(screen.getByRole("status")).toHaveTextContent("Esta tarea tiene 301 riesgos")
    expect(screen.getByRole("button", { name: "Guardar cambios" })).toBeDisabled()
  })
})
