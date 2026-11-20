// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { EquipmentGridView } from "./equipment-grid-view"
import { OperatorRankingView } from "./operator-ranking-view"
import { ShiftDayView } from "./shift-day-view"
import { ShiftViewsTabs } from "./shift-views-tabs"

vi.mock("./actions", () => ({
  setIdleTargetAction: vi.fn(), createShiftAction: vi.fn(), updateShiftAction: vi.fn(),
  voidShiftAction: vi.fn(), setDayMarkAction: vi.fn(), clearDayMarkAction: vi.fn(),
}))
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  usePathname: () => "/flota/turnos",
  useSearchParams: () => new URLSearchParams(),
}))

afterEach(() => { cleanup() })

const TOTAL = { shifts: 3, engineHours: 20, workingHours: 12, idleHours: 8, idlePct: 0.4, overTarget: 1, pending: 1 }
const RANKING = {
  rows: [
    { rank: 1, operatorWorkerId: "w1", operatorName: "Ana Pérez", shifts: 2, engineHours: 14, workingHours: 9, idleHours: 3, idlePct: 0.25, overTarget: 0, pending: 0 },
    { rank: null, operatorWorkerId: "w2", operatorName: "Luis Soto", shifts: 1, engineHours: 0, workingHours: 0, idleHours: 0, idlePct: null, overTarget: 0, pending: 1 },
  ],
  total: TOTAL,
}

describe("vista Operadores", () => {
  it("muestra el ranking, la fila de total y la nota de cómo se calcula", () => {
    render(<OperatorRankingView ranking={RANKING} target={0.3} vehicleId="" vehicles={[]} dayHref="/flota/turnos" />)
    const table = screen.getAllByRole("table")[0]!
    expect(within(table).getByText("Ana Pérez")).toBeTruthy()
    expect(within(table).getByText("Total")).toBeTruthy()
    expect(screen.getByText(/Ranking: 1 = menor % de ralentí/)).toBeTruthy()
    // La tira de resumen trae las cuatro cifras, con la coma decimal de es-CL.
    expect(screen.getByText("% ralentí general")).toBeTruthy()
    expect(screen.getByText("Turnos sobre meta")).toBeTruthy()
    expect(screen.getByText("40")).toBeTruthy()
  })

  it("sin turnos ofrece ir a los turnos del día", () => {
    render(<OperatorRankingView ranking={{ rows: [], total: { ...TOTAL, shifts: 0, overTarget: 0, pending: 0, idlePct: null } }} target={0.3} vehicleId="" vehicles={[]} dayHref="/flota/turnos" />)
    expect(screen.getAllByText("No hay turnos en este período").length).toBeGreaterThan(0)
    expect(screen.getAllByRole("link", { name: "Ir a los turnos del día" })[0]!.getAttribute("href")).toBe("/flota/turnos")
  })
})

describe("vista Equipos", () => {
  const grid = {
    target: 0.3,
    days: ["2026-11-18", "2026-11-19"],
    rows: [{
      vehicleId: "veh-1", vehicleCode: "GR-11", engineHours: 9.5, idlePct: 0.2,
      cells: [
        { day: "2026-11-18", kind: "pct" as const, pct: 0.2, engineHours: 5 },
        { day: "2026-11-19", kind: "ss" as const, pct: null, engineHours: 0 },
      ],
    }],
    stoppedDays: [],
    idleLiters: [],
  }

  it("pinta la celda con su % y la sigla, explica las convenciones y dice la fuente", () => {
    render(<EquipmentGridView grid={grid} canManage={false} dayHref="/flota/turnos" />)
    expect(screen.getByText("20")).toBeTruthy()
    expect(screen.getAllByText("SS").length).toBeGreaterThan(0)
    const legend = screen.getByRole("list", { name: "Leyenda de la grilla" })
    expect(within(legend).getByText("sin operación programada")).toBeTruthy()
    expect(screen.getByText("% y horas: tramos de VisionLink. Litros: resumen diario de VisionLink.")).toBeTruthy()
  })

  it("los ajustes de la meta sólo aparecen con permiso de gestión", () => {
    const { rerender } = render(<EquipmentGridView grid={grid} canManage={false} dayHref="/flota/turnos" />)
    expect(screen.queryByLabelText("Meta % ralentí")).toBeNull()
    rerender(<EquipmentGridView grid={grid} canManage dayHref="/flota/turnos" />)
    expect((screen.getByLabelText("Meta % ralentí") as HTMLInputElement).value).toBe("30")
  })
})

