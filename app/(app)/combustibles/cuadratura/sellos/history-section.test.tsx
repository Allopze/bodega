import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"

vi.mock("next/link", () => ({ default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a> }))

import { SealHistorySection } from "./history-section"

const empty = { rows: [], total: 0, pagination: { page: 1, pageSize: 25, totalItems: 0, totalPages: 1, offset: 0 }, hrefForPage: () => "?" } as unknown as Parameters<typeof SealHistorySection>[0]

/** «Quitar filtros» sólo cuando hay un sello o una patente buscados (crítica 2026-11-15, paso 8). */
describe("historial de sellos vacío", () => {
  it("sin filtros habla del período y no ofrece quitar nada", () => {
    const out = renderToStaticMarkup(<SealHistorySection {...empty} />)
    expect(out).toContain("Sin movimientos de sello en el período")
    expect(out).not.toContain("Quitar filtros")
  })

  it("con un sello o una patente buscados ofrece quitarlos", () => {
    const out = renderToStaticMarkup(<SealHistorySection {...empty} clearHref="/combustibles/cuadratura/sellos?vista=historial" />)
    expect(out).toContain("Sin movimientos de sello para estos filtros")
    expect(out).toContain("Quitar filtros")
  })
})
