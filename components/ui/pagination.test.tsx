// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { Pagination } from "./pagination"
import { ServerPagination } from "./server-pagination"

vi.mock("next/link", () => ({
  default: ({ href, children, prefetch: _prefetch, scroll: _scroll, ...rest }: Record<string, unknown>) => (
    <a href={String(href)} {...rest}>{children as React.ReactNode}</a>
  ),
}))

afterEach(cleanup)

/**
 * Contrato móvil de los dos primitivos de paginación.
 *
 * 1. **Objetivo táctil de 44 px bajo `sm`** (WCAG 2.5.5, el mismo que ya usan
 *    el botón de menú y los `icon-mobile`). `Pagination` medía 28 px en móvil;
 *    `ServerPagination` ya tenía 44, y por eso mismo desbordaba:
 * 2. **Sólo anterior, actual y siguiente bajo `sm`.** Siete enlaces de 44 px
 *    más la ventana de números no caben en 320 px: la barra se salía 129 px
 *    del pozo del shell en Solicitudes y Trazabilidad, y el pozo la recortaba
 *    (`overflow-x-hidden`), así que "Página siguiente" quedaba fuera de
 *    alcance. Los números vuelven desde `sm`.
 */
const MOBILE_TARGET = ["h-11", "min-w-11"]
const HIDDEN_ON_MOBILE = ["hidden", "sm:inline-flex"]

function expectClasses(el: Element, classes: string[]) {
  const list = el.getAttribute("class")?.split(/\s+/) ?? []
  for (const c of classes) expect(list, `${el.outerHTML.slice(0, 120)} debería llevar ${c}`).toContain(c)
}

describe("Pagination (cliente) en móvil", () => {
  it("todos los controles miden 44 px bajo sm", () => {
    render(<Pagination page={5} total={300} perPage={30} onPage={() => {}} />)
    for (const button of screen.getAllByRole("button")) expectClasses(button, MOBILE_TARGET)
  })

  it("bajo sm deja visibles sólo anterior, la página actual y siguiente", () => {
    render(<Pagination page={5} total={300} perPage={30} onPage={() => {}} />)
    expect(screen.getByRole("button", { name: "Página anterior" }).className).not.toMatch(/(^|\s)hidden(\s|$)/)
    expect(screen.getByRole("button", { name: "Página siguiente" }).className).not.toMatch(/(^|\s)hidden(\s|$)/)
    expect(screen.getByRole("button", { name: "Ir a página 5" }).className).not.toMatch(/(^|\s)hidden(\s|$)/)
    for (const n of [1, 4, 6, 10]) expectClasses(screen.getByRole("button", { name: `Ir a página ${n}` }), HIDDEN_ON_MOBILE)
  })

  it("sigue navegando", () => {
    const onPage = vi.fn()
    render(<Pagination page={2} total={100} perPage={30} onPage={onPage} />)
    fireEvent.click(screen.getByRole("button", { name: "Página siguiente" }))
    expect(onPage).toHaveBeenCalledWith(3)
  })
})

describe("ServerPagination en móvil", () => {
  const pagination = { page: 5, totalItems: 400, totalPages: 20, offset: 80, limit: 20, from: 81, to: 100 }

  it("todos los controles miden 44 px bajo sm", () => {
    render(<ServerPagination pagination={pagination} hrefForPage={(p) => `/x?page=${p}`} />)
    for (const link of screen.getAllByRole("link")) expectClasses(link, MOBILE_TARGET)
  })

  it("bajo sm deja visibles sólo anterior, la página actual y siguiente", () => {
    render(<ServerPagination pagination={pagination} hrefForPage={(p) => `/x?page=${p}`} />)
    expect(screen.getByRole("link", { name: "Página anterior" }).className).not.toMatch(/(^|\s)hidden(\s|$)/)
    expect(screen.getByRole("link", { name: "Página siguiente" }).className).not.toMatch(/(^|\s)hidden(\s|$)/)
    expect(screen.getByRole("link", { name: "Ir a página 5" }).className).not.toMatch(/(^|\s)hidden(\s|$)/)
    for (const n of [1, 4, 6, 20]) expectClasses(screen.getByRole("link", { name: `Ir a página ${n}` }), HIDDEN_ON_MOBILE)
  })
})
