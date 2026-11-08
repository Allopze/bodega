// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const nav = vi.hoisted(() => ({ replace: vi.fn() }))

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: nav.replace, push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/facturacion",
  useSearchParams: () => new URLSearchParams(""),
}))

import { PeriodPicker } from "./period-picker"

// Selector del mes de Facturación y Documentos DTE: el `<select>` al que reemplazó ofrecía
// 24 meses (el actual y 23 antes). Con «hoy» = 6 de noviembre de 2026 el primero es 2024-12.
beforeEach(() => {
  nav.replace.mockClear()
  vi.useFakeTimers({ toFake: ["Date"] })
  vi.setSystemTime(new Date("2026-11-06T15:00:00Z"))
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe("PeriodPicker", () => {
  it("no retrocede más allá de los últimos 24 meses: ni con la flecha ni con la grilla", () => {
    render(<PeriodPicker period="2024-12" />)
    expect(screen.getByRole("button", { name: "Período anterior" })).toBeDisabled()

    fireEvent.click(screen.getByRole("button", { name: /Cambiar período/ }))
    expect(screen.getByRole("button", { name: "Año anterior" })).toBeDisabled()
    expect(screen.getByRole("button", { name: "Nov" })).toBeDisabled()
    expect(screen.getByRole("button", { name: "Dic" })).toBeEnabled()
  })

  it("dentro de la ventana la flecha sigue retrocediendo, hasta el primer mes", () => {
    render(<PeriodPicker period="2025-01" />)
    fireEvent.click(screen.getByRole("button", { name: "Período anterior" }))
    expect(nav.replace.mock.calls.at(-1)?.[0]).toBe("/facturacion?periodo=2024-12")
  })

  it("la ventana se mide con el mes de Chile: la noche del 31 de octubre en Chile ya es noviembre en UTC", () => {
    // 23:30 del 31 de octubre en Chile (UTC-3) = 02:30 del 1 de noviembre en UTC.
    vi.setSystemTime(new Date("2026-11-01T02:30:00Z"))
    render(<PeriodPicker period="2024-11" />)
    // Mes actual 2026-10 → primer mes 2024-11, no 2024-12 como diría el reloj UTC.
    expect(screen.getByRole("button", { name: "Período anterior" })).toBeDisabled()
    cleanup()
    render(<PeriodPicker period="2024-12" />)
    expect(screen.getByRole("button", { name: "Período anterior" })).toBeEnabled()
  })
})
