// @vitest-environment jsdom
import React from "react"
import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

vi.mock("next/link", () => ({
  default: ({ href, replace, scroll, children, ...rest }: { href: string; replace?: boolean; scroll?: boolean; children: React.ReactNode } & Record<string, unknown>) => (
    <a href={href} data-replace={String(replace)} data-scroll={String(scroll)} {...rest}>{children}</a>
  ),
}))

import { FilterSummaryBar } from "@/components/ui/filter-summary-bar"
import { buildFieldAttentionStats } from "./cargas-attention"

afterEach(() => cleanup())

/** La tira tal como la pinta la página: las celdas de `buildFieldAttentionStats` dentro de `FilterSummaryBar`. */
function renderStrip(attention: Parameters<typeof buildFieldAttentionStats>[0], searchParams: Parameters<typeof buildFieldAttentionStats>[1] = {}) {
  return render(<FilterSummaryBar stats={buildFieldAttentionStats(attention, searchParams)} />)
}

describe("la tira de señales de terreno, ya pintada", () => {
  it("cada cifra con algo que mirar es un enlace que filtra con replace y sin mover el scroll", () => {
    renderStrip({ toValidate: 12, observed: 3, sealIncomplete: 5, photosIncomplete: 7 }, { periodo: "2026-10", faena: "w-1" })
    const expected: Array<[RegExp, string]> = [
      [/Por validar/, "/combustibles/cargas?periodo=2026-10&faena=w-1&estado=por-validar"],
      [/Con observación/, "/combustibles/cargas?periodo=2026-10&faena=w-1&estado=con-observacion"],
      [/Sello incompleto/, "/combustibles/cargas?periodo=2026-10&faena=w-1&sello=faltante"],
      [/Menos de 4 fotos/, "/combustibles/cargas?periodo=2026-10&faena=w-1&evidencia=faltante"],
    ]
    for (const [name, href] of expected) {
      const link = screen.getByRole("link", { name })
      expect(link).toHaveAttribute("href", href)
      expect(link).toHaveAttribute("data-replace", "true")
      expect(link).toHaveAttribute("data-scroll", "false")
    }
  })

  it("el nombre accesible de cada enlace dice la señal y su cifra", () => {
    renderStrip({ toValidate: 12, observed: 3, sealIncomplete: 5, photosIncomplete: 7 })
    expect(screen.getByRole("link", { name: "Por validar 12" })).toBeInTheDocument()
    expect(screen.getByRole("link", { name: "Con observación 3" })).toBeInTheDocument()
    expect(screen.getByRole("link", { name: "Sello incompleto 5" })).toBeInTheDocument()
    expect(screen.getByRole("link", { name: "Menos de 4 fotos 7" })).toBeInTheDocument()
  })

  it("una señal en cero dice «Ninguna» y no es un enlace; las demás siguen siéndolo", () => {
    renderStrip({ toValidate: 0, observed: 4, sealIncomplete: 0, photosIncomplete: 0 })
    expect(screen.getAllByText("Ninguna")).toHaveLength(3)
    expect(screen.getAllByRole("link")).toHaveLength(1)
    expect(screen.getByRole("link", { name: "Con observación 4" })).toBeInTheDocument()
    expect(screen.queryByRole("link", { name: /Por validar/ })).toBeNull()
    expect(screen.getByText("Por validar")).toBeInTheDocument()
  })

  it("sin nada que mirar, las cuatro etiquetas siguen a la vista y ninguna es un enlace", () => {
    renderStrip({ toValidate: 0, observed: 0, sealIncomplete: 0, photosIncomplete: 0 })
    for (const label of ["Por validar", "Con observación", "Sello incompleto", "Menos de 4 fotos"]) expect(screen.getByText(label)).toBeInTheDocument()
    expect(screen.queryAllByRole("link")).toHaveLength(0)
  })
})
