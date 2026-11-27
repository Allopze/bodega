// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"
import { PanelTabs } from "./panel-tabs"

afterEach(cleanup)

const nav = () => screen.getByRole("navigation", { name: "Secciones del panel de mantención" })
const hrefOf = (name: string) => screen.getByRole("link", { name }).getAttribute("href")

describe("PanelTabs", () => {
  it("rotula las pestañas Hoy, Planificación, Correctivo y Preventivo; las de unidad ya no existen", () => {
    render(<PanelTabs active="hoy" params={{}} />)
    expect(screen.getAllByRole("link").map((link) => link.textContent)).toEqual(["Hoy", "Planificación", "Correctivo", "Preventivo"])
    expect(screen.queryByRole("link", { name: "Por kilómetros" })).toBeNull()
    expect(screen.queryByRole("link", { name: "Por horas" })).toBeNull()
    expect(hrefOf("Hoy")).toBe("/mantencion/panel")
    expect(hrefOf("Planificación")).toBe("/mantencion/panel?pestana=planificacion")
    expect(hrefOf("Correctivo")).toBe("/mantencion/panel?pestana=correctivo")
    expect(hrefOf("Preventivo")).toBe("/mantencion/panel?pestana=preventivo")
  })

  it("cada enlace lleva la unidad, el período y la faena de la URL actual, y nada propio de la pestaña que se deja", () => {
    render(
      <PanelTabs
        active="correctivo"
        params={{
          pestana: "correctivo", unidad: "h", desde: "2026-01-01", hasta: "2026-10-31", faena: "ws-1", equipo: "v-1", frecuencia: "40000",
          page: "2", x_equipo: "v-1", x_mes: "2026-10", x_ot: "ot:1", estado: "vencida", fecha_hasta: "2026-12-27", ficha: "v-1", pauta: "r:1",
        }}
      />,
    )
    const carried = "unidad=h&desde=2026-01-01&hasta=2026-10-31&faena=ws-1"
    expect(hrefOf("Hoy")).toBe(`/mantencion/panel?${carried}`)
    expect(hrefOf("Planificación")).toBe(`/mantencion/panel?pestana=planificacion&${carried}`)
    expect(hrefOf("Correctivo")).toBe(`/mantencion/panel?pestana=correctivo&${carried}`)
    expect(hrefOf("Preventivo")).toBe(`/mantencion/panel?pestana=preventivo&${carried}`)
  })

  it("marca la pestaña activa con aria-current", () => {
    render(<PanelTabs active="preventivo" params={{}} />)
    expect(screen.getByRole("link", { name: "Preventivo" }).getAttribute("aria-current")).toBe("page")
    expect(nav().querySelectorAll("[aria-current]")).toHaveLength(1)
  })

  it("bajo las pestañas va la pregunta que responde la activa; «Hoy» no la lleva", () => {
    render(<PanelTabs active="planificacion" params={{}} />)
    expect(screen.getByText(/¿Qué equipo necesita mantención y cuándo\?/)).toBeTruthy()
    cleanup()
    render(<PanelTabs active="correctivo" params={{}} />)
    expect(screen.getByText(/¿Qué se rompió, en qué equipo/)).toBeTruthy()
    cleanup()
    render(<PanelTabs active="preventivo" params={{}} />)
    expect(screen.getByText(/¿Se están cumpliendo las pautas/)).toBeTruthy()
    cleanup()
    const { container } = render(<PanelTabs active="hoy" params={{}} />)
    expect(container.querySelector("p")).toBeNull()
  })
})
