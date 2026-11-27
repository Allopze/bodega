// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"
import { PartsNotesAgeChart } from "./parts-notes-age-chart"

afterEach(cleanup)

const PATH = "/mantencion/notas-pedido"
const COUNTS = { "0-2": 3, "3-6": 0, "7-13": 2, "14+": 1 }
const hrefOf = (name: RegExp) => screen.getByRole("link", { name }).getAttribute("href")

describe("PartsNotesAgeChart", () => {
  it("sin notas no se dibuja: la página ya explica el vacío", () => {
    const { container } = render(<PartsNotesAgeChart counts={{ "0-2": 0, "3-6": 0, "7-13": 0, "14+": 0 }} active={undefined} path={PATH} raw={{ estado: "por_revisar" }} />)
    expect(container.textContent).toBe("")
  })

  it("dice la respuesta y cada tramo con notas es un enlace que filtra, conservando la pestaña y los otros filtros", () => {
    render(<PartsNotesAgeChart counts={COUNTS} active={undefined} path={PATH} raw={{ estado: "en_compra", faena: "ws-2", pagina: "3" }} />)
    expect(screen.getByText("6 notas; 1 lleva 14 días o más en su estado.")).toBeTruthy()
    const image = screen.getByRole("img", { name: /Notas de pedido por antigüedad en su estado actual/ })
    expect(image.getAttribute("aria-label")).toContain("0–2 días: 3 notas; 3–6 días: 0 notas; 7–13 días: 2 notas; 14 días o más: 1 notas")
    expect(hrefOf(/0–2 días/)).toBe(`${PATH}?estado=en_compra&faena=ws-2&antiguedad=0-2`)
    expect(hrefOf(/7–13 días/)).toBe(`${PATH}?estado=en_compra&faena=ws-2&antiguedad=7-13`)
    // El «+» viaja codificado: si no, la URL lo leería como un espacio.
    expect(hrefOf(/14 días o más/)).toBe(`${PATH}?estado=en_compra&faena=ws-2&antiguedad=14%2B`)
    // Un tramo vacío no es un enlace: no hay nada que filtrar.
    expect(screen.queryByRole("link", { name: /3–6 días/ })).toBeNull()
  })

  it("el tramo vigente se marca, su enlace es la salida y se ofrece «Quitar filtro»", () => {
    render(<PartsNotesAgeChart counts={COUNTS} active="7-13" path={PATH} raw={{ estado: "por_revisar", antiguedad: "7-13" }} />)
    expect(screen.getByText("Filtrando por «7–13 días»: 2 de 6 notas.")).toBeTruthy()
    const nav = within(screen.getByRole("list"))
    expect(nav.getByRole("link", { name: /7–13 días/ }).getAttribute("aria-current")).toBe("true")
    expect(nav.getByRole("link", { name: /7–13 días/ }).getAttribute("href")).toBe(`${PATH}?estado=por_revisar`)
    expect(screen.getByRole("link", { name: "Quitar filtro" }).getAttribute("href")).toBe(`${PATH}?estado=por_revisar`)
    // Los demás tramos cambian de tramo sin pasar por «sin filtro».
    expect(nav.getByRole("link", { name: /14 días o más/ }).getAttribute("href")).toBe(`${PATH}?estado=por_revisar&antiguedad=14%2B`)
  })
})
