// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { WorksiteScopePanel } from "./builder-tabs"

const { mockSetWorksites, mockRefresh } = vi.hoisted(() => ({
  mockSetWorksites: vi.fn(),
  mockRefresh: vi.fn(),
}))

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mockRefresh, push: vi.fn() }) }))
vi.mock("../../actions/worksites-actions", () => ({
  setPdtpProgramWorksitesAction: mockSetWorksites,
}))

const WORKSITES = [
  { id: "ws-1", name: "Faena Uno", code: "F1" },
  { id: "ws-2", name: "Faena Dos", code: "F2" },
]

beforeEach(() => {
  mockSetWorksites.mockResolvedValue({ ok: true })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe("WorksiteScopePanel", () => {
  it("saves the toggled worksite selection as the new program membership", async () => {
    render(<WorksiteScopePanel programId="program-1" visibleWorksites={WORKSITES} memberWorksiteIds={[]} />)

    expect(screen.getByText("Aplica a todas las faenas autorizadas (2).")).toBeDefined()
    fireEvent.click(screen.getByRole("checkbox", { name: /Faena Uno/ }))
    fireEvent.click(screen.getByRole("button", { name: "Guardar faenas" }))

    await vi.waitFor(() => expect(mockSetWorksites).toHaveBeenCalledWith({ programId: "program-1", worksiteIds: ["ws-1"] }))
    await vi.waitFor(() => expect(mockRefresh).toHaveBeenCalled())
  })

  it("shows an action error without refreshing", async () => {
    mockSetWorksites.mockResolvedValueOnce({ ok: false, message: "Sin alcance global." })
    render(<WorksiteScopePanel programId="program-1" visibleWorksites={WORKSITES} memberWorksiteIds={[]} />)

    fireEvent.click(screen.getByRole("checkbox", { name: /Faena Uno/ }))
    fireEvent.click(screen.getByRole("button", { name: "Guardar faenas" }))

    expect(await screen.findByText("Sin alcance global.")).toBeDefined()
    expect(mockRefresh).not.toHaveBeenCalled()
  })
})
