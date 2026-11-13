// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { ScheduleListRow } from "@/lib/services/mantencion/schedules"
import { SchedulesTable } from "./schedules-table"

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/mantencion/pautas",
  useSearchParams: () => new URLSearchParams(),
}))

afterEach(cleanup)

function row(overrides: Partial<ScheduleListRow> = {}): ScheduleListRow {
  return { id: "s1", name: "Camiones y tractos", unit: "km", intervals: [10_000, 20_000], itemCount: 12, equipmentCount: 5, hasBrandRules: false, dirty: false, ...overrides } as ScheduleListRow
}

describe("lista de pautas", () => {
  it("«Reglas por marca» es texto: «Con reglas» o un guion, nunca una insignia «No» por fila", () => {
    render(<SchedulesTable rows={[row(), row({ id: "s2", name: "Excavadoras", hasBrandRules: true })]} />)
    const table = screen.getByRole("table")
    const plain = within(within(table).getByRole("row", { name: /Camiones y tractos/ }))
    expect(plain.queryByText("No")).toBeNull()
    expect(plain.getByText("Sin reglas por marca")).toBeTruthy()
    expect(within(within(table).getByRole("row", { name: /Excavadoras/ })).getByText("Con reglas")).toBeTruthy()
  })

  it("una pauta sin actividades se marca como incompleta", () => {
    render(<SchedulesTable rows={[row({ itemCount: 0 }), row({ id: "s2", name: "Excavadoras" })]} />)
    const table = screen.getByRole("table")
    expect(within(within(table).getByRole("row", { name: /Camiones y tractos/ })).getByText("Sin actividades")).toBeTruthy()
    expect(within(within(table).getByRole("row", { name: /Excavadoras/ })).queryByText("Sin actividades")).toBeNull()
  })
})
