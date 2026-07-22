// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import type { pdtpPrograms } from "@/db/schema"
import { MetadataTab } from "./builder-tabs"

const { mockUpdate, mockDelete, mockRefresh } = vi.hoisted(() => ({
  mockUpdate: vi.fn(),
  mockDelete: vi.fn(),
  mockRefresh: vi.fn(),
}))

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mockRefresh, push: vi.fn() }) }))
vi.mock("../../actions", () => ({
  updatePdtpProgramAction: mockUpdate,
  deletePdtpProgramAction: mockDelete,
}))

const PROGRAM = {
  id: "program-1",
  year: 2027,
  title: "Programa de controles críticos",
  complianceTarget: 0.9,
} as unknown as typeof pdtpPrograms.$inferSelect

beforeEach(() => {
  vi.useFakeTimers()
  mockUpdate.mockResolvedValue({ ok: true })
  mockDelete.mockResolvedValue({ ok: true })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  vi.useRealTimers()
})

describe("MetadataTab autosave", () => {
  it("shows 'Guardado' until the user edits the title, then autosaves after a debounce pause", async () => {
    render(<MetadataTab program={PROGRAM} canDelete={false} />)

    expect(screen.getAllByText("Guardado").length).toBeGreaterThan(0)

    fireEvent.change(screen.getByLabelText(/Título del programa/), { target: { value: "Programa de controles críticos v2" } })
    expect(screen.getAllByText("Cambios sin guardar").length).toBeGreaterThan(0)
    expect(mockUpdate).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(1500)
    expect(mockUpdate).toHaveBeenCalledTimes(1)
    const [, formData] = mockUpdate.mock.calls[0]!
    expect(formData.get("title")).toBe("Programa de controles críticos v2")
    expect(formData.get("programId")).toBe("program-1")
  })

  it("does not autosave before the debounce window elapses", () => {
    render(<MetadataTab program={PROGRAM} canDelete={false} />)

    fireEvent.change(screen.getByLabelText(/Título del programa/), { target: { value: "Cambio a medias" } })
    vi.advanceTimersByTime(1000)
    expect(mockUpdate).not.toHaveBeenCalled()
  })

  it("does not mark saved values as dirty once the field is untouched", () => {
    render(<MetadataTab program={PROGRAM} canDelete={false} />)

    fireEvent.change(screen.getByLabelText(/Meta de cumplimiento/), { target: { value: "0.9" } })
    expect(screen.getAllByText("Guardado").length).toBeGreaterThan(0)
  })
})
