// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { RankedList, formatRankedValue, type RankedListItem } from "./ranked-list"

const items: RankedListItem[] = [
  { key: "a", label: "Biodiversa", value: 50 },
  { key: "b", label: "Masisa", value: 30 },
  { key: "c", label: "Teno", value: 20 },
]

function labels() {
  return within(screen.getByRole("list")).getAllByRole("listitem").map((li) => li.querySelector("span[title]")?.getAttribute("title"))
}

describe("RankedList · share", () => {
  it("muestra el % del total junto al valor y ordena de mayor a menor", () => {
    render(<RankedList ariaLabel="Gasto por faena" format="count" items={[items[2]!, items[0]!, items[1]!]} />)
    expect(labels()).toEqual(["Biodiversa", "Masisa", "Teno"])
    expect(screen.getByText("50%")).toBeInTheDocument()
    expect(screen.getByText("30%")).toBeInTheDocument()
    expect(screen.getByText("20%")).toBeInTheDocument()
  })

  it("el % se lee «del total» para lectores de pantalla", () => {
    render(<RankedList ariaLabel="Gasto" format="count" items={items} />)
    expect(screen.getByRole("list", { name: "Gasto" })).toBeInTheDocument()
    expect(screen.getAllByText("del total", { exact: false })[0]).toHaveClass("sr-only")
  })

  it("`showShare={false}` oculta el porcentaje", () => {
    render(<RankedList ariaLabel="Gasto" format="count" items={items} showShare={false} />)
    expect(screen.queryByText("50%")).toBeNull()
  })

  it("el largo es la proporción sobre el mayor", () => {
    const { container } = render(<RankedList ariaLabel="Gasto" format="count" items={items} />)
    const widths = Array.from(container.querySelectorAll<HTMLElement>("[data-rank-fill]")).map((el) => el.style.width)
    expect(widths).toEqual(["100%", "60%", "40%"])
  })

  it("una sola matiz: todas las filas usan el primario", () => {
    const { container } = render(<RankedList ariaLabel="Gasto" format="count" items={items} />)
    const rows = Array.from(container.querySelectorAll("li"))
    expect(rows.every((li) => li.className.includes("[--rank-hue:var(--color-primary)]"))).toBe(true)
  })

  it("un valor cero no pinta el borde de color del relleno", () => {
    const { container } = render(<RankedList ariaLabel="Gasto" format="count" items={[...items, { key: "z", label: "Cero", value: 0 }]} />)
    const fills = container.querySelectorAll<HTMLElement>("[data-rank-fill]")
    const zero = fills[fills.length - 1]!
    expect(zero.style.width).toBe("0%")
    expect(zero.className).not.toContain("border-r-2")
    expect(fills[0]!.className).toContain("border-r-2")
  })

  it("el relleno entra con animación `motion-safe` y con retardo escalonado", () => {
    const { container } = render(<RankedList ariaLabel="Gasto" format="count" items={items} />)
    const fills = container.querySelectorAll<HTMLElement>("[data-rank-fill]")
    expect(fills[0]!.className).toContain("motion-safe:animate-[bar-grow-x_.9s_var(--ease-out)_both]")
    expect(fills[0]!.className).toContain("origin-left")
    expect(fills[0]!.style.animationDelay).toBe("0ms")
    expect(fills[2]!.style.animationDelay).toBe("140ms")
  })

  it("apuntar una fila atenúa las otras (grupo en la lista, `hover:` en la fila)", () => {
    const { container } = render(<RankedList ariaLabel="Gasto" format="count" items={items} />)
    expect(screen.getByRole("list")).toHaveClass("group/rank")
    const li = container.querySelector("li")!
    expect(li.className).toContain("group-hover/rank:opacity-60")
    expect(li.className).toContain("hover:opacity-100")
  })
})