describe("selector de vista", () => {
  it("«Día» no viaja en la URL y el resto conserva lo ya elegido", () => {
    render(<ShiftViewsTabs current="operadores" params={{ desde: "2026-11-01", hasta: "2026-11-19" }} />)
    expect(screen.getByRole("link", { name: "Día" }).getAttribute("href")).toBe("/flota/turnos?desde=2026-11-01&hasta=2026-11-19")
    expect(screen.getByRole("link", { name: "Equipos" }).getAttribute("href")).toBe("/flota/turnos?desde=2026-11-01&hasta=2026-11-19&vista=equipos")
    expect(screen.getByRole("link", { name: "Operadores" }).getAttribute("aria-current")).toBe("page")
  })
})

describe("vista Día", () => {
  const summary = { idleHours: 2, workingHours: 6, runningHours: 0, engineHours: 8, idlePct: 0.25, status: "en_meta" as const }
  const shift = {
    id: "s-1", vehicleId: "veh-1", vehicleCode: "GR-11", shiftDate: "2026-11-19", startHour: 6, endHour: 14,
    presetLabel: "Mañana 06–14", operatorWorkerId: "w1", operatorName: "Ana Pérez", notes: "", summary,
  }
  const vehicle = {
    vehicleId: "veh-1", vehicleCode: "GR-11", hasVisionLink: true, operationalStatus: "operativo" as const,
    dayMark: null, shiftsCount: 1,
    summary: { ...summary, assignedEngineHours: 6, unassignedEngineHours: 2.5, warnUnassigned: true, signal: "ok" as const },
  }
  const base = { day: "2026-11-19", target: 0.3, vehicles: [vehicle], formVehicles: [], formOperators: [] }

  it("quien sólo ve no tiene formulario ni acciones, pero ve el aviso de horas sin turno", () => {
    render(<ShiftDayView {...base} shifts={[shift]} canManage={false} />)
    expect(screen.queryByRole("button", { name: /Editar turno/ })).toBeNull()
    expect(screen.queryByRole("button", { name: "Guardar turno" })).toBeNull()
    expect(screen.getByText("2,5 h de motor sin turno")).toBeTruthy()
    expect(screen.getAllByText("En meta").length).toBeGreaterThan(0)
  })

  it("quien gestiona ve el formulario, editar, anular y la marca del día", () => {
    render(<ShiftDayView {...base} shifts={[shift]} canManage />)
    expect(screen.getByRole("button", { name: "Guardar turno" })).toBeTruthy()
    expect(screen.getAllByRole("button", { name: "Editar turno de GR-11, Ana Pérez" }).length).toBeGreaterThan(0)
    expect(screen.getAllByRole("button", { name: "Anular turno de GR-11, Ana Pérez" }).length).toBeGreaterThan(0)
    expect(screen.getByRole("button", { name: "Marcar el día de GR-11" })).toBeTruthy()
  })

  it("sin turnos dice que no hay y ofrece registrar uno sólo a quien puede", () => {
    const { rerender } = render(<ShiftDayView {...base} shifts={[]} canManage={false} />)
    expect(screen.getAllByText("No hay turnos registrados para este día.").length).toBeGreaterThan(0)
    expect(screen.queryByRole("button", { name: "Registrar turno" })).toBeNull()
    rerender(<ShiftDayView {...base} shifts={[]} canManage />)
    expect(screen.getAllByRole("button", { name: "Registrar turno" }).length).toBeGreaterThan(0)
  })
})
