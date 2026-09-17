// @vitest-environment jsdom

/**
 * Fase 3 (desvíos por celda): el estado "no realizada" y su chip de filtro.
 *
 * Lo que se fija acá es el vocabulario visible, no el cálculo: que el estado
 * se lea "No realizada (con motivo)" —y no el enum `not_performed` ni un
 * "Atrasado" que borraría la diferencia entre deuda explicada y deuda muda—,
 * y que el chip de filtro cuente esas actividades como categoría propia y las
 * sume al total "Todas". Qué actividad cae en ese estado lo decide
 * `deriveActivityStatus` (`lib/__tests__/pdtp-period.test.ts`).
 */

import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, render, screen } from "@testing-library/react"
import { PdtpActivitySummary, PdtpStatusBadge, type PdtpStatusCounts } from "./pdtp-sheet-table-ui"

afterEach(cleanup)

const COUNTS: PdtpStatusCounts = {
  executed: 3,
  pending: 1,
  overdue: 1,
  not_scheduled: 4,
  not_performed: 2,
  zero: 2,
}

describe("PdtpStatusBadge", () => {
  it("muestra 'No realizada (con motivo)' para el estado not_performed", () => {
    render(<PdtpStatusBadge status="not_performed" />)
    expect(screen.getByText("No realizada (con motivo)")).toBeInTheDocument()
    expect(screen.queryByText("not_performed")).not.toBeInTheDocument()
  })

  it("no la presenta como atrasada: es una deuda declarada, no silenciosa", () => {
    render(<PdtpStatusBadge status="not_performed" overdueMonths={3} />)
    expect(screen.queryByText(/Atrasado/)).not.toBeInTheDocument()
    expect(screen.getByText("No realizada (con motivo)")).toBeInTheDocument()
  })

  it("con motivos declarados sigue mostrando la misma etiqueta (el detalle va al tooltip)", () => {
    render(
      <PdtpStatusBadge
        status="not_performed"
        notPerformedReasons={["Faena suspendida por alerta meteorológica."]}
      />,
    )
    expect(screen.getByText("No realizada (con motivo)")).toBeInTheDocument()
  })

  it("los estados previos no cambian", () => {
    const { unmount } = render(<PdtpStatusBadge status="overdue" overdueMonths={2} />)
    expect(screen.getByText("Atrasado · 2 meses")).toBeInTheDocument()
    unmount()
    render(<PdtpStatusBadge status="executed" />)
    expect(screen.getByText("Ejecutado")).toBeInTheDocument()
  })
})

describe("PdtpActivitySummary", () => {
  it("ofrece 'No realizadas' como filtro propio con su conteo", () => {
    render(<PdtpActivitySummary counts={COUNTS} activeFilter="all" onFilter={vi.fn()} />)
    expect(screen.getByRole("button", { name: /No realizadas 2/ })).toBeInTheDocument()
  })

  it("las suma en 'Todas': son actividades del período, no una categoría aparte del total", () => {
    render(<PdtpActivitySummary counts={COUNTS} activeFilter="all" onFilter={vi.fn()} />)
    // 3 ejecutadas + 1 pendiente + 1 atrasada + 4 sin programar + 2 no
    // realizadas = 11. "En cero" (2) no se suma: se superpone a
    // pendientes/atrasadas y contarlo duplicaría esas filas.
    expect(screen.getByRole("button", { name: /Todas 11/ })).toBeInTheDocument()
  })

  it("selecciona el filtro al hacer clic en el chip", () => {
    const onFilter = vi.fn()
    render(<PdtpActivitySummary counts={COUNTS} activeFilter="all" onFilter={onFilter} />)
    screen.getByRole("button", { name: /No realizadas 2/ }).click()
    expect(onFilter).toHaveBeenCalledWith("not_performed")
  })
})
