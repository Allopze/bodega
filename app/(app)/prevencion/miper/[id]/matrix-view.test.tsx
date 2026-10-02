// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { buildMatrixTree, taskKeyOf } from "@/lib/prevention/miper/matrix-tree"
import type { MiperEntrySnapshot } from "@/lib/prevention/miper/snapshot"

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn(), push: vi.fn() }), usePathname: () => "/prevencion/miper/m1", useSearchParams: () => new URLSearchParams("") }))

import { MatrixView } from "./matrix-view"

const e = (id: string, rowNumber: number, activity: string, task: string) => ({ id, rowNumber, activity, task, position: "P", location: null, exposedFemale: 0, exposedMale: 1, exposedOther: 0, riskFactorId: null, riskFactor: null, isRoutine: true, hazard: `Peligro ${id}`, risk: "R", probableDamage: "D", probability: 1, consequence: 1, magnitude: 1, classification: "tolerable", controlledStatus: "yes", controls: [] }) as MiperEntrySnapshot
const rows = [e("a", 1, "Transporte", "Carga"), e("b", 2, "Transporte", "Descarga"), e("c", 3, "Oficina", "Archivo")]
const ctx = { incomplete: new Set(["a"]), observed: new Set<string>(), modified: new Set<string>() }
const base = { editable: true, incomplete: ctx.incomplete, observed: ctx.observed, changes: new Map(), issuesByEntry: new Map(), riskFactors: [], hasBaseline: false, onNewTask: vi.fn() }

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
})
