// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import type { pdtpActivities } from "@/db/schema"
import { WorksiteScopePanel } from "./builder-tabs"

const { mockSetWorksites, mockExclude, mockRefresh } = vi.hoisted(() => ({
  mockSetWorksites: vi.fn(),
  mockExclude: vi.fn(),
  mockRefresh: vi.fn(),
}))

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mockRefresh, push: vi.fn() }) }))
vi.mock("../../actions/worksites-actions", () => ({
  setPdtpProgramWorksitesAction: mockSetWorksites,
  excludeActivityForWorksiteAction: mockExclude,
  includeActivityForWorksiteAction: vi.fn(),
}))

const ACTIVITIES = [
  { id: "act-1", n: 1, activity: "Inspección de EPP" },
] as unknown as Array<typeof pdtpActivities.$inferSelect>

const WORKSITES = [
  { id: "ws-1", name: "Faena Uno", code: "F1" },
  { id: "ws-2", name: "Faena Dos", code: "F2" },
]

beforeEach(() => {
  mockSetWorksites.mockResolvedValue({ ok: true })
  mockExclude.mockResolvedValue({ ok: true })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe("WorksiteScopePanel", () => {
  it("saves the toggled worksite selection as the new program membership", async () => {
    render(<WorksiteScopePanel programId="program-1" activities={ACTIVITIES} visibleWorksites={WORKSITES} memberWorksiteIds={[]} exclusions={[]} />)

    expect(screen.getByText("Aplica a todas las faenas autorizadas")).toBeDefined()
    fireEvent.click(screen.getByRole("checkbox", { name: /Faena Uno/ }))
    fireEvent.click(screen.getByRole("button", { name: "Guardar faenas" }))

    await vi.waitFor(() => expect(mockSetWorksites).toHaveBeenCalledWith({ programId: "program-1", worksiteIds: ["ws-1"] }))
    await vi.waitFor(() => expect(mockRefresh).toHaveBeenCalled())
  })

  it("requires a reason of at least 10 characters before enabling the exclude button", () => {
    render(<WorksiteScopePanel programId="program-1" activities={ACTIVITIES} visibleWorksites={WORKSITES} memberWorksiteIds={[]} exclusions={[]} />)

    const excludeButton = screen.getByRole("button", { name: "Excluir" })
    expect(excludeButton).toBeDisabled()
    fireEvent.click(screen.getByLabelText("Faena a excluir"))
    fireEvent.click(screen.getByRole("option", { name: "Faena Uno" }))
    expect(excludeButton).toBeDisabled()
    fireEvent.change(screen.getByPlaceholderText("Motivo (mín. 10 caracteres)"), { target: { value: "Motivo suficientemente largo" } })
    expect(excludeButton).not.toBeDisabled()
  })

  it("excludes an activity for a faena with the given reason", async () => {
    render(<WorksiteScopePanel programId="program-1" activities={ACTIVITIES} visibleWorksites={WORKSITES} memberWorksiteIds={[]} exclusions={[]} />)

    fireEvent.click(screen.getByLabelText("Faena a excluir"))
    fireEvent.click(screen.getByRole("option", { name: "Faena Uno" }))
    fireEvent.change(screen.getByPlaceholderText("Motivo (mín. 10 caracteres)"), { target: { value: "Motivo suficientemente largo" } })
    fireEvent.click(screen.getByRole("button", { name: "Excluir" }))

    await vi.waitFor(() => expect(mockExclude).toHaveBeenCalledWith({
      programId: "program-1", activityId: "act-1", worksiteId: "ws-1", reason: "Motivo suficientemente largo",
    }))
  })
})
