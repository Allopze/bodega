// @vitest-environment jsdom

import { render, screen, within } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import type { OperationalIntegrityCaseDto } from "@/lib/services/operational-integrity"
import { OperationalIntegrityWorkbench } from "./operational-integrity-workbench"

vi.mock("../actions", () => ({
  scanOperationalIntegrityAction: vi.fn(),
  acknowledgeOperationalIntegrityCaseAction: vi.fn(),
  verifyOperationalIntegrityCaseAction: vi.fn(),
}))

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  usePathname: () => "/bodega/trazabilidad",
  useSearchParams: () => new URLSearchParams("tab=integridad&faena=ws-biodiversa"),
}))

const FILTERS = { faena: "ws-biodiversa", dominio: "", severidad: "", estado: "" }

function caseRow(overrides: Partial<OperationalIntegrityCaseDto> = {}): OperationalIntegrityCaseDto {
  return {
    id: "case-0001",
    domain: "stock",
    code: "STOCK_BALANCE_MISMATCH",
    severity: "critical",
    worksiteId: "ws-biodiversa",
    entityType: "stock_item",
    entityId: "prod-1",
    summary: "El saldo físico no coincide con el último movimiento.",
    href: "/bodega?vista=kardex&faena=ws-biodiversa&producto=prod-1",
    firstDetectedAt: "2026-09-08T12:00:00.000Z",
    observedAt: "2026-09-09T12:00:00.000Z",
    state: "open",
    productId: "prod-1",
    productName: "Casco de seguridad blanco",
    sku: "EPP-CAS-001",
    ...overrides,
  }
}

describe("OperationalIntegrityWorkbench", () => {
  it("lleva cada métrica a su subconjunto exacto conservando la faena", () => {
    render(
      <OperationalIntegrityWorkbench
        cases={[
          caseRow(),
          caseRow({ id: "case-0002", severity: "warning", state: "acknowledged" }),
          caseRow({ id: "case-0003", severity: "high", state: "verified_resolved" }),
        ]}
        canReconcile
        filters={FILTERS}
      />,
    )

    const pendientes = screen.getByRole("link", { name: /Pendientes/ })
    expect(pendientes).toHaveAttribute("href", expect.stringContaining("estado=open"))
    expect(pendientes).toHaveAttribute("href", expect.stringContaining("faena=ws-biodiversa"))
    expect(pendientes).toHaveAttribute("href", expect.stringContaining("tab=integridad"))

    expect(within(pendientes).getByText("1")).toBeInTheDocument()
    expect(within(screen.getByRole("link", { name: /Reconocidos/ })).getByText("1")).toBeInTheDocument()
    expect(within(screen.getByRole("link", { name: /Resueltos/ })).getByText("1")).toBeInTheDocument()
    // Críticos cuenta sólo lo que sigue activo: el resuelto no vuelve a alarmar.
    expect(within(screen.getByRole("link", { name: /Críticos/ })).getByText("1")).toBeInTheDocument()
  })

  it("ofrece exactamente cuatro filtros estructurados primarios", () => {
    render(<OperationalIntegrityWorkbench cases={[caseRow()]} canReconcile filters={FILTERS} />)

    const filters = screen.getByRole("group", { name: /Filtros de integridad/i })
    expect(within(filters).getAllByRole("combobox")).toHaveLength(4)
  })

  it("muestra la fila con su resumen, severidad, estado y enlace exacto", () => {
    render(<OperationalIntegrityWorkbench cases={[caseRow()]} canReconcile filters={FILTERS} />)

    expect(screen.getByText("El saldo físico no coincide con el último movimiento.")).toBeInTheDocument()
    expect(screen.getByText("Casco de seguridad blanco")).toBeInTheDocument()
    expect(screen.getByRole("link", { name: /Ver evidencia/i })).toHaveAttribute(
      "href",
      "/bodega?vista=kardex&faena=ws-biodiversa&producto=prod-1",
    )
  })

  it("oculta escaneo, acuse y verificación sin permiso de reconciliación", () => {
    render(<OperationalIntegrityWorkbench cases={[caseRow()]} canReconcile={false} filters={FILTERS} />)

    expect(screen.queryByRole("button", { name: /Revisar integridad/i })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /Reconocer/i })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /Verificar/i })).not.toBeInTheDocument()
    // La lectura se conserva: quien ve trazabilidad sigue viendo el caso.
    expect(screen.getByText("El saldo físico no coincide con el último movimiento.")).toBeInTheDocument()
  })

  it("nunca renderiza evidencia cruda del snapshot", () => {
    const { container } = render(
      <OperationalIntegrityWorkbench
        cases={[caseRow({ domain: "purchasing", code: "INVOICE_ALLOCATION_INVALID", entityId: "po-77" })]}
        canReconcile
        filters={FILTERS}
      />,
    )

    for (const key of ["fingerprint", "snapshot", "stockBefore", "stockAfter", "subtotal", "allocations"]) {
      expect(container.textContent).not.toContain(key)
    }
  })

  it("invita a escanear cuando no hay casos en el alcance", () => {
    render(<OperationalIntegrityWorkbench cases={[]} canReconcile filters={FILTERS} />)

    expect(screen.getByText(/sin casos de integridad/i)).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /Revisar integridad/i })).toBeInTheDocument()
  })

  it("no ofrece escanear en un alcance vacío sin permiso", () => {
    render(<OperationalIntegrityWorkbench cases={[]} canReconcile={false} filters={FILTERS} />)

    expect(screen.queryByRole("button", { name: /Revisar integridad/i })).not.toBeInTheDocument()
  })
})
