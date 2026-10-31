// @vitest-environment jsdom
/**
 * Las insignias de una fila de la bandeja (lista y hoja de decisión): un caso
 * cerrado dice su desenlace una sola vez —no «Descartado» dos veces, una como
 * estado y otra como resultado—, uno abierto dice su estado, y el color del
 * desenlace sale de un solo lugar.
 */
import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"
import { InboxRowBadges } from "./inbox-row-badges"

afterEach(() => cleanup())

describe("InboxRowBadges", () => {
  it("un caso cerrado muestra su desenlace una sola vez, sin repetir el estado", () => {
    render(
      <InboxRowBadges label="Sello repetido" kind="caso" severity="high" caseStatus="dismissed" decided={{ outcome: "Descartado" }} />,
    )

    expect(screen.getAllByText("Descartado")).toHaveLength(1)
    expect(screen.getByText("Sello repetido")).toBeInTheDocument()
    expect(screen.getByText("Alta")).toBeInTheDocument()
  })

  it("lo mismo con un caso resuelto", () => {
    render(<InboxRowBadges label="Sello repetido" kind="caso" severity="medium" caseStatus="resolved" decided={{ outcome: "Resuelto" }} />)

    expect(screen.getAllByText("Resuelto")).toHaveLength(1)
  })

  it("un caso abierto muestra su estado, y no hay desenlace", () => {
    const { unmount } = render(<InboxRowBadges label="Sello repetido" kind="caso" severity="critical" caseStatus="in_review" decided={null} />)
    expect(screen.getByText("Tomada")).toBeInTheDocument()
    expect(screen.getByText("Crítica")).toBeInTheDocument()
    unmount()

    render(<InboxRowBadges label="Sello repetido" kind="caso" severity="low" caseStatus="reopened" />)
    expect(screen.getByText("Reabierto")).toBeInTheDocument()
  })

  it("el estado nunca sale en lo que no es un caso (la lista no lo pasa)", () => {
    render(<InboxRowBadges label="Lectura menor a la anterior" kind="carga" severity={null} />)

    expect(screen.getByText("Lectura menor a la anterior")).toBeInTheDocument()
    expect(screen.queryByText("Abierto")).toBeNull()
    expect(screen.queryByText("Tomada")).toBeNull()
  })

  it("«No cuenta» y «Descartado» van en rojo; Cuenta, Resuelto, Vinculada y Revisado, en verde", () => {
    const tone = (outcome: string) => {
      const { unmount } = render(<InboxRowBadges label="Algo" kind="carga" decided={{ outcome }} />)
      const badge = screen.getByText(outcome)
      const danger = badge.className.includes("--color-danger-ink")
      const success = badge.className.includes("--color-success-ink")
      unmount()
      return danger ? "danger" : success ? "success" : "otro"
    }

    expect(["No cuenta", "Descartado"].map(tone)).toEqual(["danger", "danger"])
    expect(["Cuenta", "Resuelto", "Vinculada", "Revisado"].map(tone)).toEqual(["success", "success", "success", "success"])
  })

  it("con `fresh` aparece el punto «Nuevo» con nombre accesible; sin él, no", () => {
    const { unmount } = render(<InboxRowBadges label="Algo" kind="patente" fresh />)
    expect(screen.getByRole("img", { name: "Nuevo" })).toBeInTheDocument()
    unmount()

    render(<InboxRowBadges label="Algo" kind="patente" />)
    expect(screen.queryByRole("img", { name: "Nuevo" })).toBeNull()
  })

  it("el punto «Nuevo» va antes que la etiqueta, y la etiqueta antes que la gravedad", () => {
    render(<InboxRowBadges label="Sello repetido" kind="caso" severity="high" fresh />)

    const dot = screen.getByRole("img", { name: "Nuevo" })
    const label = screen.getByText("Sello repetido")
    const severity = screen.getByText("Alta")
    expect(dot.compareDocumentPosition(label) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(label.compareDocumentPosition(severity) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it("deja que quien lo usa ponga el margen", () => {
    const { container } = render(<InboxRowBadges className="mb-2" label="Algo" kind="pedido" />)

    expect(container.firstElementChild).toHaveClass("mb-2", "flex", "flex-wrap")
  })
})
