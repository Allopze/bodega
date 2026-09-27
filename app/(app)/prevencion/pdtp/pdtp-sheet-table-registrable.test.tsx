// @vitest-environment jsdom
/**
 * PREV-I03 (resto): la planilla sólo ofrece "Registrar" en las actividades que
 * el servidor aceptaría de esta persona. No es la frontera de autorización —esa
 * es `registration-authority.ts`—, pero un botón que siempre falla es peor que
 * no tenerlo.
 */
import { cleanup, render, screen, within } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { PdtpSheetTable } from "./pdtp-sheet-table"
import type { PdtpSheetView } from "@/lib/services/prevention-pdtp"
import type { PdtpPeriod } from "@/lib/services/pdtp/period"

vi.mock("./actions", () => ({
  markPdtpExecutionFormAction: vi.fn(),
  approvePdtpExecutionAction: vi.fn(),
}))

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn() }),
  usePathname: () => "/prevencion/pdtp/actividades",
  useSearchParams: () => new URLSearchParams(),
}))

afterEach(() => {
  cleanup()
  window.localStorage.clear()
})

const CURRENT_PERIOD: PdtpPeriod = { year: 2026, month: 7, week: 2 }
const ZERO12 = Array.from({ length: 12 }, () => 0)
const PLANNED_JULY = ZERO12.map((value, index) => (index === 6 ? 1 : value))

function activity(id: string, n: string, name: string): PdtpSheetView["activities"][number] {
  const schedule = [{ month: 7, week: 2, plannedQuantity: 1 }]
  return {
    id, n, activity: name, program: "Programa X", responsibleDisplay: "Responsable X",
    schedule, effectiveSchedule: schedule,
    monthlyPlanned: PLANNED_JULY, monthlyExecuted: ZERO12,
    effectiveMonthlyPlanned: PLANNED_JULY, effectiveMonthlyExecuted: ZERO12, approvedMonthlyExecuted: ZERO12,
    monthlyNotPerformed: ZERO12, deviations: [],
    totalPlanned: 1, totalExecuted: 0, effectiveTotalPlanned: 1, effectiveTotalExecuted: 0,
    countedTotalExecuted: 0, effectiveCountedTotalExecuted: 0, executions: [], notes: null,
  } as unknown as PdtpSheetView["activities"][number]
}

function view(): PdtpSheetView {
  return {
    program: {} as PdtpSheetView["program"],
    sheet: {} as PdtpSheetView["sheet"],
    activities: [activity("act-mia", "1", "Actividad de mi cargo"), activity("act-ajena", "2", "Actividad de otro cargo")],
    monthlyTotals: Array.from({ length: 12 }, (_, i) => ({ month: i + 1, planned: 0, executed: 0, percent: null })),
  }
}

describe("PdtpSheetTable — 'Registrar' sólo en lo que la persona puede registrar", () => {
  for (const viewMode of ["semana", "anual"] as const) {
    it(`vista ${viewMode}: esconde el botón en las actividades ajenas`, () => {
      render(<PdtpSheetTable view={view()} viewMode={viewMode} currentPeriod={CURRENT_PERIOD} sheetCode="pdtp_general" canExecute worksiteId="ws-1" registrableActivityIds={["act-mia"]} />)
      const own = screen.getByText("Actividad de mi cargo").closest("tr")!
      const foreign = screen.getByText("Actividad de otro cargo").closest("tr")!
      expect(within(own).queryByRole("button", { name: /^Registrar/ })).not.toBeNull()
      expect(within(foreign).queryByRole("button", { name: /^Registrar/ })).toBeNull()
    })
  }

  it("sin la lista (Prevención, o llamadas antiguas) ofrece registrar todo", () => {
    render(<PdtpSheetTable view={view()} viewMode="semana" currentPeriod={CURRENT_PERIOD} sheetCode="pdtp_general" canExecute worksiteId="ws-1" />)
    expect(screen.getAllByRole("button", { name: /^Registrar/ })).toHaveLength(2)
  })
})
