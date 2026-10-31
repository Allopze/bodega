// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"
import type { Session } from "next-auth"
import { fuelAddDataOptions } from "@/lib/combustibles/section-nav"
import { AddFuelDataButton } from "./add-fuel-data-button"

function sessionWith(permissions: string[], isGlobal = true) {
  return { user: { id: "u", permissions, isGlobal, worksiteIds: [] } } as unknown as Session
}

function openDialog() {
  fireEvent.click(screen.getByRole("button", { name: /Agregar datos/ }))
  return screen.getByRole("dialog", { name: "¿Qué tienes en la mano?" })
}

describe("AddFuelDataButton", () => {
  afterEach(() => cleanup())

  it("pregunta qué tiene la persona en la mano y lleva cada opción a su importador", () => {
    render(<AddFuelDataButton options={fuelAddDataOptions(sessionWith(["combustibles:view", "combustibles:view_costs", "combustibles:import", "combustibles:tae_import"]))} />)
    const dialog = openDialog()
    expect(within(dialog).getByRole("link", { name: /Tengo una planilla de cargas/ })).toHaveAttribute("href", "/combustibles/fuentes/agregar/planilla")
    expect(within(dialog).getByRole("link", { name: /Tengo un reporte de tarjeta/ })).toHaveAttribute("href", "/combustibles/fuentes/agregar/tarjeta")
    expect(within(dialog).getByRole("link", { name: /Tengo facturas en Excel/ })).toHaveAttribute("href", "/combustibles/fuentes?agregar=facturas")
    expect(within(dialog).getByRole("link", { name: /Tengo telemetría de equipos/ })).toHaveAttribute("href", "/combustibles/fuentes?agregar=telemetria")
    expect(within(dialog).getByRole("link", { name: /Tengo despachos de un surtidor/ })).toHaveAttribute("href", "/combustibles/fuentes?agregar=surtidor")
    expect(within(dialog).getByRole("link", { name: /Tengo el histórico de sellos/ })).toHaveAttribute("href", "/combustibles/fuentes/agregar/sellos")
  })

  it("muestra deshabilitadas, con «Sin permiso», las opciones que la persona no puede usar", () => {
    // Importa pero no ve costos ni sube sellos, y no es de alcance global.
    render(<AddFuelDataButton options={fuelAddDataOptions(sessionWith(["combustibles:view", "combustibles:import"], false))} />)
    const dialog = openDialog()
    for (const name of [/Tengo una planilla de cargas/, /Tengo facturas en Excel/, /Tengo el histórico de sellos/]) {
      const option = within(dialog).getByRole("button", { name })
      expect(option).toBeDisabled()
      expect(option).toHaveTextContent("Sin permiso")
    }
    expect(within(dialog).getByRole("link", { name: /Tengo un reporte de tarjeta/ })).toBeInTheDocument()
    expect(within(dialog).queryByRole("link", { name: /Tengo facturas en Excel/ })).toBeNull()
  })

  it("sin ningún permiso de importación no se pinta el botón", () => {
    render(<AddFuelDataButton options={fuelAddDataOptions(sessionWith(["combustibles:view"]))} />)
    expect(screen.queryByRole("button", { name: /Agregar datos/ })).toBeNull()
  })
})
