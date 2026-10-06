// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

vi.mock("./actions", () => ({
  bulkApproveRequestAction: vi.fn(),
  updateDeliveryModeAction: vi.fn(),
  approveItemAction: vi.fn(),
  rejectItemAction: vi.fn(),
}))
vi.mock("next/navigation", () => ({
  usePathname: () => "/aprobaciones",
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}))
vi.mock("@/components/ui/server-list-filters", () => ({
  ServerListFilters: () => null,
  hasServerListFilters: () => false,
}))
vi.mock("@/components/ui/onboarding-hint", () => ({ OnboardingHint: () => null }))
vi.mock("./item-row", () => ({ ItemRow: () => <li>item</li> }))

import { ApprovalPanel } from "./approval-panel"
import type { ApprovalRequest, QuotationPendingRequest } from "./types"

afterEach(() => cleanup())

const request: ApprovalRequest = {
  id: "req-1",
  code: "SOL-0001",
  requestType: "epp",
  worksiteId: "w1",
  worksiteName: "Faena Norte",
  requesterName: "Ana",
  requestUrgency: "normal",
  submittedAt: "2026-10-01T10:00:00.000Z",
  deliveryMode: "via_oficina",
  pendingItems: [],
  pendingCount: 0,
}

const quotation: QuotationPendingRequest = {
  id: "req-2", code: "SOL-0002", requestType: "repuestos", worksiteName: "Faena Sur", itemCount: 2, ageDays: 3,
}

describe("ApprovalPanel", () => {
  it("el código de la solicitud es un enlace real al detalle", () => {
    render(<ApprovalPanel requests={[request]} canApproveEpp canSetDispatch={false} />)
    const link = screen.getByRole("link", { name: "Ver solicitud SOL-0001" })
    expect(link.getAttribute("href")).toBe("/solicitudes/req-1")
    // plegar es otro control
    expect(screen.getByRole("button", { name: /Contraer ítems de SOL-0001/ })).toBeTruthy()
  })

  it("el modo de despacho no ofrece Guardar mientras no cambie", () => {
    render(<ApprovalPanel requests={[request]} canApproveEpp canSetDispatch />)
    expect(screen.queryByRole("button", { name: "Guardar" })).toBeNull()
  })

  it("el estado vacío sólo se afirma cuando tampoco hay cotizaciones por elegir", () => {
    const { unmount } = render(<ApprovalPanel requests={[]} canApproveEpp canSetDispatch={false} />)
    expect(screen.getByText("Sin ítems pendientes")).toBeTruthy()
    unmount()

    render(<ApprovalPanel requests={[]} canApproveEpp canSetDispatch={false} quotationRequests={[quotation]} quotationTotal={1} />)
    expect(screen.queryByText("Sin ítems pendientes")).toBeNull()
    expect(screen.getByRole("heading", { name: /Por elegir cotización/ })).toBeTruthy()
    expect(screen.getByRole("link", { name: "Elegir cotización de SOL-0002" }).getAttribute("href")).toBe("/solicitudes/req-2")
  })
})
