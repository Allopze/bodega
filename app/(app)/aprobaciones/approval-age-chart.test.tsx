// @vitest-environment jsdom

import { cleanup, render, screen, within } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"
import { ApprovalAgeChart } from "./approval-age-chart"

afterEach(() => cleanup())

const COUNTS = { "0-1": 5, "2-3": 4, "4-7": 0, "mas-de-7": 3 }

describe("ApprovalAgeChart", () => {
  it("es una figura con la respuesta primero y los cuatro tramos en orden cronológico", () => {
    render(<ApprovalAgeChart counts={COUNTS} active="" searchParams={{}} />)
    const figure = screen.getByRole("figure", { name: "Antigüedad de lo pendiente" })
    expect(within(figure).getByText("12 ítems esperan tu decisión; 3 llevan más de 7 días.")).toBeTruthy()
    expect(figure.querySelector("[role=img]")?.getAttribute("aria-label")).toBe(
      "Ítems pendientes de decisión por antigüedad. 0–1 días: 5 ítems; 2–3 días: 4 ítems; 4–7 días: 0 ítems; Más de 7 días: 3 ítems",
    )
    const tramos = within(figure).getAllByRole("listitem").map((item) => item.textContent)
    expect(tramos[0]).toContain("0–1 días")
    expect(tramos[3]).toContain("Más de 7 días")
  })

  it("cada tramo con ítems filtra la cola por ?antiguedad= y conserva los demás filtros", () => {
    render(<ApprovalAgeChart counts={COUNTS} active="" searchParams={{ faena: "ws-1", urgencia: "high", page: "2" }} />)
    expect(screen.getByRole("link", { name: /0–1 días/ }).getAttribute("href")).toBe("/aprobaciones?faena=ws-1&urgencia=high&antiguedad=0-1")
    expect(screen.getByRole("link", { name: /Más de 7 días/ }).getAttribute("href")).toBe("/aprobaciones?faena=ws-1&urgencia=high&antiguedad=mas-de-7")
    // Un tramo vacío no lleva a una lista vacía.
    expect(screen.queryByRole("link", { name: /4–7 días/ })).toBeNull()
  })

  it("con un tramo elegido lo marca, lo dice y ofrece la salida", () => {
    render(<ApprovalAgeChart counts={COUNTS} active="2-3" searchParams={{ faena: "ws-1", antiguedad: "2-3" }} />)
    expect(screen.getByText("Filtrando por «2–3 días»: 4 de 12 ítems.")).toBeTruthy()
    const activo = screen.getByRole("link", { name: /2–3 días/ })
    expect(activo.getAttribute("aria-current")).toBe("true")
    // Elegirlo otra vez es quitar el filtro, y los demás tramos cambian el filtro.
    expect(activo.getAttribute("href")).toBe("/aprobaciones?faena=ws-1")
    expect(screen.getByRole("link", { name: "Quitar filtro" }).getAttribute("href")).toBe("/aprobaciones?faena=ws-1")
    expect(screen.getByRole("link", { name: /0–1 días/ }).getAttribute("href")).toBe("/aprobaciones?faena=ws-1&antiguedad=0-1")
  })

  it("el tramo elegido sigue siendo una salida aunque no tenga ítems", () => {
    render(<ApprovalAgeChart counts={COUNTS} active="4-7" searchParams={{ antiguedad: "4-7" }} />)
    expect(screen.getByRole("link", { name: /4–7 días/ }).getAttribute("href")).toBe("/aprobaciones")
  })

  it("sin nada pendiente no dibuja nada: la página ya tiene su estado vacío", () => {
    const { container } = render(<ApprovalAgeChart counts={{ "0-1": 0, "2-3": 0, "4-7": 0, "mas-de-7": 0 }} active="" searchParams={{}} />)
    expect(container.firstChild).toBeNull()
  })
})
