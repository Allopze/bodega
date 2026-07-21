// @vitest-environment jsdom

/**
 * H-20: `IndicatorDenominatorDialog` es el modal realmente montado desde
 * `CanonicalIndicatorsDashboard` (a diferencia de `IndicadoresEditModal`,
 * huérfano — ver `indicadores-edit-modal.test.tsx`). Cubre la navegación
 * mensual, la protección de cambios sin guardar y "Guardar y continuar".
 */

import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { denominatorDialogLabel, IndicatorDenominatorDialog } from "./indicator-denominator-dialog"
import { saveSafetyIndicatorDenominatorAction } from "./actions"

vi.mock("./actions", () => ({
  saveSafetyIndicatorDenominatorAction: vi.fn(async () => ({ ok: true })),
  approveSafetyIndicatorDenominatorAction: vi.fn(async () => ({ ok: true })),
}))
vi.mock("@/lib/toast", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}))

afterEach(cleanup)

const BASE_PROPS = {
  worksiteId: "ws-1",
  year: 2026,
  month: 6,
  denominator: null,
  canManage: true,
  canApprove: false,
  currentUserId: "user-1",
}

describe("denominatorDialogLabel", () => {
  it("propone Registrar sin registro, Gestionar con registro aprobado y Revisar en revisión", () => {
    expect(denominatorDialogLabel(null)).toBe("Registrar")
    expect(denominatorDialogLabel({ status: "approved" } as never)).toBe("Gestionar")
    expect(denominatorDialogLabel({ status: "pending_review" } as never)).toBe("Revisar")
  })
})

describe("IndicatorDenominatorDialog — navegación mensual", () => {
  it("no muestra controles de navegación cuando no se pasa onNavigate", () => {
    render(<IndicatorDenominatorDialog {...BASE_PROPS} onClose={vi.fn()} />)
    expect(screen.queryByRole("button", { name: "Mes anterior" })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Mes siguiente" })).not.toBeInTheDocument()
  })

  it("navega de inmediato sin cambios pendientes", () => {
    const onNavigate = vi.fn()
    render(<IndicatorDenominatorDialog {...BASE_PROPS} onClose={vi.fn()} onNavigate={onNavigate} />)

    fireEvent.click(screen.getByRole("button", { name: "Mes siguiente" }))
    expect(onNavigate).toHaveBeenLastCalledWith(7)

    fireEvent.click(screen.getByRole("button", { name: "Mes anterior" }))
    expect(onNavigate).toHaveBeenLastCalledWith(5)
  })

  it("deshabilita 'Mes anterior' en enero", () => {
    render(<IndicatorDenominatorDialog {...BASE_PROPS} month={1} onClose={vi.fn()} onNavigate={vi.fn()} />)
    expect(screen.getByRole("button", { name: "Mes anterior" })).toBeDisabled()
  })

  it("deshabilita 'Mes siguiente' en diciembre", () => {
    render(<IndicatorDenominatorDialog {...BASE_PROPS} month={12} onClose={vi.fn()} onNavigate={vi.fn()} />)
    expect(screen.getByRole("button", { name: "Mes siguiente" })).toBeDisabled()
  })

  it("con cambios sin guardar, pide confirmación en vez de navegar de inmediato", () => {
    const onNavigate = vi.fn()
    render(<IndicatorDenominatorDialog {...BASE_PROPS} onClose={vi.fn()} onNavigate={onNavigate} />)

    fireEvent.change(screen.getByLabelText("Dotación del mes"), { target: { value: "42" } })
    fireEvent.click(screen.getByRole("button", { name: "Mes siguiente" }))

    expect(onNavigate).not.toHaveBeenCalled()
    expect(screen.getByText(/Hay cambios sin guardar/)).toBeInTheDocument()
  })

  it("'Descartar' navega sin guardar", () => {
    const onNavigate = vi.fn()
    render(<IndicatorDenominatorDialog {...BASE_PROPS} onClose={vi.fn()} onNavigate={onNavigate} />)

    fireEvent.change(screen.getByLabelText("Dotación del mes"), { target: { value: "42" } })
    fireEvent.click(screen.getByRole("button", { name: "Mes siguiente" }))
    fireEvent.click(screen.getByRole("button", { name: "Descartar" }))

    expect(onNavigate).toHaveBeenCalledWith(7)
    expect(saveSafetyIndicatorDenominatorAction).not.toHaveBeenCalled()
  })

  it("'Guardar y continuar' guarda primero y luego navega", async () => {
    const onNavigate = vi.fn()
    render(<IndicatorDenominatorDialog {...BASE_PROPS} onClose={vi.fn()} onNavigate={onNavigate} />)

    fireEvent.change(screen.getByLabelText("Dotación del mes"), { target: { value: "42" } })
    fireEvent.click(screen.getByRole("button", { name: "Mes siguiente" }))
    fireEvent.click(screen.getByRole("button", { name: "Guardar y continuar" }))

    await vi.waitFor(() => expect(onNavigate).toHaveBeenCalledWith(7))
    expect(saveSafetyIndicatorDenominatorAction).toHaveBeenCalledTimes(1)
  })

  it("'Seguir editando' cierra la confirmación sin navegar", () => {
    const onNavigate = vi.fn()
    render(<IndicatorDenominatorDialog {...BASE_PROPS} onClose={vi.fn()} onNavigate={onNavigate} />)

    fireEvent.change(screen.getByLabelText("Dotación del mes"), { target: { value: "42" } })
    fireEvent.click(screen.getByRole("button", { name: "Mes siguiente" }))
    fireEvent.click(screen.getByRole("button", { name: "Seguir editando" }))

    expect(screen.queryByText(/Hay cambios sin guardar/)).not.toBeInTheDocument()
    expect(onNavigate).not.toHaveBeenCalled()
  })
})
