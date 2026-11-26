// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"
import { PanelTabs } from "./panel-tabs"

afterEach(cleanup)

const nav = () => screen.getByRole("navigation", { name: "Secciones del panel de mantención" })
const hrefOf = (name: string) => screen.getByRole("link", { name }).getAttribute("href")

describe("PanelTabs", () => {
  it("rotula las dos pestañas por unidad como «Por kilómetros» y «Por horas», y conserva sus valores de URL", () => {
    render(<PanelTabs active="hoy" params={{}} />)
    expect(screen.getAllByRole("link").map((link) => link.textContent)).toEqual(["Hoy", "Planificación", "Por kilómetros", "Por horas"])
    expect(screen.queryByRole("link", { name: "Camiones" })).toBeNull()
    expect(screen.queryByRole("link", { name: "Máquinas" })).toBeNull()
    // Hay enlaces guardados con `pestana=camiones|maquinas`: la URL no cambia, sólo el rótulo.
    expect(hrefOf("Por kilómetros")).toBe("/mantencion/panel?pestana=camiones")
    expect(hrefOf("Por horas")).toBe("/mantencion/panel?pestana=maquinas")
    expect(hrefOf("Hoy")).toBe("/mantencion/panel")
    expect(hrefOf("Planificación")).toBe("/mantencion/panel?pestana=planificacion")
  })

  it("cada enlace lleva el período y la faena de la URL actual, y no el equipo, la frecuencia, la página ni los filtros cruzados", () => {
    render(
      <PanelTabs
        active="camiones"
        params={{ pestana: "camiones", desde: "2026-01-01", hasta: "2026-10-31", faena: "ws-1", equipo: "v-1", frecuencia: "40000", page: "2", x_equipo: "v-1", x_mes: "2026-10", x_ot: "ot:1" }}
      />,
    )
    expect(hrefOf("Hoy")).toBe("/mantencion/panel?desde=2026-01-01&hasta=2026-10-31&faena=ws-1")
    expect(hrefOf("Planificación")).toBe("/mantencion/panel?pestana=planificacion&desde=2026-01-01&hasta=2026-10-31&faena=ws-1")
    expect(hrefOf("Por kilómetros")).toBe("/mantencion/panel?pestana=camiones&desde=2026-01-01&hasta=2026-10-31&faena=ws-1")
    expect(hrefOf("Por horas")).toBe("/mantencion/panel?pestana=maquinas&desde=2026-01-01&hasta=2026-10-31&faena=ws-1")
  })

  it("marca la pestaña activa con aria-current", () => {
    render(<PanelTabs active="maquinas" params={{}} />)
    expect(screen.getByRole("link", { name: "Por horas" }).getAttribute("aria-current")).toBe("page")
    expect(nav().querySelectorAll("[aria-current]")).toHaveLength(1)
  })
})
