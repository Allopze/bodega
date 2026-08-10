// @vitest-environment jsdom

import * as React from "react"
import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { DashboardScopeControls } from "./dashboard-scope-controls"
import type { DashboardScope } from "./dashboard-scope"

// El selector de faena del alcance global navega con `router.replace`. En jsdom
// no hay router de Next, y sin este mock el componente entero no monta.
const replace = vi.fn()
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace, push: vi.fn(), refresh: vi.fn() }),
}))

const worksiteOptions = [
  { id: "ws-norte", name: "Faena Norte" },
  { id: "ws-sur", name: "Faena Sur" },
]

const allWorksitesScope: DashboardScope = { worksiteId: "all", worksiteName: null, period: "mes", view: "resumen" }

function renderHeader(props: Partial<React.ComponentProps<typeof DashboardScopeControls>> = {}) {
  return render(
    <DashboardScopeControls
      scope={allWorksitesScope}
      worksites={worksiteOptions}
      allWorksitesLabel="Todas las faenas"
      {...props}
    />,
  )
}

describe("DashboardScopeControls — alcance global", () => {
  it("elegir faena reencuadra el tablero por la URL, no la lista", () => {
    renderHeader()

    fireEvent.click(screen.getByRole("combobox", { name: "Faena del tablero" }))
    fireEvent.click(screen.getByRole("option", { name: "Faena Norte" }))

    expect(replace).toHaveBeenCalledWith("/dashboard?faena=ws-norte", { scroll: false })
  })

  /*
   * El `pending` a mano se ponía en `true` y nadie lo bajaba: como la navegación
   * es un `replace` sobre el mismo segmento, el componente no se desmonta y el
   * selector quedaba `disabled` para siempre — una sola faena por recarga.
   */
  it("sigue habilitado después de elegir una faena, para poder cambiarla otra vez", () => {
    renderHeader()

    fireEvent.click(screen.getByRole("combobox", { name: "Faena del tablero" }))
    fireEvent.click(screen.getByRole("option", { name: "Faena Norte" }))

    expect(screen.getByRole("combobox", { name: "Faena del tablero" })).not.toBeDisabled()
  })

  // `WorksiteSelect` emite "" al elegir "todas", no el `allValue`. Sin
  // normalizar, la URL quedaba con un `?faena=` vacío colgando.
  it("volver a todas las faenas limpia el parámetro en vez de dejarlo vacío", () => {
    renderHeader({ scope: { worksiteId: "ws-sur", worksiteName: "Faena Sur", period: "anio", view: "resumen" } })

    fireEvent.click(screen.getByRole("combobox", { name: "Faena del tablero" }))
    fireEvent.click(screen.getByRole("option", { name: "Todas las faenas" }))

    expect(replace).toHaveBeenCalledWith("/dashboard?periodo=anio", { scroll: false })
  })

  it("ofrece los tres períodos como enlaces que conservan la faena", () => {
    renderHeader({ scope: { worksiteId: "ws-sur", worksiteName: "Faena Sur", period: "mes", view: "resumen" } })

    expect(screen.getByRole("link", { name: "Trimestre" })).toHaveAttribute("href", "/dashboard?faena=ws-sur&periodo=trimestre")
    expect(screen.getByRole("link", { name: "Año" })).toHaveAttribute("href", "/dashboard?faena=ws-sur&periodo=anio")
    expect(screen.getByRole("link", { name: "Mes" })).toHaveAttribute("aria-current", "page")
  })

  // La vista es la tercera dimensión: los enlaces de período no pueden perderla.
  it("los enlaces de período conservan también la vista activa", () => {
    renderHeader({ scope: { worksiteId: "all", worksiteName: null, period: "mes", view: "flota" } })

    expect(screen.getByRole("link", { name: "Trimestre" }))
      .toHaveAttribute("href", "/dashboard?vista=flota&periodo=trimestre")
  })

  // Un rol de faena única no tiene nada que elegir.
  it("esconde el selector de faena con una sola faena autorizada", () => {
    renderHeader({ worksites: [{ id: "ws-norte", name: "Faena Norte" }] })

    expect(screen.queryByRole("combobox", { name: "Faena del tablero" })).toBeNull()
    expect(screen.getByRole("link", { name: "Trimestre" })).toBeDefined()
  })
})