describe("RankedList · threshold", () => {
  const compliance: RankedListItem[] = [
    { key: "ok", label: "Casa Matriz", value: 92, detail: "12 de 13" },
    { key: "mid", label: "Planta", value: 65, detail: "13 de 20" },
    { key: "low", label: "Bodega", value: 0, detail: "0 de 17" },
  ]
  const thresholds = { good: 80, warn: 50 }

  it("ordena lo peor primero por defecto", () => {
    render(<RankedList ariaLabel="Cumplimiento" format="percent" mode="threshold" thresholds={thresholds} items={compliance} />)
    expect(labels()).toEqual(["Bodega", "Planta", "Casa Matriz"])
  })

  it("colorea por umbral con los tokens `-ink` para el texto", () => {
    const { container } = render(<RankedList ariaLabel="Cumplimiento" format="percent" mode="threshold" thresholds={thresholds} items={compliance} />)
    const [bad, warn, good] = Array.from(container.querySelectorAll("li")) as [HTMLLIElement, HTMLLIElement, HTMLLIElement]
    expect(bad).toHaveAttribute("data-tone", "bad")
    expect(bad.className).toContain("[--rank-hue:var(--color-danger)]")
    expect(within(bad).getByText("0%")).toHaveClass("text-[var(--color-danger-ink)]")

    expect(warn).toHaveAttribute("data-tone", "warn")
    expect(warn.className).toContain("[--rank-hue:var(--color-signal)]")
    expect(within(warn).getByText("65%")).toHaveClass("text-[var(--color-signal-ink)]")

    expect(good).toHaveAttribute("data-tone", "good")
    expect(good.className).toContain("[--rank-hue:var(--color-primary)]")
    expect(within(good).getByText("92%")).toHaveClass("text-[var(--color-success-ink)]")
  })

  it("el color también se dice con palabras a lectores de pantalla", () => {
    render(<RankedList ariaLabel="Cumplimiento" format="percent" mode="threshold" thresholds={thresholds} items={compliance} />)
    expect(screen.getByText("(crítico)")).toHaveClass("sr-only")
  })

  it("el largo es el valor sobre 100, no sobre el mayor", () => {
    const { container } = render(<RankedList ariaLabel="Cumplimiento" format="percent" mode="threshold" thresholds={thresholds} items={compliance} />)
    const widths = Array.from(container.querySelectorAll<HTMLElement>("[data-rank-fill]")).map((el) => el.style.width)
    expect(widths).toEqual(["0%", "65%", "92%"])
  })

  it("muestra `detail` atenuado junto al valor y no el % del total", () => {
    render(<RankedList ariaLabel="Cumplimiento" format="percent" mode="threshold" thresholds={thresholds} items={compliance} />)
    expect(screen.getByText("0 de 17")).toHaveClass("text-[var(--color-text-muted)]")
    expect(screen.queryByText("del total", { exact: false })).toBeNull()
  })

  it("`invert` da vuelta la comparación: menos es mejor y lo peor es lo más alto", () => {
    const delays: RankedListItem[] = [
      { key: "a", label: "Pocos atrasos", value: 2 },
      { key: "b", label: "Algunos", value: 9 },
      { key: "c", label: "Muchos", value: 30 },
    ]
    const { container } = render(<RankedList ariaLabel="Atrasos" format="count" mode="threshold" thresholds={{ good: 5, warn: 15, invert: true }} items={delays} />)
    expect(labels()).toEqual(["Muchos", "Algunos", "Pocos atrasos"])
    expect(Array.from(container.querySelectorAll("li")).map((li) => li.getAttribute("data-tone"))).toEqual(["bad", "warn", "good"])
  })

  it("el límite exacto del umbral cuenta como cumplido", () => {
    const { container } = render(<RankedList ariaLabel="Cumplimiento" format="percent" mode="threshold" thresholds={thresholds} items={[
      { key: "g", label: "En el límite bueno", value: 80 },
      { key: "w", label: "En el límite medio", value: 50 },
      { key: "x", label: "Bajo", value: 49 },
    ]} />)
    expect(Array.from(container.querySelectorAll("li")).map((li) => li.getAttribute("data-tone")).sort()).toEqual(["bad", "good", "warn"])
  })
})

describe("RankedList · orden y límite", () => {
  it("`order=\"input\"` respeta el orden recibido", () => {
    render(<RankedList ariaLabel="Entrada" format="count" order="input" items={[items[2]!, items[0]!, items[1]!]} />)
    expect(labels()).toEqual(["Teno", "Biodiversa", "Masisa"])
  })

  it("`order=\"asc\"` pone lo menor primero", () => {
    render(<RankedList ariaLabel="Asc" format="count" order="asc" items={items} />)
    expect(labels()).toEqual(["Teno", "Masisa", "Biodiversa"])
  })

  const many: RankedListItem[] = Array.from({ length: 11 }, (_, i) => ({ key: `k${i}`, label: `Faena ${i}`, value: 100 - i }))

  it("corta en `limit` (8 por defecto) y manda el resto con «y N más» enlazado", () => {
    render(<RankedList ariaLabel="Muchas" format="count" items={many} moreHref="/compras?vista=faena" />)
    expect(within(screen.getByRole("list")).getAllByRole("listitem")).toHaveLength(8)
    const more = screen.getByRole("link", { name: "y 3 más" })
    expect(more).toHaveAttribute("href", "/compras?vista=faena")
  })

  it("sin `moreHref` igual dice cuántas filas quedan fuera, como texto", () => {
    render(<RankedList ariaLabel="Muchas" format="count" items={many} limit={5} />)
    expect(within(screen.getByRole("list")).getAllByRole("listitem")).toHaveLength(5)
    expect(screen.getByText("y 6 más")).toBeInTheDocument()
    expect(screen.queryByRole("link", { name: /más/ })).toBeNull()
  })

  it("sin truncar no hay «y N más»", () => {
    render(<RankedList ariaLabel="Pocas" format="count" items={items} moreHref="/x" />)
    expect(screen.queryByText(/más$/)).toBeNull()
  })

  it("sin ítems no dibuja nada (la celda del panel se esconde sola)", () => {
    const { container } = render(<RankedList ariaLabel="Vacía" format="count" items={[]} />)
    expect(container).toBeEmptyDOMElement()
  })
})

