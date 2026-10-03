// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import type { MiperEntrySnapshot } from "@/lib/prevention/miper/snapshot"

const router = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }))
vi.mock("next/navigation", () => ({ useRouter: () => router, usePathname: () => "/prevencion/miper/m1", useSearchParams: () => new URLSearchParams("") }))
const saveMiperEntryAction = vi.hoisted(() => vi.fn())
vi.mock("../actions", () => ({ saveMiperEntryAction }))

import { NewTaskDialog } from "./new-task-dialog"

const rows = [{ id: "a", rowNumber: 5, activity: "Transporte" }, { id: "b", rowNumber: 9, activity: "transporte " }, { id: "c", rowNumber: 12, activity: "Oficina" }] as MiperEntrySnapshot[]
const dictionaries = { activities: ["Transporte"], tasks: [], positions: [], locations: [], hazards: [], risks: [], damages: [], measures: [] }
const type = (label: string, value: string) => {
  const input = screen.getByRole("combobox", { name: label })
  fireEvent.focus(input)
  fireEvent.change(input, { target: { value } })
  fireEvent.blur(input)
}

describe("NewTaskDialog", () => {
  it("exige actividad, tarea y puesto, crea el primer riesgo tras la actividad existente y abre su editor", async () => {
    saveMiperEntryAction.mockResolvedValueOnce({ ok: true, data: { id: "nuevo", version: 1 } })
    render(<NewTaskDialog open onOpenChange={() => {}} matrixId="m1" rows={rows} dictionaries={dictionaries} />)
    const create = screen.getByRole("button", { name: "Crear tarea" }) as HTMLButtonElement
    expect(create.disabled).toBe(true)
    type("Actividad", "TRANSPORTE")
    type("Tarea", "Lavado de camión")
    type("Puesto de trabajo", "Conductor")
    fireEvent.click(create)
    await waitFor(() => expect(router.push).toHaveBeenCalledWith("/prevencion/miper/m1?fila=nuevo&paso=identificacion"))
    expect(saveMiperEntryAction).toHaveBeenCalledWith({ matrixId: "m1", insertAfterRowNumber: 9, values: { activity: "Transporte", task: "Lavado de camión", position: "Conductor", location: null, hazard: null } })
  })
  it("dos clics seguidos en Crear tarea llaman a la acción una sola vez", async () => {
    saveMiperEntryAction.mockClear()
    saveMiperEntryAction.mockReturnValueOnce(new Promise(() => {}))
    render(<NewTaskDialog open onOpenChange={() => {}} matrixId="m1" rows={rows} dictionaries={dictionaries} />)
    type("Actividad", "Oficina")
    type("Tarea", "Archivo")
    type("Puesto de trabajo", "Asistente")
    const create = screen.getByRole("button", { name: "Crear tarea" })
    fireEvent.click(create)
    fireEvent.click(create)
    expect(saveMiperEntryAction).toHaveBeenCalledTimes(1)
  })

  it("antes de abrir el editor del riesgo creado guarda el scroll actual y olvida el del destino", async () => {
    window.history.replaceState(null, "", "/prevencion/miper/m1")
    const destino = "/prevencion/miper/m1?fila=nuevo&paso=identificacion"
    sessionStorage.setItem(`miper:scroll:${destino}`, "500")
    const well = document.createElement("div")
    well.setAttribute("data-shell-scroll", "")
    well.scrollTop = 360
    document.body.appendChild(well)
    router.push.mockClear()
    try {
      saveMiperEntryAction.mockResolvedValueOnce({ ok: true, data: { id: "nuevo", version: 1 } })
      render(<NewTaskDialog open onOpenChange={() => {}} matrixId="m1" rows={rows} dictionaries={dictionaries} />)
      type("Actividad", "Oficina")
      type("Tarea", "Archivo")
      type("Puesto de trabajo", "Asistente")
      fireEvent.click(screen.getByRole("button", { name: "Crear tarea" }))
      await waitFor(() => expect(router.push).toHaveBeenCalledWith(destino))
      expect(sessionStorage.getItem(`miper:scroll:${destino}`)).toBeNull()
      expect(sessionStorage.getItem("miper:scroll:/prevencion/miper/m1")).toBe("360")
    } finally {
      well.remove()
      sessionStorage.clear()
    }
  })
})
