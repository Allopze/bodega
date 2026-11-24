// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn() }),
  usePathname: () => "/mantencion/panel",
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock("@/components/charts/hours-records-combo-chart-lazy", () => ({ HoursRecordsComboChartLazy: () => null }))

import type { CorrectivePage, CorrectiveSummary } from "@/lib/services/mantencion/looker/types"
import { CorrectivePanel } from "./corrective-panel"

afterEach(cleanup)

const noDrivers: CorrectiveSummary = { drivers: [], series: [], selectedDriver: null }

function panel(page: Partial<CorrectivePage>) {
  return render(
    <CorrectivePanel
      page={{ rows: [], total: 0, page: 1, pageSize: 20, ...page }}
      drivers={noDrivers}
      chart={noDrivers}
      unit="km"
      hrefForPage={() => "/mantencion/panel"}
      selectedWorkId={null}
      selectedDriverKey={null}
      selectedEquipmentId={null}
    />,
  )
}

describe("CorrectivePanel · bloque de conductores vacío", () => {
  it("sin ningún trabajo en el período dice que no hay trabajos, no que no declaran conductores", () => {
    panel({ total: 0 })
    expect(screen.getByText("Sin conductores registrados")).toBeTruthy()
    expect(screen.getByText("No hay trabajos correctivos en el período, así que no hay conductores.")).toBeTruthy()
    expect(screen.queryByText(/no declaran conductores/)).toBeNull()
  })

  it("con trabajos que no traen conductor sí dice que no los declaran", () => {
    panel({ total: 3 })
    expect(screen.getByText("Los registros del período no declaran conductores.")).toBeTruthy()
    expect(screen.queryByText(/No hay trabajos correctivos en el período, así que/)).toBeNull()
  })
})
