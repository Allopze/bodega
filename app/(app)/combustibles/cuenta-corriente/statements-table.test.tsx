// @vitest-environment jsdom
/**
 * UX-003 (auditoría 2026-09-14): la cartola de combustible era una de las dos
 * únicas tablas de la plataforma sin `renderMobileCard`. Como se consulta en
 * terreno, en pantalla angosta quedaba tras un desplazamiento horizontal y
 * perdía la acción principal fuera de pantalla.
 *
 * Antes de la corrección `DataTable` renderizaba sólo la tabla (sin el bloque
 * `md:hidden`), así que esta prueba no encontraba ninguna tarjeta.
 */
import { render, screen, within } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

// La DataTable se conecta al buscador del TopBar vía router, igual que en
// `epp-family-list.test.tsx`.
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
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

/** El bloque de tarjetas es el `md:hidden` que `DataTable` monta junto a la tabla. */
function mobileCards(container: HTMLElement) {
  return container.querySelector<HTMLElement>("div.md\\:hidden")
}

describe("cartola de combustible — vista móvil (UX-003)", () => {
  it("monta una tarjeta móvil por cartola en vez de dejar sólo la tabla desplazable", () => {
    const { container } = render(<StatementsTable statements={[statement]} today="2026-09-01" />)

    const cards = mobileCards(container)
    expect(cards).not.toBeNull()
    expect(within(cards!).getByText("2026-08")).toBeInTheDocument()
    expect(within(cards!).getByText("Copec Faena Norte")).toBeInTheDocument()
  })

  it("conserva en la tarjeta el saldo pendiente y la acción de abrir la cartola", () => {
    const { container } = render(<StatementsTable statements={[statement]} today="2026-09-01" />)
    const cards = mobileCards(container)!

    // El pendiente es el dato que se va a consultar en terreno: 1.500.000 − 500.000.
    expect(within(cards).getByText("Pendiente")).toBeInTheDocument()
    expect(within(cards).getByText(/1\.000\.000/)).toBeInTheDocument()

    const link = within(cards).getByRole("link", { name: /ver cartola/i })
    expect(link).toHaveAttribute("href", "/combustibles/cuenta-corriente/st-1")
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
