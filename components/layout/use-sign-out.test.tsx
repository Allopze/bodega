// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  signOut: vi.fn(async (): Promise<void> => {}),
  getSession: vi.fn(async () => null),
  clearAllInspectionDrafts: vi.fn(),
  purgeIncidentOfflineData: vi.fn(async (): Promise<void> => {}),
  clearPpaQueue: vi.fn(async (): Promise<void> => {}),
  clearInspectionSubmissionQueue: vi.fn(async (): Promise<void> => {}),
}))

vi.mock("next-auth/react", () => ({ signOut: mocks.signOut, getSession: mocks.getSession }))
vi.mock("@/lib/prevention/inspection-draft-storage", () => ({ clearAllInspectionDrafts: mocks.clearAllInspectionDrafts }))
vi.mock("@/app/(app)/prevencion/incidentes/reportar/offline-incident-queue", () => ({
  purgeIncidentOfflineData: mocks.purgeIncidentOfflineData,
}))
vi.mock("@/lib/pwa/offline-queue", () => ({ clearPpaQueue: mocks.clearPpaQueue }))
vi.mock("@/app/(app)/prevencion/inspecciones/[runId]/offline-inspection-queue", () => ({
  clearInspectionSubmissionQueue: mocks.clearInspectionSubmissionQueue,
}))

import { useSignOut } from "@/components/layout/use-sign-out"

describe("useSignOut", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.purgeIncidentOfflineData.mockReset().mockResolvedValue(undefined)
    // La navegación final a /login no se puede ejecutar en jsdom.
    Object.defineProperty(window, "location", { configurable: true, value: { href: "" } })
  })

  /*
   * Lo que el trabajo sin conexión dejó en este equipo (respuestas de
   * inspecciones en localStorage; borradores de incidentes y RE-20 y colas en
   * IndexedDB) vive en claro. En un equipo de faena compartido no puede
   * sobrevivir al cambio de usuario.
   */
  it("vacía el espejo local de inspecciones junto con las colas offline, antes de cerrar la sesión", async () => {
    const order: string[] = []
    mocks.clearAllInspectionDrafts.mockImplementation(() => { order.push("drafts") })
    mocks.clearInspectionSubmissionQueue.mockImplementation(async () => { order.push("cola") })
    mocks.signOut.mockImplementation(async () => { order.push("signOut") })

    const { result } = renderHook(() => useSignOut())
    await act(async () => { await result.current.handleSignOut() })

    expect(mocks.clearAllInspectionDrafts).toHaveBeenCalledTimes(1)
    expect(mocks.clearInspectionSubmissionQueue).toHaveBeenCalledTimes(1)
    expect(mocks.purgeIncidentOfflineData).toHaveBeenCalledTimes(1)
    expect(mocks.clearPpaQueue).toHaveBeenCalledTimes(1)
    expect(order.indexOf("drafts")).toBeLessThan(order.indexOf("signOut"))
    expect(order.indexOf("cola")).toBeLessThan(order.indexOf("signOut"))
    expect(window.location.href).toBe("/login")
  })

  it("purga los borradores de incidentes y RE-20 antes de cerrar la sesión", async () => {
    const order: string[] = []
    mocks.purgeIncidentOfflineData.mockImplementation(async () => { order.push("incidentes") })
    mocks.signOut.mockImplementation(async () => { order.push("signOut") })

    const { result } = renderHook(() => useSignOut())
    await act(async () => { await result.current.handleSignOut() })

    expect(order.indexOf("incidentes")).toBeGreaterThanOrEqual(0)
    expect(order.indexOf("incidentes")).toBeLessThan(order.indexOf("signOut"))
  })

  it("si la purga de borradores falla (sin almacenamiento, borrador bloqueado), igual cierra la sesión", async () => {
    mocks.purgeIncidentOfflineData.mockRejectedValue(new Error("IndexedDB bloqueado"))
    const { result } = renderHook(() => useSignOut())
    await act(async () => { await result.current.handleSignOut() })
    expect(mocks.clearPpaQueue).toHaveBeenCalled()
    expect(mocks.clearInspectionSubmissionQueue).toHaveBeenCalled()
    expect(mocks.signOut).toHaveBeenCalled()
    expect(window.location.href).toBe("/login")
  })

  it("si la limpieza del espejo falla, igual cierra la sesión y navega a /login", async () => {
    mocks.clearAllInspectionDrafts.mockImplementation(() => { throw new Error("bloqueado") })
    const { result } = renderHook(() => useSignOut())
    await act(async () => { await result.current.handleSignOut() })
    expect(mocks.signOut).toHaveBeenCalled()
    expect(window.location.href).toBe("/login")
  })
})
