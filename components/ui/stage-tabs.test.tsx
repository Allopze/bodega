// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

let search = "revision=pendiente&page=3&faena=x"
vi.mock("next/navigation", () => ({
  usePathname: () => "/mantencion/registros",
  useSearchParams: () => new URLSearchParams(search),
}))

const { StageTabs } = await import("./stage-tabs")

const TABS = [
  { value: "pendiente", label: "Por revisar", count: 8, countTone: "signal" as const },
  { value: "revisado", label: "Revisados", count: 0 },
  { value: "", label: "Todos" },
]

describe("StageTabs con parámetro propio", () => {
  afterEach(cleanup)

  it("marca la activa por `param`, conserva los demás filtros y quita el parámetro de página", () => {
    render(<StageTabs tabs={TABS} ariaLabel="Revisión" param="revision" />)
    expect(screen.getByRole("link", { name: /^Por revisar\s*8$/ }).getAttribute("aria-current")).toBe("page")
    expect(screen.getByRole("link", { name: /^Revisados\s*0$/ }).getAttribute("href")).toBe("/mantencion/registros?revision=revisado&faena=x")
    expect(screen.getByRole("link", { name: "Todos" }).getAttribute("href")).toBe("/mantencion/registros?faena=x")
  })

  it("`pageParam` cambia cuál parámetro se reinicia", () => {
    search = "revision=pendiente&pagina=3&page=9"
    render(<StageTabs tabs={TABS} ariaLabel="Revisión" param="revision" pageParam="pagina" />)
    expect(screen.getByRole("link", { name: /^Revisados\s*0$/ }).getAttribute("href")).toBe("/mantencion/registros?revision=revisado&page=9")
  })

  it("el tono de señal es sólo del contador y sólo con algo pendiente", () => {
    search = "revision=revisado"
    render(<StageTabs tabs={TABS} ariaLabel="Revisión" param="revision" />)
    expect(screen.getByText("8").className).toContain("--color-signal-ink")
    expect(screen.getByText("0").className).not.toContain("--color-signal-ink")
  })
})
