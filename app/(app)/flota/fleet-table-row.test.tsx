// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react"
import Link from "next/link"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { TableCell } from "@/components/ui/table"
import { FleetTableRow } from "./fleet-table-row"

const router = vi.hoisted(() => ({ push: vi.fn() }))
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: router.push }) }))

function renderRow() {
  render(
    <table>
      <tbody>
        <FleetTableRow href="/flota/v1">
          <TableCell>AA-0001</TableCell>
          <TableCell>
            <Link href="/combustibles/revisar?tipo=caso&item=caso%3Ac1">Revisar caso</Link>
            <button type="button">Otra acción</button>
          </TableCell>
        </FleetTableRow>
      </tbody>
    </table>,
  )
}

describe("FleetTableRow", () => {
  beforeEach(() => router.push.mockClear())

  it("la fila entera abre la ficha del equipo con clic y con Enter o Espacio", () => {
    renderRow()
    const row = screen.getByRole("link", { name: /AA-0001/ })

    fireEvent.click(screen.getByText("AA-0001"))
    fireEvent.keyDown(row, { key: "Enter" })
    fireEvent.keyDown(row, { key: " " })

    expect(router.push).toHaveBeenCalledTimes(3)
    expect(router.push).toHaveBeenCalledWith("/flota/v1")
  })

  it("un enlace dentro de la fila actúa por sí solo: ni el clic ni Enter abren la ficha", () => {
    renderRow()
    const inner = screen.getByRole("link", { name: "Revisar caso" })

    fireEvent.click(inner)
    // Si la fila cancelara el Enter (preventDefault), el navegador nunca activaría el enlace.
    const notCancelled = fireEvent.keyDown(inner, { key: "Enter" })

    expect(router.push).not.toHaveBeenCalled()
    expect(notCancelled).toBe(true)
  })

  it("lo mismo vale para un botón dentro de la fila", () => {
    renderRow()
    const button = screen.getByRole("button", { name: "Otra acción" })

    fireEvent.click(button)
    expect(fireEvent.keyDown(button, { key: " " })).toBe(true)

    expect(router.push).not.toHaveBeenCalled()
  })
})
