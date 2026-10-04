// @vitest-environment jsdom
import { fireEvent, render, screen, within } from "@testing-library/react"
import { ShellHeaderProvider } from "@/components/layout/header-context"
import { afterEach, describe, expect, it, vi } from "vitest"

const actions = vi.hoisted(() => ({ saveRiskFactorAction: vi.fn(), setRiskFactorActiveAction: vi.fn() }))
vi.mock("../actions", () => actions)
vi.mock("next/navigation", () => ({ usePathname: () => "/prevencion/miper/factores", useSearchParams: () => new URLSearchParams(), useRouter: () => ({ refresh: vi.fn(), prefetch: vi.fn(), replace: vi.fn(), push: vi.fn() }) }))
vi.mock("@/lib/toast", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() } }))
import { RiskFactorsAdmin } from "./risk-factors-admin"

afterEach(() => vi.clearAllMocks())

describe("Factores de riesgo", () => {
  it("expone el efecto de desactivar un factor usado y lo asocia a la acción por teclado", () => {
    render(<ShellHeaderProvider><RiskFactorsAdmin factors={[{ id: "f1", code: "mecanico", name: "Mecánico", sortOrder: 1, isActive: true, usageCount: 12 }]} /></ShellHeaderProvider>)
    const row = screen.getByRole("row", { name: /Mecánico/ })
    const deactivate = within(row).getByRole("button", { name: "Desactivar" })
    expect(deactivate).toHaveAttribute("aria-describedby", "factor-use-f1")
    expect(document.getElementById("factor-use-f1")).toHaveTextContent("En uso en 12 riesgos")
    expect(document.getElementById("factor-use-f1")).toHaveTextContent("los existentes se conservan")
    expect(deactivate).not.toHaveAttribute("title")
  })

  it("mantiene la operación de reactivación del catálogo", () => {
    actions.setRiskFactorActiveAction.mockResolvedValue({ ok: true })
    render(<ShellHeaderProvider><RiskFactorsAdmin factors={[{ id: "f1", code: "mecanico", name: "Mecánico", sortOrder: 1, isActive: false, usageCount: 12 }]} /></ShellHeaderProvider>)
    fireEvent.click(screen.getByRole("button", { name: "Reactivar" }))
    expect(actions.setRiskFactorActiveAction).toHaveBeenCalledWith({ id: "f1", isActive: true })
  })
})
