// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { buildMatrixTree } from "@/lib/prevention/miper/matrix-tree"
import type { MiperEntrySnapshot } from "@/lib/prevention/miper/snapshot"

const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }))
vi.mock("next/navigation", () => ({ useRouter: () => router, usePathname: () => "/prevencion/miper/m1", useSearchParams: () => new URLSearchParams("tarea=k&clasificacion=important") }))
const saveMiperEntryAction = vi.hoisted(() => vi.fn())
vi.mock("../actions", () => ({ saveMiperEntryAction }))

const toastError = vi.hoisted(() => vi.fn())
vi.mock("@/lib/toast", () => ({ toast: { error: toastError, success: vi.fn() } }))

import { TaskView } from "./task-view"

const e = (id: string, rowNumber: number, overrides: Partial<MiperEntrySnapshot> = {}) => ({
  id, rowNumber, activity: "Transporte", task: "Carga", position: "Conductor", location: "Planta", exposedFemale: 0, exposedMale: 2, exposedOther: 0,
  riskFactorId: null, riskFactor: null, isRoutine: true, hazard: `Peligro ${rowNumber}`, risk: "Choque", probableDamage: "Fracturas",
  probability: 2, consequence: 4, magnitude: 8, classification: "important", controlledStatus: "no", controls: [], ...overrides,
}) as MiperEntrySnapshot
const rows = [e("a", 4), e("b", 7, { position: "Peoneta" })]
const task = buildMatrixTree(rows, { incomplete: new Set(["a"]), observed: new Set(), modified: new Set(), matching: null })[0]!.tasks[0]!
const base = { matrixId: "m1", task, incomplete: new Set(["a"]), observed: new Set<string>(), changes: new Map(), issuesByEntry: new Map([["a", [{ scope: "entry" as const, entryId: "a", field: "controls", message: "m", severity: "error" as const }]]]) }

describe("TaskView", () => {
  it("al volver del editor retoma el scroll que tenía la tarea", async () => {
    window.history.replaceState(null, "", "/prevencion/miper/m1?tarea=k")
    sessionStorage.setItem("miper:scroll:/prevencion/miper/m1?tarea=k", "320")
    const well = document.createElement("div")
    well.setAttribute("data-shell-scroll", "")
    const scrollTo = vi.fn()
    well.scrollTo = scrollTo
    document.body.appendChild(well)
    try {
      render(<TaskView {...base} editable />)
      await waitFor(() => expect(scrollTo).toHaveBeenCalledWith({ top: 320 }))
    } finally {
      well.remove()
      sessionStorage.clear()
    }
  })
  it("lista los riesgos como enlaces al editor, con estado y puesto cuando hay más de uno", () => {
    render(<TaskView {...base} editable />)
    const link = screen.getByRole("link", { name: /Riesgo #4: Peligro 4/ })
    expect(link.getAttribute("href")).toBe("/prevencion/miper/m1?clasificacion=important&fila=a")
    expect(screen.getByText("1 pendiente")).toBeTruthy()
    expect(screen.getByText("Completo")).toBeTruthy()
    expect(screen.getByText("Peoneta")).toBeTruthy()
    expect(screen.getByText("1 de 2 completos")).toBeTruthy()
  })
  it("«Agregar peligro» hereda el contexto, se inserta tras el último N° de la tarea y abre el editor", async () => {
    saveMiperEntryAction.mockResolvedValueOnce({ ok: true, data: { id: "nuevo", version: 1 } })
    render(<TaskView {...base} editable />)
    fireEvent.click(screen.getByRole("button", { name: "Agregar peligro" }))
    await waitFor(() => expect(router.push).toHaveBeenCalledWith("/prevencion/miper/m1?clasificacion=important&fila=nuevo&paso=identificacion"))
    expect(saveMiperEntryAction).toHaveBeenCalledWith({ matrixId: "m1", insertAfterRowNumber: 7, values: { activity: "Transporte", task: "Carga", position: "Conductor", location: "Planta", isRoutine: true } })
  })
  it("dos clics rápidos llaman a la acción una sola vez", async () => {
    saveMiperEntryAction.mockClear()
    let resolve!: (v: unknown) => void
    saveMiperEntryAction.mockReturnValueOnce(new Promise((r) => { resolve = r }))
    render(<TaskView {...base} editable />)
    const button = screen.getByRole("button", { name: "Agregar peligro" })
    fireEvent.click(button)
    fireEvent.click(button)
    expect(saveMiperEntryAction).toHaveBeenCalledTimes(1)
    resolve({ ok: false, message: "x" })
    await waitFor(() => expect(screen.getByRole("button", { name: "Agregar peligro" }).hasAttribute("disabled")).toBe(false))
  })
  it("si la acción lanza, el botón se libera y avisa", async () => {
    saveMiperEntryAction.mockRejectedValueOnce(new Error("boom"))
    render(<TaskView {...base} editable />)
    fireEvent.click(screen.getByRole("button", { name: "Agregar peligro" }))
    await waitFor(() => expect(toastError).toHaveBeenCalledWith("No se pudo agregar el peligro."))
    await waitFor(() => expect(screen.getByRole("button", { name: "Agregar peligro" }).hasAttribute("disabled")).toBe(false))
  })
  it("sin edición no ofrece agregar", () => {
    render(<TaskView {...base} editable={false} />)
    expect(screen.queryByRole("button", { name: "Agregar peligro" })).toBeNull()
  })

  it("«Agregar peligro» guarda el scroll de la tarea y olvida el del riesgo nuevo antes del router.push", async () => {
    window.history.replaceState(null, "", "/prevencion/miper/m1?tarea=k&clasificacion=important")
    const destino = "/prevencion/miper/m1?clasificacion=important&fila=nuevo&paso=identificacion"
    sessionStorage.setItem(`miper:scroll:${destino}`, "500")
    const well = document.createElement("div")
    well.setAttribute("data-shell-scroll", "")
    well.scrollTop = 240
    well.scrollTo = vi.fn()
    document.body.appendChild(well)
    router.push.mockClear()
    try {
      saveMiperEntryAction.mockResolvedValueOnce({ ok: true, data: { id: "nuevo", version: 1 } })
      render(<TaskView {...base} editable />)
      fireEvent.click(screen.getByRole("button", { name: "Agregar peligro" }))
      await waitFor(() => expect(router.push).toHaveBeenCalledWith(destino))
      expect(sessionStorage.getItem(`miper:scroll:${destino}`)).toBeNull()
      expect(sessionStorage.getItem("miper:scroll:/prevencion/miper/m1?tarea=k&clasificacion=important")).toBe("240")
    } finally {
      well.remove()
      sessionStorage.clear()
    }
  })
})
