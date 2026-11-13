// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"
import { AddEquipmentButton } from "./add-equipment-button"

afterEach(cleanup)

async function open() {
  fireEvent.click(screen.getByRole("button", { name: "Agregar equipos" }))
  return within(await screen.findByRole("dialog", { name: "¿Cómo quieres agregar equipos?" }))
}

describe("«Agregar equipos»", () => {
  it("un solo botón que pregunta cómo: nuevo, importar o incorporar desde la flota", async () => {
    render(<AddEquipmentButton pendingFleet={89} />)
    const dialog = await open()
    expect(dialog.getByRole("link", { name: /^Nuevo equipo/ }).getAttribute("href")).toBe("/mantencion/equipos/nuevo")
    expect(dialog.getByRole("link", { name: /^Importar desde Excel/ }).getAttribute("href")).toBe("/mantencion/equipos/importar")
    const fleet = dialog.getByRole("link", { name: /^Incorporar desde la flota/ })
    expect(fleet.getAttribute("href")).toBe("/mantencion/equipos/incorporar")
    expect(fleet.textContent).toContain("89 vehículos ya están en la flota")
  })

  it("con vehículos por incorporar esa vía va primera, porque no se vuelve a escribir nada", async () => {
    render(<AddEquipmentButton pendingFleet={3} />)
    const dialog = await open()
    expect(dialog.getAllByRole("link")[0]!.textContent).toContain("Incorporar desde la flota")
  })

  it("sin vehículos por incorporar esa vía queda apagada y dice por qué", async () => {
    render(<AddEquipmentButton pendingFleet={0} />)
    const dialog = await open()
    expect(dialog.queryByRole("link", { name: /Incorporar desde la flota/ })).toBeNull()
    const off = dialog.getByRole("button", { name: /Incorporar desde la flota/ }) as HTMLButtonElement
    expect(off.disabled).toBe(true)
    expect(off.textContent).toContain("Todos los vehículos de la flota ya están en Mantención")
  })
})
