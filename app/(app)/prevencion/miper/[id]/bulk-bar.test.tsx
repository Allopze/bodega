// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { MiperControlSnapshot, MiperEntrySnapshot } from "@/lib/prevention/miper/snapshot"

const router = vi.hoisted(() => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }))
vi.mock("next/navigation", () => ({ useRouter: () => router, usePathname: () => "/prevencion/miper/m1", useSearchParams: () => new URLSearchParams("") }))
const actions = vi.hoisted(() => ({ bulkAddMiperControlAction: vi.fn(), bulkPatchMiperEntriesAction: vi.fn(), bulkUpdateMiperControlsAction: vi.fn() }))
vi.mock("../actions", () => actions)
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }))
vi.mock("@/lib/toast", () => ({ toast }))

import { BulkBar } from "./bulk-bar"
import type { BulkContext } from "./bulk-shared"

/** Riesgos completos: Moderados, «No» controlados y sin medidas (un Moderado no las exige). */
const e = (id: string, rowNumber: number, controls: MiperControlSnapshot[] = []): MiperEntrySnapshot => ({
  id, rowNumber, activity: "Bodega", task: "Trasvasije", position: "Bodeguero", location: null, exposedFemale: 0, exposedMale: 2, exposedOther: 0,
  riskFactorId: "rf-1", riskFactor: "Químico", isRoutine: true, hazard: `Peligro ${rowNumber}`, risk: "Inhalación", probableDamage: "Intoxicación",
  probability: 2, consequence: 2, magnitude: 4, classification: "moderate", controlledStatus: "no", controls,
})
const control = (id: string, overrides: Partial<MiperControlSnapshot> = {}): MiperControlSnapshot => ({
  id, hierarchy: "administrative", description: `Medida ${id}`, responsibleUserId: null, responsibleName: null, dueDate: null, status: "proposed", isExisting: false, verificationFrequency: null, ...overrides,
})
const versions: Record<string, number> = { a: 4, b: 2 }
function context(overrides: Partial<BulkContext> = {}): BulkContext {
  return {
    matrixId: "m1",
    sync: { versionOf: (id) => versions[id], whenIdle: vi.fn(async () => {}), acknowledge: vi.fn() },
    setRows: vi.fn(), riskFactors: [], responsibleOptions: [{ id: "u1", name: "Ana Pérez" }], measureSuggestions: [],
    dictionaries: { activities: [], tasks: [], positions: [], locations: [] }, controlVersions: { c1: 3, c2: 7 }, ...overrides,
  }
}
const selected = [e("a", 4), e("b", 7)]

afterEach(() => { vi.clearAllMocks() })

