// @vitest-environment jsdom
/**
 * La cabecera de la hoja de decisión de un caso: el estado del caso y el
 * desenlace de la decisión no se pintan los dos a la vez. Un caso descartado
 * decía «Descartado» dos veces (una insignia gris de estado y otra roja de
 * resultado).
 */
import { cleanup, render, screen, within } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { AnomalyCaseStatus } from "@/lib/combustibles/anomaly-labels"
import type { FuelInboxItem } from "@/lib/combustibles/inbox/detail-types"
import type { FuelInboxDecided, FuelInboxRow } from "@/lib/combustibles/inbox/types"

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams("tipo=caso&item=caso%3Ac-1"),
  usePathname: () => "/combustibles/revisar",
}))
vi.mock("@/app/(app)/combustibles/revisar/actions", () => ({
  takeAnomalyCaseAction: vi.fn(),
  decideFlaggedLoadsAction: vi.fn(),
  reopenFlaggedDecisionAction: vi.fn(),
  linkInboxPlateAction: vi.fn(),
  resolveReviewRequestAction: vi.fn(),
}))
vi.mock("@/app/(app)/combustibles/anomalias/actions", () => ({
  assignAnomalyAction: vi.fn(),
  commentAnomalyAction: vi.fn(),
  updateAnomalyStatusAction: vi.fn(),
}))
vi.mock("@/lib/toast", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }))

import { InboxDetailSheet } from "./inbox-detail-sheet"

afterEach(() => cleanup())

function caseItem(status: AnomalyCaseStatus, decided: FuelInboxDecided | null): FuelInboxItem {
  const row: FuelInboxRow = {
    key: "caso:c-1", kind: "caso", id: "c-1", worksiteId: "ws-1", worksiteName: "Faena Norte",
    equipmentLabel: "CA-14 · KPRT14", vehicleId: "veh-1", title: "Caso · Sello repetido", reasonCodes: ["sello_repetido"], reasonLabel: "Sello repetido",
    datum: "El sello 1234 aparece en dos cargas", dataMonth: "2026-10", dueDate: "2026-10-31", waitingSince: "2026-10-05T12:00:00.000Z",
    severity: "high", assignee: null, decided, href: "/combustibles/cargas/terreno/sub-1", canAct: true,
  }
  return {
    row,
    evidence: [],
    history: [],
    extras: { case: { id: "c-1", status, severity: "high", ruleCode: "sello_repetido", ruleName: "Sello repetido", resolutionKind: null, assigneeId: null } },
  }
}

const renderSheet = (item: FuelInboxItem) => render(<InboxDetailSheet item={item} canReviewCases canResolveCases />)

describe("cabecera de la hoja de un caso", () => {
  it("un caso descartado dice «Descartado» una sola vez", () => {
    renderSheet(caseItem("dismissed", { outcome: "Descartado", byName: "Jefa", at: "2026-10-20T15:00:00.000Z", note: "Es el mismo sello de la carga anterior" }))

    const dialog = screen.getByRole("dialog", { name: "CA-14 · KPRT14 · Faena Norte" })
    expect(within(dialog).getAllByText("Descartado")).toHaveLength(1)
    // El desenlace sigue contado debajo, con quién y cuándo.
    expect(within(dialog).getByText(/Descartado · Jefa/)).toBeInTheDocument()
    expect(within(dialog).getByText("Sello repetido")).toBeInTheDocument()
    expect(within(dialog).getByText("Alta")).toBeInTheDocument()
  })

  it("un caso resuelto dice «Resuelto» una sola vez", () => {
    renderSheet(caseItem("resolved", { outcome: "Resuelto", byName: "Jefa", at: "2026-10-20T15:00:00.000Z", note: null }))

    expect(within(screen.getByRole("dialog")).getAllByText("Resuelto")).toHaveLength(1)
  })

  it("un caso tomado muestra su estado, sin desenlace", () => {
    renderSheet(caseItem("in_review", null))

    const dialog = screen.getByRole("dialog")
    expect(within(dialog).getByText("Tomada")).toBeInTheDocument()
    expect(within(dialog).queryByText("Descartado")).toBeNull()
    expect(within(dialog).queryByText("Resuelto")).toBeNull()
  })
})
