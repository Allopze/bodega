// @vitest-environment jsdom

import * as React from "react"
import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { DashboardHeader, buildOperationalSummary } from "./dashboard-header"
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

function renderHeader(props: Partial<React.ComponentProps<typeof DashboardHeader>> = {}) {
  return render(
    <DashboardHeader
      firstName="Ana"
      summary={buildOperationalSummary(2, null)}
      contextLabel="Todas mis faenas autorizadas"
      refreshedAt="2026-07-25T12:00:00.000Z"
      scope={allWorksitesScope}
      worksiteOptions={worksiteOptions}
      {...props}
    />,
  )
}

describe("DashboardHeader — alcance global", () => {
  it("elegir faena reencuadra el tablero por la URL, no la lista", () => {
    renderHeader()

    fireEvent.click(screen.getByRole("combobox", { name: "Faena del tablero" }))
    fireEvent.click(screen.getByRole("option", { name: "Faena Norte" }))

    expect(replace).toHaveBeenCalledWith("/dashboard?faena=ws-norte", { scroll: false })
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
    renderHeader({ worksiteOptions: [{ id: "ws-norte", name: "Faena Norte" }] })

    expect(screen.queryByRole("combobox", { name: "Faena del tablero" })).toBeNull()
    expect(screen.getByRole("link", { name: "Trimestre" })).toBeDefined()
  })
})

/**
 * El saludo declara **una** cifra: el total de la cola.
 *
 * A5: antes enumeraba críticas, vencidas y entregas, y cada una de esas ya vivía
 * en su atajo y en su alerta — "críticas" aparecía cuatro veces en la misma
 * pantalla contando el tile.
 */
describe("buildOperationalSummary", () => {
  it("usa el total de la cola autorizada completa", () => {
    expect(buildOperationalSummary(39, null)).toBe("Tienes 39 tareas pendientes.")
  })

  it("no repite críticas, vencidas ni entregas", () => {
    const greeting = buildOperationalSummary(39, null)
    expect(greeting).not.toMatch(/crítica/i)
    expect(greeting).not.toMatch(/vencida/i)
    expect(greeting).not.toMatch(/entrega/i)
  })

  it("nombra la faena del alcance", () => {
    expect(buildOperationalSummary(5, "Faena Sur")).toBe("Tienes 5 tareas pendientes en Faena Sur.")
  })

  it("concuerda el singular y distingue el cero", () => {
    expect(buildOperationalSummary(1, null)).toBe("Tienes 1 tarea pendiente.")
    expect(buildOperationalSummary(0, "Faena Sur")).toBe("No tienes acciones pendientes en Faena Sur.")
  })
})
