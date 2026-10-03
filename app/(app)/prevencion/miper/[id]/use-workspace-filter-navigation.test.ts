// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("next/navigation", () => ({ usePathname: () => "/prevencion/miper/m1" }))
const navigateWorkspace = vi.fn()
vi.mock("./workspace-nav", () => ({ navigateWorkspace: (...args: unknown[]) => navigateWorkspace(...args) }))

import { useWorkspaceFilterNavigation } from "./use-workspace-filter-navigation"

const KEYS = ["q", "estado"] as const

describe("useWorkspaceFilterNavigation", () => {
  beforeEach(() => {
    navigateWorkspace.mockClear()
    window.history.replaceState(null, "", "/prevencion/miper/m1?tab=programa&q=lodo&buscar=otro")
  })

  it("setFilter sólo toca su clave y parte de la URL vigente", () => {
    const { result } = renderHook(() => useWorkspaceFilterNavigation(KEYS))
    // La URL cambió después del render: el hook debe leer la vigente.
    window.history.replaceState(null, "", "/prevencion/miper/m1?tab=programa&q=lodo&buscar=otro&frecuencia=weekly")
    act(() => result.current.setFilter("estado", "activas"))
    expect(navigateWorkspace).toHaveBeenCalledWith("/prevencion/miper/m1?tab=programa&q=lodo&buscar=otro&frecuencia=weekly&estado=activas", "replace")
  })

  it("clearFilters borra sólo sus claves", () => {
    window.history.replaceState(null, "", "/prevencion/miper/m1?tab=programa&q=lodo&estado=activas&buscar=otro")
    const { result } = renderHook(() => useWorkspaceFilterNavigation(KEYS))
    act(() => result.current.clearFilters())
    expect(navigateWorkspace).toHaveBeenCalledWith("/prevencion/miper/m1?tab=programa&buscar=otro", "replace")
  })

  it("usa replace sin ida al servidor (navigateWorkspace)", () => {
    const { result } = renderHook(() => useWorkspaceFilterNavigation(KEYS))
    act(() => result.current.setFilters({ q: null, estado: "retiradas" }))
    expect(navigateWorkspace).toHaveBeenCalledTimes(1)
    expect(navigateWorkspace.mock.calls[0]![1]).toBe("replace")
  })
})
