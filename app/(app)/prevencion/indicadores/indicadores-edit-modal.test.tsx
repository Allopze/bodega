// @vitest-environment jsdom

/**
 * Fase 0 (baseline): fija el comportamiento ACTUAL de la navegación
 * anterior/siguiente de `IndicadoresEditModal`, antes de que Fase 5 (H-20)
 * agregue estado de cambios sin guardar, foco u otras mejoras de UX.
 *
 * Nota de contexto (ver reporte de Fase 0): a la fecha de este test,
 * `IndicadoresEditModal` sólo se monta con `onNavigate` desde
 * `CanonicalIndicatorsDashboard` (`canonical-indicators-dashboard.tsx`), y ese componente no
 * está importado por ninguna ruta de la app — es código huérfano. El
 * dashboard realmente montado (`app/(app)/prevencion/indicadores/page.tsx`
 * → `CanonicalIndicatorsDashboard`) no usa este modal en absoluto. Este test
 * caracteriza el componente tal como existe hoy, independientemente de que
 * esté o no alcanzable desde la UI en producción.
 */

import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { IndicadoresEditModal } from "./indicadores-edit-modal"
import { saveSafetyIndicatorMonthAction } from "./actions"
import type { IndicatorCounters } from "@/lib/prevention/safety-indicators-calc"

vi.mock("./actions", () => ({
  saveSafetyIndicatorMonthAction: vi.fn(async () => ({ ok: true })),
}))
vi.mock("@/lib/toast", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}))

afterEach(cleanup)

const ZERO_COUNTERS: IndicatorCounters = {
  trabajadores: 0,
  horasHombre: 0,
  accConTiempoPerdido: 0,
  accSinTiempoPerdido: 0,
  diasPerdidos: 0,
  incidentes: 0,
  danoMaterial: 0,
  danoAmbiental: 0,
}

describe("IndicadoresEditModal — navegación anterior/siguiente (estado actual)", () => {
  it("no muestra controles de navegación cuando no se pasa onNavigate", () => {
    render(
      <IndicadoresEditModal worksiteId="ws-1" year={2026} month={6} initial={ZERO_COUNTERS} onClose={vi.fn()} />,
    )

    expect(screen.queryByRole("button", { name: "Mes anterior" })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Mes siguiente" })).not.toBeInTheDocument()
  })

  it("llama a onNavigate con month - 1 / month + 1 al hacer click, sin pedir confirmación", () => {
    const onNavigate = vi.fn()
    render(
      <IndicadoresEditModal worksiteId="ws-1" year={2026} month={6} initial={ZERO_COUNTERS} onClose={vi.fn()} onNavigate={onNavigate} />,
    )

    fireEvent.click(screen.getByRole("button", { name: "Mes siguiente" }))
    expect(onNavigate).toHaveBeenLastCalledWith(7)

    fireEvent.click(screen.getByRole("button", { name: "Mes anterior" }))
    expect(onNavigate).toHaveBeenLastCalledWith(5)

    expect(onNavigate).toHaveBeenCalledTimes(2)
  })

  it("navega de inmediato aunque haya cambios sin guardar en el formulario (no hay dirty-state hoy)", () => {
    const onNavigate = vi.fn()
    render(
      <IndicadoresEditModal worksiteId="ws-1" year={2026} month={6} initial={ZERO_COUNTERS} onClose={vi.fn()} onNavigate={onNavigate} />,
    )

    fireEvent.change(screen.getByLabelText("Cant. Trabajadores"), { target: { value: "42" } })
    fireEvent.click(screen.getByRole("button", { name: "Mes siguiente" }))

    expect(onNavigate).toHaveBeenCalledWith(7)
    expect(saveSafetyIndicatorMonthAction).not.toHaveBeenCalled()
  })

  it("deshabilita 'Mes anterior' en enero", () => {
    render(
      <IndicadoresEditModal worksiteId="ws-1" year={2026} month={1} initial={ZERO_COUNTERS} onClose={vi.fn()} onNavigate={vi.fn()} />,
    )
    expect(screen.getByRole("button", { name: "Mes anterior" })).toBeDisabled()
    expect(screen.getByRole("button", { name: "Mes siguiente" })).not.toBeDisabled()
  })

  it("deshabilita 'Mes siguiente' en diciembre", () => {
    render(
      <IndicadoresEditModal worksiteId="ws-1" year={2026} month={12} initial={ZERO_COUNTERS} onClose={vi.fn()} onNavigate={vi.fn()} />,
    )
    expect(screen.getByRole("button", { name: "Mes siguiente" })).toBeDisabled()
    expect(screen.getByRole("button", { name: "Mes anterior" })).not.toBeDisabled()
  })
})