describe("BulkBar (Fase D)", () => {
  it("sin selección no se pinta; con selección dice cuántos y ofrece las tres acciones", () => {
    const { rerender } = render(<BulkBar selected={[]} context={context()} onClear={vi.fn()} />)
    expect(screen.queryByRole("region", { name: "Acciones sobre la selección" })).toBeNull()
    rerender(<BulkBar selected={selected} context={context()} onClear={vi.fn()} />)
    const bar = screen.getByRole("region", { name: "Acciones sobre la selección" })
    expect(bar).toHaveTextContent("2 riesgos seleccionados")
    for (const name of ["Agregar medida a 2", "Cambiar ¿controlado?", "Asignar responsable / plazo", "Quitar selección"]) {
      expect(within(bar).getByRole("button", { name })).toBeEnabled()
    }
  })

  it("sobre 300 avisa cuántos quitar y no deja aplicar", () => {
    const many = Array.from({ length: 302 }, (_, index) => e(`r${index}`, index + 1))
    render(<BulkBar selected={many} context={context()} onClear={vi.fn()} />)
    expect(screen.getByRole("status")).toHaveTextContent("Se pueden cambiar hasta 300 riesgos a la vez: quita 2 de la selección.")
    expect(screen.getByRole("button", { name: "Agregar medida a 302" })).toBeDisabled()
    expect(screen.getByRole("button", { name: "Cambiar ¿controlado?" })).toBeDisabled()
    expect(screen.getByRole("button", { name: "Asignar responsable / plazo" })).toBeDisabled()
  })

  it("«Agregar medida a N» espera los guardados en curso, envía la versión de cada riesgo y vacía la selección", async () => {
    let idle!: () => void
    const ctx = context({ sync: { versionOf: (id) => versions[id], whenIdle: vi.fn(() => new Promise<void>((resolve) => { idle = resolve })), acknowledge: vi.fn() } })
    actions.bulkAddMiperControlAction.mockResolvedValueOnce({ ok: true, message: "Medida agregada a 2 riesgos", data: { created: 2 } })
    const onClear = vi.fn()
    render(<BulkBar selected={selected} context={ctx} onClear={onClear} />)
    fireEvent.click(screen.getByRole("button", { name: "Agregar medida a 2" }))
    const dialog = screen.getByRole("dialog", { name: "Agregar una medida a 2 riesgos" })
    fireEvent.click(within(dialog).getByRole("radio", { name: "Ya está implementada" }))
    fireEvent.change(within(dialog).getByRole("textbox", { name: "Descripción de la medida" }), { target: { value: "Ficha de seguridad a la vista" } })
    fireEvent.change(within(dialog).getByRole("textbox", { name: "Nombre o cargo responsable" }), { target: { value: "Jefe de bodega" } })
    fireEvent.click(within(dialog).getByRole("button", { name: "Agregar a 2" }))
    await waitFor(() => expect(ctx.sync.whenIdle).toHaveBeenCalledWith(["a", "b"]))
    // Mientras un guardado del riesgo sigue en curso, no se leen versiones ni se envía nada.
    expect(actions.bulkAddMiperControlAction).not.toHaveBeenCalled()
    idle()
    await waitFor(() => expect(onClear).toHaveBeenCalled())
    expect(actions.bulkAddMiperControlAction).toHaveBeenCalledWith({
      matrixId: "m1", items: [{ entryId: "a", expectedVersion: 4 }, { entryId: "b", expectedVersion: 2 }],
      values: { hierarchy: "administrative", description: "Ficha de seguridad a la vista", responsibleUserId: null, responsibleName: "Jefe de bodega", isExisting: true, verificationFrequency: null, dueDate: null },
    })
    expect(toast.success).toHaveBeenCalledWith("Medida agregada a 2 riesgos")
  })

  it("antes de agregar una medida por implementar sin plazo avisa qué riesgos quedan con pendientes nuevos", () => {
    render(<BulkBar selected={selected} context={context()} onClear={vi.fn()} />)
    fireEvent.click(screen.getByRole("button", { name: "Agregar medida a 2" }))
    const dialog = screen.getByRole("dialog")
    fireEvent.change(within(dialog).getByRole("textbox", { name: "Nombre o cargo responsable" }), { target: { value: "Jefe de bodega" } })
    // Sin descripción todavía no hay medida que evaluar.
    expect(within(dialog).queryByText(/quedan con pendientes nuevos/)).toBeNull()
    fireEvent.change(within(dialog).getByRole("textbox", { name: "Descripción de la medida" }), { target: { value: "Ventilación forzada" } })
    expect(within(dialog).getByText(/2 riesgos quedan con pendientes nuevos: #4 y #7\./)).toBeTruthy()
    // Ya implementada no lleva plazo (D5): con responsable, nada queda pendiente.
    fireEvent.click(within(dialog).getByRole("radio", { name: "Ya está implementada" }))
    expect(within(dialog).queryByText(/quedan con pendientes nuevos/)).toBeNull()
  })

  it("«Cambiar ¿controlado?» anota las versiones nuevas y cambia las filas en pantalla sin esperar la foto", async () => {
    const ctx = context()
    actions.bulkPatchMiperEntriesAction.mockResolvedValueOnce({ ok: true, message: "2 riesgos actualizados", data: { entries: [{ id: "a", version: 5 }, { id: "b", version: 3 }] } })
    render(<BulkBar selected={selected} context={ctx} onClear={vi.fn()} />)
    fireEvent.click(screen.getByRole("button", { name: "Cambiar ¿controlado?" }))
    const dialog = screen.getByRole("dialog")
    expect(within(dialog).getByRole("button", { name: "Aplicar a 2" })).toBeDisabled()
    fireEvent.click(within(dialog).getByRole("radio", { name: "Sí" }))
    // «Sí» sin medidas: los dos quedan con un pendiente nuevo, y se dice antes.
    expect(within(dialog).getByText(/2 riesgos quedan con pendientes nuevos/)).toBeTruthy()
    fireEvent.click(within(dialog).getByRole("button", { name: "Aplicar a 2" }))
    await waitFor(() => expect(ctx.sync.acknowledge).toHaveBeenCalledWith({ a: 5, b: 3 }))
    expect(actions.bulkPatchMiperEntriesAction).toHaveBeenCalledWith({ matrixId: "m1", items: [{ entryId: "a", expectedVersion: 4 }, { entryId: "b", expectedVersion: 2 }], values: { controlledStatus: "yes" } })
    const updater = vi.mocked(ctx.setRows).mock.calls[0]![0]
    expect(updater([e("a", 4), e("z", 9)]).map((row) => [row.id, row.controlledStatus])).toEqual([["a", "yes"], ["z", "no"]])
  })

  it("un rechazo queda en el diálogo con «Recargar la matriz» y la selección se conserva", async () => {
    actions.bulkPatchMiperEntriesAction.mockResolvedValueOnce({ ok: false, message: "1 riesgo cambió mientras editabas; recarga la matriz para ver los cambios de la otra persona." })
    const onClear = vi.fn()
    render(<BulkBar selected={selected} context={context()} onClear={onClear} />)
    fireEvent.click(screen.getByRole("button", { name: "Cambiar ¿controlado?" }))
    fireEvent.click(screen.getByRole("radio", { name: "No" }))
    fireEvent.click(screen.getByRole("button", { name: "Aplicar a 2" }))
    expect(await screen.findByRole("alert")).toHaveTextContent("1 riesgo cambió mientras editabas")
    fireEvent.click(screen.getByRole("button", { name: "Recargar la matriz" }))
    expect(router.refresh).toHaveBeenCalled()
    expect(onClear).not.toHaveBeenCalled()
    expect(screen.getByRole("dialog")).toBeTruthy()
  })

  it("«Asignar responsable / plazo»: «Sin responsable» acota las medidas y cada una viaja con su versión", async () => {
    const withControls = [e("a", 4, [control("c1")]), e("b", 7, [control("c2", { responsibleName: "Bodeguero", isExisting: true, verificationFrequency: "Mensual" })])]
    actions.bulkUpdateMiperControlsAction.mockResolvedValueOnce({ ok: true, message: "1 medida actualizada", data: { updated: 1 } })
    const onClear = vi.fn()
    render(<BulkBar selected={withControls} context={context()} onClear={onClear} />)
    fireEvent.click(screen.getByRole("button", { name: "Asignar responsable / plazo" }))
    const dialog = screen.getByRole("dialog")
    // Todo parte en «no cambiar»: no hay nada que aplicar.
    expect(within(dialog).getByRole("button", { name: "Aplicar a 2 medidas" })).toBeDisabled()
    fireEvent.click(within(dialog).getByRole("radio", { name: "Sin responsable (1)" }))
    fireEvent.click(within(dialog).getByRole("combobox", { name: "Responsable de la medida" }))
    fireEvent.click(screen.getByRole("option", { name: "Ana Pérez" }))
    fireEvent.click(within(dialog).getByRole("button", { name: "Aplicar a 1 medida" }))
    await waitFor(() => expect(onClear).toHaveBeenCalled())
    expect(actions.bulkUpdateMiperControlsAction).toHaveBeenCalledWith({ matrixId: "m1", items: [{ controlId: "c1", expectedVersion: 3 }], patch: { responsible: { kind: "user", userId: "u1" } } })
  })

  it("«Asignar responsable / plazo»: pasar a «ya implementada» la única medida por implementar de un Intolerable se avisa antes", () => {
    const intolerable = { ...e("a", 4, [control("c1", { responsibleName: "Supervisor", dueDate: "2026-11-30" })]), probability: 4, consequence: 4, magnitude: 16, classification: "intolerable" as const }
    render(<BulkBar selected={[intolerable]} context={context()} onClear={vi.fn()} />)
    fireEvent.click(screen.getByRole("button", { name: "Asignar responsable / plazo" }))
    const dialog = screen.getByRole("dialog")
    expect(within(dialog).queryByText(/pendientes nuevos/)).toBeNull()
    fireEvent.click(within(dialog).getByRole("radio", { name: "Ya está implementada" }))
    expect(within(dialog).getByText(/1 riesgo queda con pendientes nuevos: #4\./)).toBeTruthy()
  })

  it("«Cambiar ¿controlado?» sin nada que cambiar avisa con info y cierra", async () => {
    const ctx = context()
    actions.bulkPatchMiperEntriesAction.mockResolvedValueOnce({ ok: true, message: "No había nada que cambiar en los riesgos seleccionados.", data: { entries: [] } })
    const onClear = vi.fn()
    render(<BulkBar selected={selected} context={ctx} onClear={onClear} />)
    fireEvent.click(screen.getByRole("button", { name: "Cambiar ¿controlado?" }))
    fireEvent.click(screen.getByRole("radio", { name: "No" }))
    fireEvent.click(screen.getByRole("button", { name: "Aplicar a 2" }))
    await waitFor(() => expect(onClear).toHaveBeenCalled())
    expect(toast.info).toHaveBeenCalledWith("No había nada que cambiar en los riesgos seleccionados.")
    expect(toast.success).not.toHaveBeenCalled()
    expect(ctx.sync.acknowledge).toHaveBeenCalledWith({})
    expect(screen.queryByRole("dialog")).toBeNull()
  })
})
