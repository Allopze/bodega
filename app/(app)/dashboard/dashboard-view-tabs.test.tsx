// @vitest-environment jsdom

import * as React from "react"
import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { DashboardViewTabs } from "./dashboard-view-tabs"
import { availableDashboardViews } from "./dashboard-views"
import type { DashboardScope } from "./dashboard-scope"

const JEFATURA = [
  "requests:view_all", "purchasing:view", "approvals:approve", "receiving:view",
  "warehouse:view_stock", "operations:view_work", "combustibles:view", "flota:view",
]

const views = availableDashboardViews(JEFATURA)
const scope = (view: DashboardScope["view"]): DashboardScope => ({ worksiteId: "all", worksiteName: null, period: "mes", view })

describe("DashboardViewTabs", () => {
  it("no tiene pestaña Mi trabajo: la cola vive en /pendientes", () => {
    render(<DashboardViewTabs views={views} scope={scope("resumen")} />)

    expect(screen.queryByText(/Mi trabajo/)).toBeNull()
    expect(screen.getByRole("link", { name: "Resumen" })).toHaveAttribute("aria-current", "page")
  })

  it("sin un área activa el desplegable dice \"Por área\" y no marca aria-current", () => {
    render(<DashboardViewTabs views={views} scope={scope("resumen")} />)

    const trigger = screen.getByRole("button", { name: "Por área" })
    expect(trigger).not.toHaveAttribute("aria-current")
  })

  it("con un área activa el disparador dice qué es y cuál está elegida, con aria-current", () => {
    render(<DashboardViewTabs views={views} scope={scope("bodega")} />)

    const trigger = screen.getByRole("button", { name: "Por área: Bodega" })
    expect(trigger).toHaveAttribute("aria-current", "page")
  })

  it("usa el término del sidebar para Flota", () => {
    render(<DashboardViewTabs views={views} scope={scope("flota")} />)

    expect(screen.getByRole("button", { name: "Por área: Control operacional" })).toBeDefined()
  })
})
