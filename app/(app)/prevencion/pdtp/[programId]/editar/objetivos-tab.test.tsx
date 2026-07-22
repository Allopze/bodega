// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import type { pdtpActivities } from "@/db/schema"
import { ObjetivosTab } from "./builder-tabs"

const { mockRename, mockRefresh } = vi.hoisted(() => ({
  mockRename: vi.fn(),
  mockRefresh: vi.fn(),
}))

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mockRefresh, push: vi.fn() }) }))
vi.mock("../../actions", () => ({ renamePdtpObjectiveAction: mockRename }))

const ACTIVITIES = [
  { objectiveOrder: 1, objective: "Reducir accidentes graves" },
  { objectiveOrder: 2, objective: "Fortalecer el CPHS" },
] as unknown as Array<typeof pdtpActivities.$inferSelect>

beforeEach(() => {
  vi.useFakeTimers()
  mockRename.mockResolvedValue({ ok: true })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  vi.useRealTimers()
})

describe("ObjetivosTab autosave", () => {
  it("autosaves an objective rename after a debounce pause", async () => {
    render(<ObjetivosTab programId="program-1" activities={ACTIVITIES} />)

    const input = screen.getByDisplayValue("Reducir accidentes graves")
    fireEvent.change(input, { target: { value: "Reducir accidentes graves y leves" } })
    expect(screen.getAllByText("Cambios sin guardar").length).toBeGreaterThan(0)
    expect(mockRename).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(1500)
    expect(mockRename).toHaveBeenCalledTimes(1)
    expect(mockRename).toHaveBeenCalledWith({ programId: "program-1", objectiveOrder: 1, objective: "Reducir accidentes graves y leves" })
    expect(mockRefresh).toHaveBeenCalledTimes(1)
  })

  it("does not autosave before the debounce window elapses", () => {
    render(<ObjetivosTab programId="program-1" activities={ACTIVITIES} />)

    fireEvent.change(screen.getByDisplayValue("Fortalecer el CPHS"), { target: { value: "Cambio a medias" } })
    vi.advanceTimersByTime(1000)
    expect(mockRename).not.toHaveBeenCalled()
  })

  it("does not trigger a save when the value is untouched", () => {
    render(<ObjetivosTab programId="program-1" activities={ACTIVITIES} />)

    fireEvent.change(screen.getByDisplayValue("Reducir accidentes graves"), { target: { value: "Reducir accidentes graves" } })
    expect(screen.getAllByText("Guardado").length).toBeGreaterThan(0)
  })

  it("shows a recoverable error on a network failure, and a manual retry (Guardar) succeeds", async () => {
    mockRename.mockRejectedValueOnce(new Error("Network request failed")).mockResolvedValueOnce({ ok: true })
    render(<ObjetivosTab programId="program-1" activities={ACTIVITIES} />)

    fireEvent.change(screen.getByDisplayValue("Reducir accidentes graves"), { target: { value: "Reducir accidentes graves y leves" } })
    await vi.advanceTimersByTimeAsync(1500)
    expect(mockRename).toHaveBeenCalledTimes(1)
    await expect(mockRename.mock.results[0]!.value).rejects.toThrow("Network request failed")
    // Deja que el catch/setError de useDebouncedAutosave termine de asentarse.
    await vi.advanceTimersByTimeAsync(0)
    expect(screen.getAllByText(/Error de red al guardar/).length).toBeGreaterThan(0)

    // isDirty sigue en true tras el fallo — no se pierde el cambio — y el
    // botón "Guardar" explícito permite reintentar de inmediato.
    fireEvent.click(screen.getAllByRole("button", { name: "Guardar" })[0]!)
    await vi.advanceTimersByTimeAsync(0)
    expect(mockRename).toHaveBeenCalledTimes(2)
    expect(mockRefresh).toHaveBeenCalledTimes(1)
    expect(screen.getAllByText("Guardado").length).toBeGreaterThan(0)
  })
})