describe("RankedList · filas con enlace", () => {
  it("la fila con `href` es un enlace con hover de superficie y chevron", () => {
    render(<RankedList ariaLabel="Gasto" format="count" items={[...items, { key: "d", label: "Sin enlace", value: 10 }].map((it, i) => (i === 0 ? { ...it, href: "/faenas/1" } : it))} />)
    const link = screen.getByRole("link", { name: /Biodiversa/ })
    expect(link).toHaveAttribute("href", "/faenas/1")
    expect(link.className).toContain("hover:bg-[var(--color-surface-2)]")
    expect(link.querySelector("svg")).not.toBeNull()
    // La fila sin href no es enlace ni lleva chevron.
    expect(screen.queryByRole("link", { name: /Masisa/ })).toBeNull()
  })
})

describe("RankedList · medidor compacto (≤ 2 ítems, I-09)", () => {
  it("con dos filas deja de ser lista de barras de fondo y pasa a etiqueta + valor sobre una barra fina", () => {
    const { container } = render(<RankedList ariaLabel="Dos" format="count" items={[items[0]!, items[1]!]} />)
    expect(container.querySelector("[data-rank-fill]")).toBeNull()
    expect(within(screen.getByRole("list")).getAllByRole("listitem")).toHaveLength(2)
    // Barra fina de 6 px bajo la línea de etiqueta y valor.
    const bars = container.querySelectorAll("div.h-1\\.5")
    expect(bars).toHaveLength(2)
  })

  it("en share la barra mide la parte del total, no la del mayor", () => {
    const { container } = render(<RankedList ariaLabel="Dos" format="count" items={[items[0]!, items[1]!]} />)
    const fills = Array.from(container.querySelectorAll<HTMLElement>("div.h-1\\.5 > div")).map((el) => el.style.width)
    expect(fills).toEqual(["62.5%", "37.5%"])
  })

  it("una fila sola llena su barra y muestra el detalle debajo", () => {
    const { container } = render(<RankedList ariaLabel="Una" format="clp" items={[{ key: "x", label: "Única faena", value: 1500, detail: "3 facturas" }]} />)
    expect(container.querySelector<HTMLElement>("div.h-1\\.5 > div")?.style.width).toBe("100%")
    expect(screen.getByText("3 facturas")).toBeInTheDocument()
  })

  it("en threshold conserva el color por umbral y el largo sobre 100", () => {
    const { container } = render(<RankedList ariaLabel="Dos" format="percent" mode="threshold" thresholds={{ good: 80, warn: 50 }} items={[{ key: "a", label: "Bodega", value: 30 }, { key: "b", label: "Planta", value: 90 }]} />)
    const rows = Array.from(container.querySelectorAll("li"))
    expect(rows.map((li) => li.getAttribute("data-tone"))).toEqual(["bad", "good"])
    expect(within(rows[0]!).getByText("30%")).toHaveClass("text-[var(--color-danger-ink)]")
    expect(Array.from(container.querySelectorAll<HTMLElement>("div.h-1\\.5 > div")).map((el) => el.style.width)).toEqual(["30%", "90%"])
  })

  it("con tres filas ya no es compacto", () => {
    const { container } = render(<RankedList ariaLabel="Tres" format="count" items={items} />)
    expect(container.querySelectorAll("[data-rank-fill]")).toHaveLength(3)
  })
})

describe("formatRankedValue", () => {
  it("redondea porcentajes y añade la unidad a los conteos", () => {
    expect(formatRankedValue(64.6, "percent")).toBe("65%")
    expect(formatRankedValue(1200, "count", " L")).toBe("1.200 L")
  })
})
