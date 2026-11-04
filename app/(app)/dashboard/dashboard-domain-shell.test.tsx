// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import type { ReactNode } from "react"

vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => <a href={href} {...rest}>{children}</a> }))

import { CoverageNotice } from "@/components/charts/coverage-notice"
import { DASHBOARD_DOMAINS } from "./dashboard-domains"
import { DomainSection } from "./dashboard-domain-shell"

/**
 * `DomainSection coverage`: el aviso de cobertura de datos de una sección del tablero (Fase 4, CHART-022).
 * Va bajo el encabezado, sobre las cifras que advierte, y no deja un hueco cuando no hay nada que decir.
 */
describe("DomainSection · aviso de cobertura", () => {
  const section = (coverage?: ReactNode) => (
    <DomainSection domain={DASHBOARD_DOMAINS.flota} links={[]} kpis={<div>tiles</div>} charts={<div>gráficos</div>} coverage={coverage} />
  )

  it("pinta el aviso entre el encabezado de la sección y sus cifras", () => {
    const { container } = render(section(<CoverageNotice gapMonths={["2026-09"]} subject="las cifras de combustible de los últimos 6 meses" />))

    const notice = container.querySelector("[data-coverage-notice]")!
    expect(notice.textContent).toContain("Sin datos del proveedor en sep-2026: las cifras de combustible de los últimos 6 meses no incluyen ese mes.")
    const heading = screen.getByRole("heading", { level: 2 })
    expect(heading.compareDocumentPosition(notice) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(notice.compareDocumentPosition(screen.getByText("tiles")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it("sin aviso, o con un aviso sin meses, no deja ni un contenedor vacío", () => {
    const without = render(section())
    expect(without.container.querySelector("[data-coverage-notice]")).toBeNull()
    without.unmount()

    // `CoverageNotice` sin meses no pinta nada: el contenedor de la sección tampoco debe dejar aire de más.
    const empty = render(section(<CoverageNotice gapMonths={[]} subject="las cifras" />))
    expect(empty.container.querySelector("[data-coverage-notice]")).toBeNull()
    const wrapper = empty.container.querySelector("[data-domain-coverage]")!
    expect(wrapper.matches(":empty")).toBe(true)
    expect(wrapper.className).toContain("empty:hidden")
  })
})
