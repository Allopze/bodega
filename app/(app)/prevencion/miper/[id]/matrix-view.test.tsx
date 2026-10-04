// @vitest-environment jsdom
import { useState } from "react"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { buildMatrixTree, taskKeyOf } from "@/lib/prevention/miper/matrix-tree"
import type { MiperEntrySnapshot } from "@/lib/prevention/miper/snapshot"

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn() }), usePathname: () => "/prevencion/miper/m1", useSearchParams: () => new URLSearchParams("") }))
vi.mock("../actions", () => ({ bulkAddMiperControlAction: vi.fn(), bulkPatchMiperEntriesAction: vi.fn(), bulkUpdateMiperControlsAction: vi.fn() }))
vi.mock("@/lib/toast", () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

import type { BulkContext } from "./bulk-shared"
import { MatrixView } from "./matrix-view"

const e = (id: string, rowNumber: number, activity: string, task: string) => ({ id, rowNumber, activity, task, position: "P", location: null, exposedFemale: 0, exposedMale: 1, exposedOther: 0, riskFactorId: null, riskFactor: null, isRoutine: true, hazard: `Peligro ${id}`, risk: "R", probableDamage: "D", probability: 1, consequence: 1, magnitude: 1, classification: "tolerable", controlledStatus: "yes", controls: [] }) as MiperEntrySnapshot
const rows = [e("a", 1, "Transporte", "Carga"), e("b", 2, "Transporte", "Descarga"), e("c", 3, "Oficina", "Archivo")]
const ctx = { incomplete: new Set(["a"]), observed: new Set<string>(), modified: new Set<string>() }
const base = { matrixId: "m1", editable: true, incomplete: ctx.incomplete, observed: ctx.observed, changes: new Map(), issuesByEntry: new Map(), onNewTask: vi.fn(), onClearFilters: vi.fn() }

afterEach(() => {
  sessionStorage.clear()
  document.querySelectorAll("[data-shell-scroll]").forEach((node) => node.remove())
})

describe("MatrixView", () => {
  it("muestra cada actividad con sus tareas como enlaces y el avance por tarea", () => {
    render(<MatrixView {...base} tree={buildMatrixTree(rows, { ...ctx, matching: null })} filtered={false} />)
    expect(screen.getByRole("heading", { level: 2, name: /Transporte/ })).toBeTruthy()
    const carga = screen.getByRole("link", { name: /Carga/ })
    expect(carga.getAttribute("href")).toBe(`/prevencion/miper/m1?tarea=${taskKeyOf({ activity: "Transporte", task: "Carga" })}`)
    expect(screen.getByText("0 de 1 completos")).toBeTruthy()
  })
  it("con filtro muestra los riesgos que coinciden bajo su tarea", () => {
    render(<MatrixView {...base} tree={buildMatrixTree(rows, { ...ctx, matching: new Set(["b"]) })} filtered />)
    expect(screen.getByRole("link", { name: "Riesgo #2: Peligro b" })).toBeTruthy()
    expect(screen.queryByRole("heading", { level: 2, name: /Oficina/ })).toBeNull()
  })
  it("plegar una actividad oculta sus tareas", () => {
    render(<MatrixView {...base} tree={buildMatrixTree(rows, { ...ctx, matching: null })} filtered={false} />)
    const toggle = screen.getByRole("button", { name: /Transporte/ })
    fireEvent.click(toggle)
    expect(toggle.getAttribute("aria-expanded")).toBe("false")
    expect(screen.queryByRole("link", { name: /Carga/ })).toBeNull()
  })
  it("sin riesgos ofrece crear la primera tarea", () => {
    render(<MatrixView {...base} tree={[]} filtered={false} />)
    fireEvent.click(screen.getByRole("button", { name: "Nueva tarea" }))
    expect(base.onNewTask).toHaveBeenCalled()
  })
  it("con filtros y sin coincidencias explica qué pasa y ofrece «Ver todos los riesgos» (A4), no un segundo «Limpiar filtros»", () => {
    render(<MatrixView {...base} tree={[]} filtered />)
    expect(screen.getByText("Ningún riesgo coincide con los filtros")).toBeTruthy()
    expect(screen.queryByRole("button", { name: "Nueva tarea" })).toBeNull()
    expect(screen.queryByRole("button", { name: "Limpiar filtros" })).toBeNull()
    fireEvent.click(screen.getByRole("button", { name: "Ver todos los riesgos" }))
    expect(base.onClearFilters).toHaveBeenCalledTimes(1)
  })
  it("las actividades plegadas se recuerdan al volver a la matriz (abrir una tarea la desmonta)", () => {
    const tree = buildMatrixTree(rows, { ...ctx, matching: null })
    const first = render(<MatrixView {...base} tree={tree} filtered={false} />)
    fireEvent.click(screen.getByRole("button", { name: /Transporte/ }))
    first.unmount()
    render(<MatrixView {...base} tree={tree} filtered={false} />)
    expect(screen.getByRole("button", { name: /Transporte/ }).getAttribute("aria-expanded")).toBe("false")
    expect(screen.getByRole("button", { name: /Oficina/ }).getAttribute("aria-expanded")).toBe("true")
    expect(screen.queryByRole("link", { name: /Carga/ })).toBeNull()
  })
  it("las plegadas de otra matriz no se aplican", () => {
    const tree = buildMatrixTree(rows, { ...ctx, matching: null })
    const first = render(<MatrixView {...base} tree={tree} filtered={false} />)
    fireEvent.click(screen.getByRole("button", { name: /Transporte/ }))
    first.unmount()
    render(<MatrixView {...base} matrixId="m2" tree={tree} filtered={false} />)
    expect(screen.getByRole("button", { name: /Transporte/ }).getAttribute("aria-expanded")).toBe("true")
  })
  it("al montarse retoma el scroll que tenía su URL al salir", async () => {
    window.history.replaceState(null, "", "/prevencion/miper/m1?buscar=cami")
    sessionStorage.setItem("miper:scroll:/prevencion/miper/m1?buscar=cami", "640")
    const well = document.createElement("div")
    well.setAttribute("data-shell-scroll", "")
    const scrollTo = vi.fn()
    well.scrollTo = scrollTo
    document.body.appendChild(well)
    render(<MatrixView {...base} tree={buildMatrixTree(rows, { ...ctx, matching: null })} filtered={false} />)
    await waitFor(() => expect(scrollTo).toHaveBeenCalledWith({ top: 640 }))
  })
  it("el título de una actividad con espacios y tildes nombra su región", () => {
    const accented = [e("z", 1, "Lavado de camión", "Enjuague")]
    render(<MatrixView {...base} tree={buildMatrixTree(accented, { ...ctx, matching: null })} filtered={false} />)
    expect(screen.getByRole("region", { name: /Lavado de camión/ })).toBeTruthy()
  })

  it("con filtros ofrece «Seleccionar» y «Seleccionar los N resultados»; quitar los filtros termina la selección (Fase D)", () => {
    const bulk: BulkContext = {
      matrixId: "m1", sync: { versionOf: () => 1, whenIdle: async () => {}, acknowledge: vi.fn() }, setRows: vi.fn(), riskFactors: [], responsibleOptions: [],
      measureSuggestions: [], dictionaries: { activities: [], tasks: [], positions: [], locations: [] }, controlVersions: {},
    }
    const structure = buildMatrixTree(rows, { ...ctx, matching: null })
    const filteredTree = buildMatrixTree(rows, { ...ctx, matching: new Set(["a", "b"]) })
    const { rerender } = render(<MatrixView {...base} bulk={bulk} tree={structure} filtered={false} />)
    // Sin filtros la matriz lista tareas, no riesgos: no hay qué seleccionar.
    expect(screen.queryByRole("button", { name: "Seleccionar riesgos" })).toBeNull()
    rerender(<MatrixView {...base} bulk={bulk} tree={filteredTree} filtered />)
    expect(screen.queryByRole("checkbox")).toBeNull()
    fireEvent.click(screen.getByRole("button", { name: "Seleccionar riesgos" }))
    expect(screen.getByRole("checkbox", { name: "Seleccionar el riesgo #2: Peligro b" }).closest("a")).toBeNull()
    fireEvent.click(screen.getByRole("button", { name: "Seleccionar los 2 resultados" }))
    expect(screen.getByRole("region", { name: "Acciones sobre la selección" })).toHaveTextContent("2 riesgos seleccionados")
    rerender(<MatrixView {...base} bulk={bulk} tree={structure} filtered={false} />)
    expect(screen.queryByRole("region", { name: "Acciones sobre la selección" })).toBeNull()
    rerender(<MatrixView {...base} bulk={bulk} tree={filteredTree} filtered />)
    expect(screen.queryByRole("checkbox")).toBeNull()
  })
})


it("Seleccionar riesgos abre resultados completos sin filtros y volver a estructura termina la selección", () => {
  const bulk: BulkContext = {
    matrixId: "m1", sync: { versionOf: () => 1, whenIdle: async () => {}, acknowledge: vi.fn() }, setRows: vi.fn(), riskFactors: [], responsibleOptions: [],
    measureSuggestions: [], dictionaries: { activities: [], tasks: [], positions: [], locations: [] }, controlVersions: {},
  }
  function Example() {
    const [presentation, setPresentation] = useState<"estructura" | "resultados">("estructura")
    return <MatrixView {...base} bulk={bulk} tree={buildMatrixTree(rows, { ...ctx, matching: null })} filtered={false} presentation={presentation} onPresentationChange={setPresentation} />
  }
  render(<Example />)
  expect(screen.queryByRole("checkbox")).toBeNull()
  fireEvent.click(screen.getByRole("button", { name: "Seleccionar riesgos" }))
  expect(screen.getByText("3 riesgos en toda la matriz")).toBeTruthy()
  expect(screen.getAllByRole("checkbox")).toHaveLength(3)
  fireEvent.click(screen.getByRole("button", { name: "Seleccionar los 3 resultados" }))
  expect(screen.getByRole("region", { name: "Acciones sobre la selección" })).toHaveTextContent("3 riesgos seleccionados")
  fireEvent.click(screen.getByRole("button", { name: "Ver por actividades y tareas" }))
  expect(screen.queryByRole("checkbox")).toBeNull()
  expect(screen.queryByRole("region", { name: "Acciones sobre la selección" })).toBeNull()
})
