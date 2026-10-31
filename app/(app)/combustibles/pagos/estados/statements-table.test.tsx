// @vitest-environment jsdom
/**
 * UX-003 (auditoría 2026-09-14): la lista de estados de cuenta de combustible era
 * una de las dos únicas tablas de la plataforma sin `renderMobileCard`. Como se
 * consulta en terreno, en pantalla angosta quedaba tras un desplazamiento
 * horizontal y perdía la acción principal fuera de pantalla.
 *
 * Antes de la corrección `DataTable` renderizaba sólo la tabla (sin el bloque
 * `md:hidden`), así que esta prueba no encontraba ninguna tarjeta.
 *
 * Rediseño de Combustible (2026-10-31): la lista vive en `/combustibles/pagos/estados`,
 * habla de «estados de cuenta» (no «cartola») y suma las filas de los meses que
 * todavía no tienen uno, con su botón «Crear».
 */
import { render, screen, within } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

// La DataTable se conecta al buscador del TopBar vía router, igual que en
// `epp-family-list.test.tsx`.
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
}))
// El diálogo trae las acciones de servidor (y con ellas la base de datos): aquí sólo importa que la fila lo ofrezca.
vi.mock("./new-statement-dialog", () => ({
  NewStatementDialog: ({ defaultMonth, defaultSupplierId }: { defaultMonth?: string; defaultSupplierId?: string }) => (
    <button type="button">Crear {defaultSupplierId} {defaultMonth}</button>
  ),
}))

import { StatementsTable } from "./statements-table"

const statement = {
  id: "st-1",
  month: "2026-08",
  totalLiters: 1250,
  totalAmount: 1_500_000,
  paidAmount: 500_000,
  status: "open",
  dueDate: "2026-09-10",
  supplier: { name: "Copec Faena Norte" },
  payments: [{ amount: 500_000 }],
}

const missing = { supplierId: "sup-9", supplierName: "Aramco", month: "2026-10", loads: 38, totalAmount: 58_400_000, monthClosed: false }

/** El bloque de tarjetas es el `md:hidden` que `DataTable` monta junto a la tabla. */
function mobileCards(container: HTMLElement) {
  return container.querySelector<HTMLElement>("div.md\\:hidden")
}

describe("estados de cuenta de combustible — vista móvil (UX-003)", () => {
  it("monta una tarjeta móvil por estado de cuenta en vez de dejar sólo la tabla desplazable", () => {
    const { container } = render(<StatementsTable statements={[statement]} today="2026-09-01" />)

    const cards = mobileCards(container)
    expect(cards).not.toBeNull()
    expect(within(cards!).getByText("Agosto 2026")).toBeInTheDocument()
    expect(within(cards!).getByText("Copec Faena Norte")).toBeInTheDocument()
  })

  it("conserva en la tarjeta lo que falta por pagar y la acción de abrir el estado de cuenta", () => {
    const { container } = render(<StatementsTable statements={[statement]} today="2026-09-01" />)
    const cards = mobileCards(container)!

    // Lo que falta por pagar es el dato que se va a consultar en terreno: 1.500.000 − 500.000.
    expect(within(cards).getByText("Por pagar")).toBeInTheDocument()
    expect(within(cards).getByText(/1\.000\.000/)).toBeInTheDocument()

    const link = within(cards).getByRole("link", { name: /ver estado de cuenta/i })
    expect(link).toHaveAttribute("href", "/combustibles/pagos/estados/st-1")
  })

  it("deriva «Vencido» también en la tarjeta, no sólo en la fila", () => {
    const { container } = render(
      <StatementsTable statements={[{ ...statement, dueDate: "2026-08-01" }]} today="2026-09-01" />,
    )
    const cards = mobileCards(container)!
    expect(within(cards).getByText(/vencid/i)).toBeInTheDocument()
    // Y la tabla sigue existiendo: la vista móvil no reemplaza al escritorio.
    expect(screen.getByRole("table")).toBeInTheDocument()
  })
})

describe("meses sin estado de cuenta", () => {
  it("los lista arriba, con su estado y un botón para crearlos, sólo a quien puede gestionarlos", () => {
    const { container, rerender } = render(
      <StatementsTable statements={[statement]} missing={[missing]} suppliers={[{ id: "sup-9", name: "Aramco" }]} canManage today="2026-09-01" />,
    )
    const cards = mobileCards(container)!

    expect(within(cards).getByText("Octubre 2026")).toBeInTheDocument()
    expect(within(cards).getByText("Sin estado de cuenta")).toBeInTheDocument()
    expect(within(cards).getByRole("button", { name: /crear sup-9 2026-10/i })).toBeInTheDocument()

    rerender(<StatementsTable statements={[statement]} missing={[missing]} suppliers={[{ id: "sup-9", name: "Aramco" }]} today="2026-09-01" />)
    expect(within(mobileCards(container)!).queryByRole("button", { name: /crear/i })).toBeNull()
    // Sin permiso se sigue viendo qué falta, sólo que sin botón.
    expect(within(mobileCards(container)!).getByText("Sin estado de cuenta")).toBeInTheDocument()
  })

  it("no confunde el total estimado de un mes sin estado de cuenta con lo que se debe", () => {
    const { container } = render(<StatementsTable statements={[]} missing={[missing]} today="2026-09-01" />)
    const card = mobileCards(container)!

    expect(within(card).queryByText("Por pagar")).toBeNull()
    expect(within(card).getByText(/38 cargas facturadas/)).toBeInTheDocument()
  })
})
