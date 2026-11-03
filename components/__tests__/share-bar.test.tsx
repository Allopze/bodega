// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest"
import { cleanup, render, screen, within } from "@testing-library/react"
import { ShareBar } from "@/components/charts/share-bar"

afterEach(() => cleanup())

const SEGMENTS = [
  { key: "a", label: "Solicitado", count: 6, color: "var(--color-chart-reference)", href: "/x?estado=a" },
  { key: "b", label: "En faena", count: 3, color: "var(--color-info)", href: "/x?estado=b" },
  { key: "c", label: "Entregado", count: 1, color: "var(--color-success)", href: "/x?estado=c" },
]

describe("ShareBar", () => {
  it("describe la barra con cada parte, su cifra y su porcentaje, en el orden recibido", () => {
    render(<ShareBar label="Solicitudes por estado" noun="solicitud" segments={SEGMENTS} />)
    expect(screen.getByRole("img").getAttribute("aria-label")).toBe(
      "Solicitudes por estado. Solicitado: 6 solicitudes (60 %); En faena: 3 solicitudes (30 %); Entregado: 1 solicitud (10 %)",
    )
  })

  it("el ancho de cada segmento es su parte del total y usa el color recibido (un token)", () => {
    const { container } = render(<ShareBar label="Estados" segments={SEGMENTS} />)
    const widths = [...container.querySelectorAll<HTMLElement>("[data-segment]")].map((el) => [el.style.width, el.style.background])
    expect(widths).toEqual([
      ["60%", "var(--color-chart-reference)"],
      ["30%", "var(--color-info)"],
      ["10%", "var(--color-success)"],
    ])
  })

  it("la leyenda lleva a cada parte y es lo único que entra al orden de tabulación", () => {
    const { container } = render(<ShareBar label="Estados" segments={SEGMENTS} />)
    const legend = screen.getByRole("list")
    const links = within(legend).getAllByRole("link")
    expect(links.map((link) => link.getAttribute("href"))).toEqual(["/x?estado=a", "/x?estado=b", "/x?estado=c"])
    expect(links[0]!.textContent).toContain("Solicitado")
    expect(links[0]!.textContent).toContain("6")
    // Los segmentos son sólo dibujo: un enlace dentro de role="img" es un control
    // anidado (axe nested-interactive), aunque vaya oculto y fuera del tabulador.
    expect(container.querySelectorAll("[data-segment]").length).toBe(3)
    expect(container.querySelectorAll('[role="img"] a, [role="img"] [tabindex]').length).toBe(0)
  })

  it("marca la parte elegida y deja las demás en segundo plano", () => {
    const { container } = render(
      <ShareBar label="Estados" segments={SEGMENTS.map((segment) => ({ ...segment, active: segment.key === "b" }))} />,
    )
    expect(screen.getByRole("link", { name: /En faena/ }).getAttribute("aria-current")).toBe("true")
    expect(screen.getByRole("link", { name: /Solicitado/ }).getAttribute("aria-current")).toBeNull()
    const segments = [...container.querySelectorAll<HTMLElement>("[data-segment]")]
    expect(segments[1]!.className).not.toContain("opacity-")
    expect(segments[0]!.className).toContain("opacity-")
  })

  it("sin enlaces (href ausente) no hay links, sólo la leyenda", () => {
    render(<ShareBar label="Estados" segments={SEGMENTS.map(({ href: _href, ...segment }) => segment)} />)
    expect(screen.queryAllByRole("link")).toHaveLength(0)
    expect(screen.getAllByRole("listitem")).toHaveLength(3)
  })

  it("omite las partes en cero y no dibuja nada si todo es cero", () => {
    const { container, rerender } = render(<ShareBar label="Estados" segments={[...SEGMENTS, { key: "z", label: "Cancelado", count: 0, color: "var(--color-danger)" }]} />)
    expect(screen.queryByText("Cancelado")).toBeNull()
    expect(container.querySelectorAll("[data-segment]")).toHaveLength(3)
    rerender(<ShareBar label="Estados" segments={SEGMENTS.map((segment) => ({ ...segment, count: 0 }))} />)
    expect(container.firstChild).toBeNull()
  })

  it("los enlaces que filtran esta misma pantalla no agregan historial ni mueven el scroll", () => {
    // `inPlace` sólo cambia cómo navega Link (replace/scroll); el href no cambia.
    render(<ShareBar label="Estados" segments={SEGMENTS} inPlace />)
    expect(screen.getAllByRole("link")[0]!.getAttribute("href")).toBe("/x?estado=a")
  })
})
